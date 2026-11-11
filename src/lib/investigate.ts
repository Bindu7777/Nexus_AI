import { randomUUID } from "node:crypto";
import { catalogJson } from "./catalog-client";
import { diagnose, interpretValidation } from "./diagnosis";
import { runLoad } from "./load";
import { scenario } from "./scenario";
import { readSourceRegion } from "./source-evidence";
import { describeSummary, summarize } from "./stats";
import type { DemoStore } from "./store";
import type {
  EvidenceRecord,
  PhaseName,
  PhaseResult,
  RunRecord,
  Sample,
  ScenarioName,
} from "./types";

type Telemetry = {
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

function now() {
  return new Date().toISOString();
}

function addTimeline(run: RunRecord, title: string, detail: string) {
  run.timeline.push({ id: `tl_${run.timeline.length + 1}`, at: now(), title, detail });
}

function rememberSample(run: RunRecord, sample: Sample, completed: number, total: number) {
  const lock =
    sample.lockWaitMs == null ? "lockWait=—" : `lockWait=${sample.lockWaitMs}ms`;
  const queue = sample.queueDepth == null ? "queue=—" : `queue=${sample.queueDepth}`;
  const trace = sample.traceId ? sample.traceId.slice(0, 8) : "—";
  run.tail.push({
    at: sample.completedAt,
    phase: sample.phase,
    text: `${sample.phase} #${sample.index + 1} ${sample.productId} HTTP ${sample.status || sample.error} client=${sample.latencyMs}ms ${lock} ${queue} trace=${trace}`,
  });
  if (run.tail.length > 400) run.tail.shift();
  run.progress = { phase: sample.phase, completed, total };
}

async function collectPhase(options: {
  run: RunRecord;
  catalogUrl: string;
  phase: PhaseName;
  profile: { requests: number; concurrency: number; timeoutMs: number };
}): Promise<PhaseResult> {
  const startedAt = now();
  let completed = 0;
  addTimeline(
    options.run,
    `${label(options.phase)} load started`,
    `${options.profile.requests} GET /products/:id calls, concurrency ${options.profile.concurrency}, timeout ${options.profile.timeoutMs} ms.`,
  );
  const samples = await runLoad({
    catalogUrl: options.catalogUrl,
    phase: options.phase,
    profile: options.profile,
    onSample: (sample) => {
      completed += 1;
      rememberSample(options.run, sample, completed, options.profile.requests);
    },
  });
  const finishedAt = now();
  const summary = summarize(samples);
  addTimeline(options.run, `${label(options.phase)} load finished`, describeSummary(summary));
  return { startedAt, finishedAt, summary, samples };
}

function label(phase: PhaseName) {
  if (phase === "baseline") return "Baseline";
  if (phase === "incident") return "Incident";
  if (phase === "validation") return "Validation";
  return "Outage";
}

function putEvidence(store: DemoStore, record: EvidenceRecord) {
  store.evidence.set(record.id, record);
  return { id: record.id, type: record.type, title: record.title, origin: record.origin };
}

export function createRun(scenarioName: ScenarioName): RunRecord {
  const profile = scenarioName === "outage" ? scenario.outageLoad : scenario.load;
  return {
    id: `run_${randomUUID()}`,
    scenario: scenarioName,
    status: "running",
    startedAt: now(),
    finishedAt: null,
    progress: null,
    timeline: [],
    tail: [],
    baseline: null,
    incident: null,
    validation: null,
    outage: null,
    diagnosis: null,
    validationResult: null,
    validationError: null,
    error: null,
    evidence: [],
    profile: { ...profile, workMs: scenario.workMs },
  };
}

export async function runInvestigation(options: {
  catalogUrl: string;
  store: DemoStore;
  run: RunRecord;
  projectRoot?: string;
}) {
  const { catalogUrl, store, run } = options;
  try {
    await catalogJson(catalogUrl, "/health");
    addTimeline(run, "Investigation started", `Run ${run.id}. Scenario ${run.scenario}. Catalog ${catalogUrl}.`);
    await catalogJson(catalogUrl, "/admin/reset", { method: "POST" });
    addTimeline(run, "Catalog telemetry cleared", "The sandbox reset its logs, traces, and mode to baseline.");

    if (run.scenario === "outage") {
      await catalogJson(catalogUrl, "/admin/mode", {
        method: "POST",
        body: JSON.stringify({ mode: "unavailable" }),
      });
      addTimeline(
        run,
        "Catalog armed as unavailable",
        "This was requested from the outage control. The process returns HTTP 503 and does not take the catalog lock.",
      );
      run.outage = await collectPhase({ run, catalogUrl, phase: "outage", profile: scenario.outageLoad });
      const telemetry = (await catalogJson(catalogUrl, "/admin/telemetry")) as Telemetry;
      const evidenceIds = storeOutageEvidence(store, run, telemetry);
      run.diagnosis = diagnose({
        scenario: "outage",
        baseline: null,
        incident: run.outage.summary,
        incidentSamples: run.outage.samples,
        evidenceIds,
        warnLogs: [],
        workMs: scenario.workMs,
        profile: scenario.outageLoad,
        runId: run.id,
      });
      addTimeline(run, "Rules evaluated", run.diagnosis.title);
      run.status = "diagnosed";
      run.progress = null;
      run.finishedAt = now();
      return run;
    }

    await catalogJson(catalogUrl, "/admin/mode", {
      method: "POST",
      body: JSON.stringify({ mode: "baseline" }),
    });
    addTimeline(
      run,
      "Catalog set to baseline",
      `Read work (${scenario.workMs} ms) runs after the exclusive lock is released.`,
    );
    run.baseline = await collectPhase({ run, catalogUrl, phase: "baseline", profile: scenario.load });

    await catalogJson(catalogUrl, "/admin/mode", {
      method: "POST",
      body: JSON.stringify({ mode: "incident" }),
    });
    addTimeline(
      run,
      "Catalog set to incident",
      `The same ${scenario.workMs} ms read now runs inside the exclusive lock.`,
    );
    run.incident = await collectPhase({ run, catalogUrl, phase: "incident", profile: scenario.load });

    const telemetry = (await catalogJson(catalogUrl, "/admin/telemetry")) as Telemetry;
    const evidenceIds = storeLockEvidence(store, run, telemetry, options.projectRoot);
    const incidentLogs = telemetry.logs.filter((log) => log.fields.mode === "incident" && log.level === "warn");
    run.diagnosis = diagnose({
      scenario: "lock",
      baseline: run.baseline.summary,
      incident: run.incident.summary,
      incidentSamples: run.incident.samples,
      evidenceIds,
      warnLogs: incidentLogs.map((log) => ({
        id: log.id,
        lockWaitMs: typeof log.fields.lockWaitMs === "number" ? log.fields.lockWaitMs : null,
      })),
      workMs: scenario.workMs,
      profile: scenario.load,
      runId: run.id,
    });
    addTimeline(
      run,
      "Rules evaluated",
      `${run.diagnosis.outcome}. ${run.evidence.length} evidence records stored.`,
    );
    run.status = "diagnosed";
    run.progress = null;
    run.finishedAt = now();
    return run;
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "Investigation failed.";
    run.progress = null;
    run.finishedAt = now();
    addTimeline(run, "Investigation stopped", run.error);
    return run;
  }
}

function storeLockEvidence(store: DemoStore, run: RunRecord, telemetry: Telemetry, projectRoot?: string) {
  const createdAt = now();
  const samplesByTrace = new Map<string, Sample>();
  for (const sample of [...(run.baseline?.samples ?? []), ...(run.incident?.samples ?? [])]) {
    if (sample.traceId) samplesByTrace.set(sample.traceId, sample);
  }

  const index = [];
  if (run.baseline) {
    index.push(
      putEvidence(store, {
        id: `metric:${run.id}:baseline`,
        runId: run.id,
        type: "metric",
        title: "Baseline aggregate",
        origin: "executed-sandbox",
        createdAt,
        body: {
          note: "Computed from the client samples of the baseline load in this run. Not a historical production baseline.",
          phase: "baseline",
          profile: run.profile,
          summary: run.baseline.summary,
        },
      }),
    );
  }
  if (run.incident) {
    index.push(
      putEvidence(store, {
        id: `metric:${run.id}:incident`,
        runId: run.id,
        type: "metric",
        title: "Incident aggregate",
        origin: "executed-sandbox",
        createdAt,
        body: {
          note: "Computed from the client samples of the incident load in this run.",
          phase: "incident",
          profile: run.profile,
          summary: run.incident.summary,
        },
      }),
    );
  }

  const source = readSourceRegion("readProduct", projectRoot);
  index.push(
    putEvidence(store, {
      id: `source:${run.id}:readProduct`,
      runId: run.id,
      type: "source",
      title: `Source ${source.path}:${source.startLine}-${source.endLine}`,
      origin: "workspace-source",
      createdAt,
      body: source,
    }),
  );

  for (const trace of telemetry.traces) {
    const sample = samplesByTrace.get(trace.traceId) ?? null;
    index.push(
      putEvidence(store, {
        id: `trace:${trace.traceId}`,
        runId: run.id,
        type: "trace",
        title: `${trace.mode} trace ${trace.traceId.slice(0, 8)} · ${trace.productId}`,
        origin: "executed-sandbox",
        createdAt,
        body: { ...trace, client: sample },
      }),
    );
  }

  for (const log of telemetry.logs) {
    index.push(
      putEvidence(store, {
        id: `log:${run.id}:${log.id}`,
        runId: run.id,
        type: "log",
        title: `${log.level} ${log.id} · ${log.message}`,
        origin: "executed-sandbox",
        createdAt,
        body: log,
      }),
    );
  }

  run.evidence = index;
  return index.map((item) => item.id);
}

function storeOutageEvidence(store: DemoStore, run: RunRecord, telemetry: Telemetry) {
  const createdAt = now();
  const index = [];
  if (run.outage) {
    index.push(
      putEvidence(store, {
        id: `metric:${run.id}:incident`,
        runId: run.id,
        type: "metric",
        title: "Outage aggregate",
        origin: "executed-sandbox",
        createdAt,
        body: {
          note: "Computed from requests issued while the catalog was in unavailable mode.",
          phase: "outage",
          profile: run.profile,
          summary: run.outage.summary,
        },
      }),
    );
  }
  for (const log of telemetry.logs) {
    index.push(
      putEvidence(store, {
        id: `log:${run.id}:${log.id}`,
        runId: run.id,
        type: "log",
        title: `${log.level} ${log.id} · ${log.message}`,
        origin: "executed-sandbox",
        createdAt,
        body: log,
      }),
    );
  }
  run.evidence = index;
  return index.map((item) => item.id);
}

export async function engageRemediatedMode(catalogUrl: string, run: RunRecord, acceptanceDetail: string) {
  addTimeline(run, "Engineer confirmation accepted", acceptanceDetail);
  if (run.diagnosis?.proposal) run.diagnosis.proposal.status = "applied_in_sandbox";
  await catalogJson(catalogUrl, "/admin/mode", {
    method: "POST",
    body: JSON.stringify({ mode: "remediated" }),
  });
  addTimeline(
    run,
    "Sandbox mode set to remediated",
    "The catalog copies the product under a short lock and runs the same timed read after release. Baseline uses this same placement.",
  );
}

export async function executeValidationLoad(catalogUrl: string, run: RunRecord) {
  if (!run.incident) {
    throw new Error("Incident samples are missing, so the sandbox check has nothing to compare.");
  }
  run.validation = await collectPhase({
      run,
      catalogUrl,
      phase: "validation",
      profile: scenario.load,
    });
    run.validationResult = interpretValidation(run.incident.summary, run.validation.summary);
    addTimeline(run, "Sandbox check interpreted", run.validationResult.statement);
    run.status = "validated";
  run.validationError = null;
  run.progress = null;
  run.finishedAt = now();
  return run;
}

export async function runValidation(options: { catalogUrl: string; run: RunRecord }) {
  const { catalogUrl, run } = options;
  try {
    if (!run.diagnosis?.proposal) {
      throw new Error("This run has no sandbox proposal to apply.");
    }
    await engageRemediatedMode(
      catalogUrl,
      run,
      "The page sent APPLY_SANDBOX_REMEDIATION. Following calls stay on the local catalog process.",
    );
    return await executeValidationLoad(catalogUrl, run);
  } catch (error) {
    run.status = "diagnosed";
    run.validationError = error instanceof Error ? error.message : "Sandbox validation failed.";
    run.progress = null;
    addTimeline(run, "Sandbox check stopped", run.validationError);
    return run;
  }
}

export async function resetSandbox(catalogUrl: string) {
  await catalogJson(catalogUrl, "/admin/reset", { method: "POST" });
}
