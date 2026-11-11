import { scenario } from "./scenario";
import { roundMs } from "./stats";
import type { LoadProfile, PhaseName, Sample } from "./types";

function headerNumber(response: Response, name: string) {
  const raw = response.headers.get(name);
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function runLoad(options: {
  catalogUrl: string;
  phase: PhaseName;
  profile: LoadProfile;
  onSample?: (sample: Sample) => void;
}) {
  const samples: Sample[] = [];
  let cursor = 0;

  async function one(index: number): Promise<Sample> {
    const product = scenario.products[index % scenario.products.length];
    const started = performance.now();
    try {
      const response = await fetch(`${options.catalogUrl}/products/${product.id}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(options.profile.timeoutMs),
      });
      const latencyMs = roundMs(performance.now() - started);
      let error: string | null = null;
      if (!response.ok) {
        try {
          const body = (await response.json()) as { error?: string };
          error = body.error ?? `http_${response.status}`;
        } catch {
          error = `http_${response.status}`;
        }
      }
      return {
        index,
        phase: options.phase,
        productId: product.id,
        status: response.status,
        latencyMs,
        error,
        traceId: response.headers.get("x-trace-id"),
        logId: response.headers.get("x-log-id"),
        lockWaitMs: headerNumber(response, "x-lock-wait-ms"),
        lockHoldMs: headerNumber(response, "x-lock-hold-ms"),
        queueDepth: headerNumber(response, "x-queue-depth"),
        serverDurationMs: headerNumber(response, "x-server-duration-ms"),
        mode: response.headers.get("x-catalog-mode"),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        index,
        phase: options.phase,
        productId: product.id,
        status: 0,
        latencyMs: roundMs(performance.now() - started),
        error: isTimeout(error) ? "timeout" : error instanceof Error ? error.message : "request_failed",
        traceId: null,
        logId: null,
        lockWaitMs: null,
        lockHoldMs: null,
        queueDepth: null,
        serverDurationMs: null,
        mode: null,
        completedAt: new Date().toISOString(),
      };
    }
  }

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= options.profile.requests) return;
      const sample = await one(index);
      samples.push(sample);
      options.onSample?.(sample);
    }
  }

  const workers = Math.min(options.profile.concurrency, options.profile.requests);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return samples;
}
