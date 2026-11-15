// Supabase logs through the Management API analytics endpoint, over HTTP GET.
// The query string carries a log-explorer SELECT; the endpoint only reads.
// Status: implemented against Supabase's documented API, not yet exercised
// against a live project.
import { createReadOnlyHttp, type FetchLike, redact } from "../http";
import { clip, type Connector, type EvidenceItem, emptyTestResult, nowIso, type SearchQuery } from "../types";

export type SupabaseLogsConfig = {
  projectRef: string;
  /** Supabase personal access token (read scope is enough). */
  accessToken?: string;
  apiBase?: string;
  /** Log sources to query, e.g. edge_logs, postgres_logs, function_logs, auth_logs. */
  sources?: string[];
  fetchImpl?: FetchLike;
};

const SOURCES = new Set(["edge_logs", "postgres_logs", "function_logs", "function_edge_logs", "auth_logs", "storage_logs", "realtime_logs", "postgrest_logs", "supavisor_logs"]);

export function createSupabaseLogsConnector(config: SupabaseLogsConfig): Connector {
  const apiBase = (config.apiBase ?? "https://api.supabase.com").replace(/\/$/, "");
  const sources = (config.sources?.length ? config.sources : ["edge_logs", "postgres_logs", "function_logs"]).filter((s) => SOURCES.has(s));
  const http = createReadOnlyHttp({
    fetchImpl: config.fetchImpl,
    secrets: [config.accessToken],
    baseHeaders: config.accessToken ? { authorization: `Bearer ${config.accessToken}` } : {},
  });
  const clean = (m: string) => redact(m, [config.accessToken]);
  const projectOk = /^[a-z0-9]{10,40}$/.test(config.projectRef);

  async function query(sql: string, start: string, end: string) {
    const params = new URLSearchParams({ sql, iso_timestamp_start: start, iso_timestamp_end: end });
    const res = await http.getJson<{ result?: Record<string, unknown>[]; error?: unknown }>(
      `${apiBase}/v1/projects/${config.projectRef}/analytics/endpoints/logs.all?${params}`,
    );
    if (res.status !== 200) throw new Error(clean(`Supabase logs returned HTTP ${res.status}.`));
    if (res.data?.error) throw new Error(clean(`Supabase logs error: ${JSON.stringify(res.data.error).slice(0, 300)}`));
    return res.data?.result ?? [];
  }

  const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[%_]/g, "");

  return {
    id: "supabase-logs",
    kind: "logs",
    readOnly: true,
    implemented: true,
    description: `Supabase project ${config.projectRef} logs (${sources.join(", ")}) via the Management API, GET only. Not yet tested against a live project.`,
    async test() {
      const result = emptyTestResult();
      if (!projectOk) result.problems.push("The Supabase project ref looks wrong. It is the id in your project URL.");
      if (!config.accessToken) result.problems.push("Set SUPABASE_ACCESS_TOKEN to read logs.");
      if (result.problems.length) return result;
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 60 * 60 * 1000);
        const rows = await query(`select timestamp from ${sources[0]} limit 1`, start.toISOString(), end.toISOString());
        result.ok = true;
        result.reached.push(`Supabase logs for project ${config.projectRef} (${sources.join(", ")}); ${rows.length} row in the last hour from ${sources[0]}`);
        result.warnings.push("The Supabase logs connector has not been exercised against a live project before; check the reached sources look right.");
      } catch (error) {
        result.problems.push(error instanceof Error ? error.message : String(error));
      }
      return result;
    },
    async search(q: SearchQuery) {
      if (!projectOk) throw new Error("Invalid Supabase project ref.");
      const end = new Date();
      const start = q.since ? new Date(q.since) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
      const limit = Math.min(q.limit ?? 50, 200);
      const targets = q.scope && SOURCES.has(q.scope) ? [q.scope] : sources;
      const needle = escape(q.text);
      const retrievedAt = nowIso();
      const out: EvidenceItem[] = [];
      for (const source of targets) {
        const rows = await query(
          `select id, timestamp, event_message from ${source} where event_message like '%${needle}%' order by timestamp desc limit ${limit}`,
          start.toISOString(),
          end.toISOString(),
        );
        for (const r of rows) {
          const ts = typeof r.timestamp === "number" ? new Date(r.timestamp / 1000).toISOString() : r.timestamp ? String(r.timestamp) : null;
          out.push({
            source: "supabase-logs",
            kind: "logs",
            ref: `log:supabase:${source}:${String(r.id)}`,
            timestamp: ts,
            retrievedAt,
            title: `${source} ${ts ?? ""}`.trim(),
            excerpt: clip(String(r.event_message ?? ""), 4000),
            observation: "observed",
            meta: { source },
          });
        }
      }
      return out.slice(0, limit);
    },
    async fetch(ref: string) {
      const m = ref.match(/^log:supabase:([a-z_]+):([A-Za-z0-9-]+)$/);
      if (!m || !SOURCES.has(m[1]) || !projectOk) return null;
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const rows = await query(`select id, timestamp, event_message from ${m[1]} where id = '${m[2]}' limit 1`, start.toISOString(), end.toISOString());
      const r = rows[0];
      if (!r) return null;
      return {
        source: "supabase-logs",
        kind: "logs",
        ref,
        timestamp: r.timestamp ? String(r.timestamp) : null,
        retrievedAt: nowIso(),
        title: `${m[1]} ${String(r.timestamp ?? "")}`.trim(),
        excerpt: clip(String(r.event_message ?? ""), 4000),
        observation: "observed",
      };
    },
  };
}
