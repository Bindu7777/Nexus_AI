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
  maxTotal: number;
  maxRps: number;
};

export type RequestInfo = { method: string; url: string; phase: "login" | "run" };
export type Decision = { allow: true } | { allow: false; reason: string; kind: "host" | "write" | "cap" | "scheme" };

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

export function makePolicy(input: { serviceUrl: string; extraHosts: string[]; loginAuthPaths: string[]; maxTotal: number; maxRps: number; productionReadOnly: boolean }): ReproPolicy {
  const host = hostOf(input.serviceUrl);
  return {
    origin: new URL(input.serviceUrl).origin,
    allowedHosts: [...new Set([host, ...input.extraHosts.map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean)])],
    // Writes are only ever allowed on a non-production site with explicit test-data permission,
    // which this build does not offer yet: every reproduction is read-only.
    readOnly: true,
    loginAuthPaths: input.loginAuthPaths.map((p) => p.trim()).filter((p) => p.startsWith("/")),
    maxTotal: Math.max(1, Math.min(input.maxTotal, 1000)),
    maxRps: Math.max(1, Math.min(input.maxRps, 20)),
  };
}

/**
 * Decide one request. `sent` is how many requests were already allowed in this run.
 * data: and blob: URLs never leave the browser and are always allowed.
 */
export function decideRequest(policy: ReproPolicy, req: RequestInfo, sent: number): Decision {
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
    if (policy.readOnly && !loginWrite) return { allow: false, kind: "write", reason: `${method} blocked: this reproduction is read-only.` };
  }
  if (sent >= policy.maxTotal) return { allow: false, kind: "cap", reason: `Request cap of ${policy.maxTotal} reached.` };
  return { allow: true };
}
