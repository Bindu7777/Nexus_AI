// Wraps the frozen engine's outputs into the shared EvidenceItem type and the
// detector context. Reads engine records; never edits the engine.
import { clip } from "../../connectors/types";
import type { DemoStore } from "../lib/store";
import type { EvidenceRecord, RunRecord } from "../lib/types";
import type { EvidenceItem, LoadMeasurements } from "./types";

/** One engine evidence record (metric, trace, log or source) as an EvidenceItem. Its id is the stable reference. */
export function engineRecordToEvidence(record: EvidenceRecord): EvidenceItem {
  const body = (record.body ?? {}) as Record<string, unknown>;
  const base: EvidenceItem = {
    source: record.origin === "workspace-source" ? "demo-catalog-source" : "demo-catalog",
    kind: "sandbox",
    ref: record.id,
    timestamp: typeof body.at === "string" ? body.at : typeof body.startedAt === "string" ? body.startedAt : record.createdAt || null,
    retrievedAt: record.createdAt,
    title: record.title,
    excerpt: "",
    observation: "observed",
  };
  if (record.type === "source") {
    const src = body as { path?: string; startLine?: number; endLine?: number; excerpt?: string };
    return { ...base, excerpt: clip(src.excerpt ?? "", 6000), location: { path: src.path, startLine: src.startLine, endLine: src.endLine } };
  }
  if (record.type === "metric") {
    return { ...base, excerpt: clip(JSON.stringify(body.summary ?? body), 4000), meta: { phase: body.phase ?? null } };
  }
  return { ...base, excerpt: clip(JSON.stringify(body), 2000) };
}

/** Every evidence record stored for an engine run, in the run's own order. */
export function engineRunEvidence(run: RunRecord, store: DemoStore): EvidenceItem[] {
  return run.evidence
    .map((index) => store.evidence.get(index.id))
    .filter((r): r is EvidenceRecord => Boolean(r))
    .map(engineRecordToEvidence);
}

/**
 * The exact inputs the frozen diagnose() received for a demo run, rebuilt from
 * the run record and its stored telemetry, so detector 1 sees the same data.
 */
export function loadMeasurementsFromRun(run: RunRecord, store: DemoStore): LoadMeasurements | null {
  const outage = run.scenario === "outage";
  const phase = outage ? run.outage : run.incident;
  if (!phase) return null;
  const evidenceIds = run.evidence.map((e) => e.id);
  const warnLogs = outage
    ? []
    : run.evidence
        .filter((e) => e.type === "log")
        .map((e) => store.evidence.get(e.id)?.body as { id?: string; level?: string; fields?: Record<string, unknown> } | undefined)
        .filter((log): log is { id: string; level: string; fields: Record<string, unknown> } => Boolean(log?.id && log.fields))
        .filter((log) => log.fields.mode === "incident" && log.level === "warn")
        .map((log) => ({ id: log.id, lockWaitMs: typeof log.fields.lockWaitMs === "number" ? log.fields.lockWaitMs : null }));
  return {
    scenario: outage ? "outage" : "lock",
    baseline: outage ? null : (run.baseline?.summary ?? null),
    incident: phase.summary,
    incidentSamples: phase.samples,
    evidenceIds,
    warnLogs,
    workMs: run.profile.workMs,
    profile: { requests: run.profile.requests, concurrency: run.profile.concurrency, timeoutMs: run.profile.timeoutMs },
    runId: run.id,
  };
}
