// Vercel logs through the Vercel REST API, GET only: the listed projects,
// their recent deployments, and each deployment's runtime logs.
// Runtime logs are a live stream: reads are bounded in time, and tail() watches
// production while a reproduction runs.
import { createReadOnlyHttp, type FetchLike, redact } from "../http";
import { clip, type Connector, type EvidenceItem, emptyTestResult, nowIso, type SearchQuery } from "../types";

export type VercelLogsConfig = {
  token?: string;
  /** Team ID (team_...) when the projects belong to a team. */
  teamId?: string;
  projects: string[];
  /** How many recent deployments per project to read logs from. */
  deploymentsPerProject?: number;
  /** How long one read of a deployment's log stream may stay open, ms. */
  streamMs?: number;
  apiBase?: string;
  fetchImpl?: FetchLike;
};

type VProject = { id: string; name: string; framework?: string | null };
type VDeployment = { uid: string; url?: string; state?: string; readyState?: string; created?: number; createdAt?: number; target?: string | null };
type VLogLine = {
  rowId?: string;
  level?: string;
  message?: string;
  source?: string;
  timestampInMs?: number;
  requestMethod?: string;
  requestPath?: string;
  responseStatusCode?: number;
  domain?: string;
};

export function parseLogLines(text: string): VLogLine[] {
  const out: VLogLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      out.push(JSON.parse(t) as VLogLine);
    } catch {
      // partial line at the end of a capped stream
    }
  }
  return out;
}

/** Live server logs, watched while something else (a reproduction) runs. */
export type LiveLogTail = {
  tail(options: { maxMs: number; signal?: AbortSignal; since?: number }): Promise<EvidenceItem[]>;
};

export function hasLiveTail(c: unknown): c is LiveLogTail {
  return !!c && typeof (c as Partial<LiveLogTail>).tail === "function";
}

export function createVercelLogsConnector(config: VercelLogsConfig): Connector & LiveLogTail {
  const apiBase = (config.apiBase ?? "https://api.vercel.com").replace(/\/$/, "");
  const http = createReadOnlyHttp({
    fetchImpl: config.fetchImpl,
    secrets: [config.token],
    baseHeaders: config.token ? { authorization: `Bearer ${config.token}` } : {},
  });
  const clean = (m: string) => redact(m, [config.token]);
  const team = config.teamId ? `teamId=${encodeURIComponent(config.teamId)}` : "";
  const q = (path: string, extra = "") => {
    const parts = [extra, team].filter(Boolean).join("&");
    return `${apiBase}${path}${parts ? `?${parts}` : ""}`;
  };
  const perProject = Math.max(1, Math.min(config.deploymentsPerProject ?? 3, 10));

  async function json<T>(url: string): Promise<T> {
    const r = await http.getJson<T & { error?: { message?: string } }>(url);
    if (r.status >= 400 || !r.data) {
      const msg = (r.data as { error?: { message?: string } } | null)?.error?.message;
      throw new Error(clean(`Vercel returned HTTP ${r.status}${msg ? `: ${msg}` : ""}`));
    }
    return r.data;
  }

  const projectCache = new Map<string, VProject>();
  async function project(idOrName: string) {
    if (!projectCache.has(idOrName)) projectCache.set(idOrName, await json<VProject>(q(`/v9/projects/${encodeURIComponent(idOrName)}`)));
    return projectCache.get(idOrName)!;
  }

  async function deployments(p: VProject, limit = perProject) {
    const data = await json<{ deployments: VDeployment[] }>(q("/v6/deployments", `projectId=${encodeURIComponent(p.id)}&limit=${limit}`));
    return data.deployments ?? [];
  }

  // Vercel's runtime-logs endpoint is a stream that stays open. Read it once per
  // deployment for a short window and reuse the lines for every search term.
  async function streamLogs(p: VProject, d: VDeployment, limits: { maxMs: number; signal?: AbortSignal }) {
    const r = await http.getTextCapped(
      q(`/v1/projects/${encodeURIComponent(p.id)}/deployments/${encodeURIComponent(d.uid)}/runtime-logs`),
      { accept: "application/stream+json" },
      limits,
    );
    if (r.noResponse) return [];
    if (r.status >= 400) throw new Error(clean(`Vercel runtime logs returned HTTP ${r.status}.`));
    return parseLogLines(r.text);
  }
  const logCache = new Map<string, Promise<VLogLine[]>>();
  function runtimeLogs(p: VProject, d: VDeployment) {
    if (!logCache.has(d.uid)) {
      const read = streamLogs(p, d, { maxMs: config.streamMs ?? 4000 });
      read.catch(() => logCache.delete(d.uid));
      logCache.set(d.uid, read);
    }
    return logCache.get(d.uid)!;
  }

  /** The deployment that serves production now: newest READY production deployment. */
  async function liveDeployment(p: VProject) {
    const recent = await deployments(p, 10);
    const ready = recent.filter((d) => (d.readyState ?? d.state) === "READY");
    return ready.find((d) => d.target === "production") ?? ready[0] ?? null;
  }

  function item(p: VProject, d: VDeployment, l: VLogLine, retrievedAt: string): EvidenceItem {
    const ts = typeof l.timestampInMs === "number" ? new Date(l.timestampInMs).toISOString() : null;
    const req = l.requestMethod || l.requestPath ? ` ${l.requestMethod ?? ""} ${l.requestPath ?? ""}${l.responseStatusCode ? ` → ${l.responseStatusCode}` : ""}` : "";
    return {
      source: "vercel-logs",
      kind: "logs",
      ref: `log:vercel:${p.name}:${d.uid}:${l.rowId ?? l.timestampInMs ?? "?"}`,
      timestamp: ts,
      retrievedAt,
      title: `${p.name} ${l.level ?? "log"}${req}`.trim(),
      excerpt: clip(l.message ?? "", 4000),
      observation: "observed",
      location: d.url ? { url: `https://${d.url}` } : undefined,
      meta: {
        deployment: d.uid,
        target: d.target ?? null,
        source: l.source ?? null,
        level: l.level ?? null,
        status: l.responseStatusCode ?? null,
        method: l.requestMethod ?? null,
        path: l.requestPath ?? null,
      },
    };
  }

  return {
    id: "vercel-logs",
    kind: "logs",
    readOnly: true,
    implemented: true,
    description: `Vercel runtime logs for ${config.projects.join(", ")}, read with GET only.`,
    async tail({ maxMs, signal, since }) {
      // Watch each project's live production deployment at the same time, until
      // maxMs passes or the caller stops it. Lines older than `since` are dropped.
      const started = since ?? Date.now();
      const retrievedAt = nowIso();
      const perProject = await Promise.all(
        config.projects.map(async (name) => {
          const p = await project(name);
          const d = await liveDeployment(p);
          if (!d) return [];
          const lines = await streamLogs(p, d, { maxMs, signal });
          return lines
            .filter((l) => typeof l.timestampInMs !== "number" || l.timestampInMs >= started - 5000)
            .map((l) => {
              const it = item(p, d, l, retrievedAt);
              return { ...it, meta: { ...it.meta, live: true } };
            });
        }),
      );
      return perProject.flat().slice(0, 200);
    },
    async test() {
      const result = emptyTestResult();
      if (!config.token) {
        result.problems.push("Enter a Vercel access token.");
        return result;
      }
      if (!config.projects.length) result.problems.push("List at least one Vercel project.");
      try {
        const me = await json<{ user?: { username?: string } }>(q("/v2/user"));
        result.reached.push(`Vercel as ${me.user?.username ?? "the token's user"}${config.teamId ? ` (team ${config.teamId})` : ""}`);
        for (const name of config.projects) {
          try {
            const p = await project(name);
            const latest = (await deployments(p, 1))[0];
            result.reached.push(
              `Project ${p.name}${p.framework ? ` (${p.framework})` : ""}${
                latest ? `, latest deployment ${latest.uid} ${latest.readyState ?? latest.state ?? ""} ${latest.target ?? "preview"}`.trimEnd() : ", no deployments yet"
              }`,
            );
          } catch (error) {
            result.problems.push(`Project ${name} is not visible to this token. ${error instanceof Error ? error.message : ""}`.trim());
          }
        }
        result.warnings.push("Vercel access tokens cannot be limited to read-only. Nexus only sends GET requests; scope the token to the right team and set an expiry.");
        result.warnings.push("Vercel keeps runtime logs only for a limited time, depending on the plan. Older logs will not be found.");
        result.ok = result.problems.length === 0;
      } catch (error) {
        result.problems.push(error instanceof Error ? error.message : String(error));
      }
      return result;
    },
    async search(query: SearchQuery) {
      const needle = query.text.toLowerCase();
      const since = query.since ? Date.parse(query.since) : null;
      const limit = query.limit ?? 50;
      const retrievedAt = nowIso();
      const out: EvidenceItem[] = [];
      const names = query.scope ? config.projects.filter((p) => p === query.scope) : config.projects;
      for (const name of names) {
        const p = await project(name);
        for (const d of await deployments(p)) {
          for (const l of await runtimeLogs(p, d)) {
            if (since != null && typeof l.timestampInMs === "number" && l.timestampInMs < since) continue;
            const hay = `${l.message ?? ""} ${l.requestPath ?? ""} ${l.level ?? ""} ${l.responseStatusCode ?? ""}`.toLowerCase();
            if (hay.includes(needle)) out.push(item(p, d, l, retrievedAt));
            if (out.length >= limit) return out;
          }
        }
      }
      return out;
    },
    async fetch(ref: string) {
      const m = ref.match(/^log:vercel:([^:]+):([^:]+):(.+)$/);
      if (!m || !config.projects.includes(m[1])) return null;
      const p = await project(m[1]);
      const d = (await deployments(p, 10)).find((x) => x.uid === m[2]) ?? { uid: m[2] };
      const line = (await runtimeLogs(p, d)).find((l) => String(l.rowId ?? l.timestampInMs) === m[3]);
      return line ? item(p, d, line, nowIso()) : null;
    },
  };
}
