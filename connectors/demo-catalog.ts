// The demo catalog behind the shared connector interface.
//
// This connector only reads: GET /health, GET /admin/telemetry, and the source
// region from services/catalog/server.mjs. Switching the sandbox between
// baseline / incident / remediated modes is a sandbox control owned by
// src/lib/investigate.ts, not a connector capability, and it only ever targets
// the local demo process.
import { readSourceRegion } from "../src/lib/source-evidence";
import { createReadOnlyHttp, type FetchLike } from "./http";
import { clip, type Connector, type EvidenceItem, emptyTestResult, nowIso, type SearchQuery } from "./types";

export type CatalogTelemetry = {
  mode?: string;
  maxQueueDepth?: number;
  logs: {
    id: string;
    at: string;
    level: string;
    traceId: string;
    message: string;
    fields: Record<string, unknown>;
  }[];
  traces: {
    traceId: string;
    logId: string;
    startedAt: string;
    durationMs: number;
    status: number;
    productId: string;
    mode: string;
    workPlacement: string;
    spans: unknown[];
  }[];
};

export type DemoCatalogConnector = Connector & {
  readonly baseUrl: string;
  /** Raw telemetry exactly as the catalog returns it. */
  telemetry(): Promise<CatalogTelemetry>;
  /** A marked source region of services/catalog/server.mjs. */
  sourceRegion(region: string): ReturnType<typeof readSourceRegion>;
};

export function createDemoCatalogConnector(options: {
  baseUrl: string;
  projectRoot?: string;
  fetchImpl?: FetchLike;
}): DemoCatalogConnector {
  const http = createReadOnlyHttp({ fetchImpl: options.fetchImpl, timeoutMs: 10_000 });
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function telemetry(): Promise<CatalogTelemetry> {
    let result;
    try {
      result = await http.getJson<CatalogTelemetry & { error?: string }>(`${baseUrl}/admin/telemetry`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      throw new Error(`Catalog sandbox is not reachable at ${baseUrl}. ${detail}`);
    }
    if (result.status >= 400 || !result.data) {
      throw new Error(result.data?.error ?? `Catalog returned HTTP ${result.status}`);
    }
    return result.data;
  }

  function logItem(log: CatalogTelemetry["logs"][number], retrievedAt: string): EvidenceItem {
    return {
      source: "demo-catalog",
      kind: "sandbox",
      ref: `catalog:log:${log.id}`,
      timestamp: log.at,
      retrievedAt,
      title: `${log.level} ${log.id} · ${log.message}`,
      excerpt: clip(JSON.stringify(log)),
      observation: "observed",
    };
  }

  function traceItem(trace: CatalogTelemetry["traces"][number], retrievedAt: string): EvidenceItem {
    return {
      source: "demo-catalog",
      kind: "sandbox",
      ref: `catalog:trace:${trace.traceId}`,
      timestamp: trace.startedAt,
      retrievedAt,
      title: `${trace.mode} trace ${trace.traceId.slice(0, 8)} · ${trace.productId}`,
      excerpt: clip(JSON.stringify(trace)),
      observation: "observed",
    };
  }

  function sourceItem(region: string): EvidenceItem {
    const source = readSourceRegion(region, options.projectRoot);
    return {
      source: "demo-catalog",
      kind: "sandbox",
      ref: `catalog:source:${region}`,
      timestamp: null,
      retrievedAt: nowIso(),
      title: `Source ${source.path}:${source.startLine}-${source.endLine}`,
      excerpt: clip(source.excerpt, 20_000),
      observation: "observed",
      location: { path: source.path, startLine: source.startLine, endLine: source.endLine },
    };
  }

  return {
    id: "demo-catalog",
    kind: "sandbox",
    readOnly: true,
    implemented: true,
    description: "Local demo catalog process (services/catalog/server.mjs). Sandbox only.",
    baseUrl,
    telemetry,
    sourceRegion: (region) => readSourceRegion(region, options.projectRoot),
    async test() {
      const result = emptyTestResult();
      try {
        const health = await http.getJson<{ ok?: boolean; mode?: string; service?: string }>(`${baseUrl}/health`);
        if (health.status === 200 && health.data?.ok) {
          result.ok = true;
          result.reached.push(`${health.data.service ?? "catalog"} at ${baseUrl} (mode ${health.data.mode ?? "unknown"})`);
        } else {
          result.problems.push(`The catalog at ${baseUrl} answered HTTP ${health.status}. Start it with npm run demo.`);
        }
      } catch (error) {
        result.problems.push(`The catalog at ${baseUrl} is not reachable. Start it with npm run demo. ${error instanceof Error ? error.message : ""}`.trim());
      }
      return result;
    },
    async search(query: SearchQuery) {
      const retrievedAt = nowIso();
      const data = await telemetry();
      const needle = query.text.toLowerCase();
      const items = [
        ...data.logs.filter((log) => JSON.stringify(log).toLowerCase().includes(needle)).map((log) => logItem(log, retrievedAt)),
        ...data.traces.filter((t) => JSON.stringify(t).toLowerCase().includes(needle)).map((t) => traceItem(t, retrievedAt)),
      ];
      return items.slice(0, query.limit ?? 50);
    },
    async fetch(ref: string) {
      const match = ref.match(/^catalog:(log|trace|source):(.+)$/);
      if (!match) return null;
      const [, type, id] = match;
      if (type === "source") {
        try {
          return sourceItem(id);
        } catch {
          return null;
        }
      }
      const retrievedAt = nowIso();
      const data = await telemetry();
      if (type === "log") {
        const log = data.logs.find((item) => item.id === id);
        return log ? logItem(log, retrievedAt) : null;
      }
      const trace = data.traces.find((item) => item.traceId === id);
      return trace ? traceItem(trace, retrievedAt) : null;
    },
  };
}
