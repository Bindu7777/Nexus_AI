// The only HTTP client connectors use. It sends GET (or HEAD) and nothing else,
// never sends a body, and strips secrets from any error it raises.
import { ReadOnlyViolationError } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ALLOWED = new Set(["GET", "HEAD"]);

export type ReadOnlyHttp = {
  get(url: string, headers?: Record<string, string>): Promise<Response>;
  getJson<T>(url: string, headers?: Record<string, string>): Promise<{ status: number; data: T | null; headers: Headers }>;
  getText(url: string, headers?: Record<string, string>): Promise<{ status: number; text: string; headers: Headers }>;
  /**
   * GET a streaming response and stop after maxMs or maxBytes, whichever comes
   * first. For endpoints that keep a log stream open.
   */
  getTextCapped(
    url: string,
    headers?: Record<string, string>,
    limits?: { maxMs?: number; maxBytes?: number; signal?: AbortSignal },
  ): Promise<{ status: number; text: string; truncated: boolean; noResponse?: boolean }>;
};

export function assertReadOnlyRequest(init: RequestInit | undefined) {
  const method = (init?.method ?? "GET").toUpperCase();
  if (!ALLOWED.has(method)) {
    throw new ReadOnlyViolationError(`Refused HTTP ${method}. Connectors may only send GET or HEAD.`);
  }
  if (init?.body != null) {
    throw new ReadOnlyViolationError("Refused an HTTP request with a body. Connectors may only read.");
  }
}

/** Replace every known secret value in a message with a marker. */
export function redact(message: string, secrets: Array<string | undefined | null>) {
  let out = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function createReadOnlyHttp(options: {
  fetchImpl?: FetchLike;
  baseHeaders?: Record<string, string>;
  secrets?: Array<string | undefined | null>;
  timeoutMs?: number;
}): ReadOnlyHttp {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const secrets = options.secrets ?? [];

  async function get(url: string, headers: Record<string, string> = {}) {
    const init: RequestInit = {
      method: "GET",
      headers: { ...options.baseHeaders, ...headers },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    };
    assertReadOnlyRequest(init);
    try {
      return await fetchImpl(url, init);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(redact(`GET ${url} failed: ${detail}`, secrets));
    }
  }

  return {
    get,
    async getJson<T>(url: string, headers?: Record<string, string>) {
      const response = await get(url, { accept: "application/json", ...headers });
      const text = await response.text();
      let data: T | null = null;
      if (text) {
        try {
          data = JSON.parse(text) as T;
        } catch {
          data = null;
        }
      }
      return { status: response.status, data, headers: response.headers };
    },
    async getText(url: string, headers?: Record<string, string>) {
      const response = await get(url, headers);
      return { status: response.status, text: await response.text(), headers: response.headers };
    },
    async getTextCapped(url: string, headers: Record<string, string> = {}, limits = {}) {
      const maxMs = limits.maxMs ?? 8000;
      const maxBytes = limits.maxBytes ?? 2 * 1024 * 1024;
      const controller = new AbortController();
      const init: RequestInit = { method: "GET", headers: { ...options.baseHeaders, ...headers }, signal: controller.signal };
      assertReadOnlyRequest(init);
      // Our own stop: the time cap, or the caller's signal (for example, a reproduction finished).
      let stoppedByUs = false;
      const stop = () => {
        stoppedByUs = true;
        controller.abort();
      };
      const timer = setTimeout(stop, maxMs);
      const external = limits.signal;
      if (external?.aborted) stop();
      external?.addEventListener("abort", stop, { once: true });
      let response: Response;
      try {
        response = await fetchImpl(url, init);
      } catch (error) {
        clearTimeout(timer);
        external?.removeEventListener("abort", stop);
        // A live stream may send no headers until something happens. Stopping it
        // ourselves is not a failure: it means nothing arrived in the window.
        if (stoppedByUs) return { status: 0, text: "", truncated: true, noResponse: true };
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(redact(`GET ${url} failed: ${detail}`, secrets));
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      try {
        const reader = response.body?.getReader();
        while (reader && !stoppedByUs) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.byteLength;
          if (size >= maxBytes) {
            truncated = true;
            controller.abort();
            break;
          }
        }
      } catch {
        truncated = true; // stopped by the time cap
      } finally {
        clearTimeout(timer);
        external?.removeEventListener("abort", stop);
      }
      return { status: response.status, text: Buffer.concat(chunks).toString("utf8"), truncated };
    },
  };
}
