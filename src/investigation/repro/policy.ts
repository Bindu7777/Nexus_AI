// What a reproduction may send. Every browser request passes through
// decideRequest() before it leaves the machine. Plain code, no exceptions.
import { productionLookalike } from "../../nexus-admin/connectors/defs/service-under-test";

export type ReproPolicy = {
  /** The service under test, e.g. https://happymomentsindia.com */
  origin: string;
  /** Hosts requests may go to: the service host plus admin-listed extras. Subdomains need their own entry. */
  allowedHosts: string[];
  /** Production read-only, or staging without test-data permission: no request may send data. */
  readOnly: boolean;
  /** During sign-in only, these paths may receive a POST. */
  loginAuthPaths: string[];
  /**
   * The only saves an admin allowed, by exact method, host and path. They pass
   * only after the test account has signed in, and at most maxAllowedWrites per run.
   */
  allowedWrites: AllowedWrite[];
  maxAllowedWrites: number;
  maxTotal: number;
  maxRps: number;
};

export type AllowedWrite = { method: string; host: string; path: string };
export type RequestInfo = { method: string; url: string; phase: "login" | "run"; signedIn?: boolean };
export type Decision = { allow: true; allowedWrite?: AllowedWrite } | { allow: false; reason: string; kind: "host" | "write" | "cap" | "scheme" };

const WRITE_ENTRY = /^(POST|PUT|PATCH|DELETE)\s+(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,}(?::\d+)?)(\/[^\s?#*]*)$/i;

/** Parse "POST api.example.com/api/likes" entries. Returns the parsed list and any lines that are not valid. */
export function parseAllowedWrites(lines: string[]): { writes: AllowedWrite[]; invalid: string[] } {
  const writes: AllowedWrite[] = [];
  const invalid: string[] = [];
  for (const raw of lines.map((l) => l.trim()).filter(Boolean)) {
    const m = raw.match(WRITE_ENTRY);
    if (!m) invalid.push(raw);
    else writes.push({ method: m[1].toUpperCase(), host: m[2].toLowerCase().replace(/:\d+$/, ""), path: m[3].replace(/\/+$/, "") || "/" });
  }
  return { writes, invalid };
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Refuses production unless the admin ticked the read-only override. Returns a plain reason or null. */
export function targetRefusal(config: { serviceUrl: string; environmentName: string; productionReadOnly: boolean }, allowedEnvironments: string[]) {
  const prod = productionLookalike(config.serviceUrl, config.environmentName, allowedEnvironments);
  if (prod && !config.productionReadOnly) return `${prod} An admin must tick the read-only production override to reproduce here.`;
  if (!/^https?:\/\//i.test(config.serviceUrl)) return "The service URL must start with https:// or http://.";
  return null;
}

export function makePolicy(input: {
  serviceUrl: string;
  extraHosts: string[];
  loginAuthPaths: string[];
  maxTotal: number;
  maxRps: number;
  productionReadOnly: boolean;
  allowedWrites?: AllowedWrite[];
  maxAllowedWrites?: number;
}): ReproPolicy {
  const host = hostOf(input.serviceUrl);
  return {
    origin: new URL(input.serviceUrl).origin,
    allowedHosts: [...new Set([host, ...input.extraHosts.map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean)])],
    // Read-only always. The only exceptions are the sign-in request and the exact
    // saves an admin listed and confirmed, for the signed-in test account.
    readOnly: true,
    loginAuthPaths: input.loginAuthPaths.map((p) => p.trim()).filter((p) => p.startsWith("/")),
    allowedWrites: input.allowedWrites ?? [],
    maxAllowedWrites: Math.max(0, Math.min(input.maxAllowedWrites ?? 3, 10)),
    maxTotal: Math.max(1, Math.min(input.maxTotal, 1000)),
    maxRps: Math.max(1, Math.min(input.maxRps, 20)),
  };
}

/**
 * Decide one request. `sent` is how many requests were already allowed in this run.
 * data: and blob: URLs never leave the browser and are always allowed.
 */
export function decideRequest(policy: ReproPolicy, req: RequestInfo, sent: number, allowedWritesSent = 0): Decision {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { allow: false, kind: "scheme", reason: "Not a valid URL." };
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return { allow: true };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { allow: false, kind: "scheme", reason: `${url.protocol} requests are blocked.` };
  const host = url.hostname.toLowerCase();
  if (!policy.allowedHosts.includes(host)) return { allow: false, kind: "host", reason: `${host} is not an allowed host.` };
  const method = req.method.toUpperCase();
  if (!READ_METHODS.has(method)) {
    const loginWrite = req.phase === "login" && policy.loginAuthPaths.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`) || url.pathname.startsWith(`${p}?`));
    if (!loginWrite) {
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const listed = policy.allowedWrites.find((w) => w.method === method && w.host === host && w.path === path);
      if (listed) {
        if (!req.signedIn) return { allow: false, kind: "write", reason: `${method} blocked: allowed saves are only sent while the test account is signed in.` };
        if (allowedWritesSent >= policy.maxAllowedWrites) return { allow: false, kind: "write", reason: `${method} blocked: the cap of ${policy.maxAllowedWrites} allowed saves per run was reached.` };
        if (sent >= policy.maxTotal) return { allow: false, kind: "cap", reason: `Request cap of ${policy.maxTotal} reached.` };
        return { allow: true, allowedWrite: listed };
      }
      if (policy.readOnly) return { allow: false, kind: "write", reason: `${method} blocked: this reproduction is read-only.` };
    }
  }
  if (sent >= policy.maxTotal) return { allow: false, kind: "cap", reason: `Request cap of ${policy.maxTotal} reached.` };
  return { allow: true };
}
