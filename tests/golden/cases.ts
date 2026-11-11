// Golden cases: replay recorded measurement inputs through the frozen engine.
//
// Nothing here re-implements a rule. It feeds recorded samples into the
// existing summarize() / diagnose() / presentDiagnosis() / proposeRemediation()
// / assertCanValidate() / interpretValidation() and returns their outputs.
import fs from "node:fs";
import path from "node:path";
import { assertCanValidate, CONFIRMATION_PHRASE, diagnose, interpretValidation } from "../../src/lib/diagnosis.ts";
import { measureService, presentDiagnosis, proposeRemediation } from "../../src/lib/engine.ts";
import { createRun } from "../../src/lib/investigate.ts";
import { scenario } from "../../src/lib/scenario.ts";
import { readSourceRegion } from "../../src/lib/source-evidence.ts";
import { summarize } from "../../src/lib/stats.ts";
import { createStore } from "../../src/lib/store.ts";
import { resolveTicket } from "../../src/lib/tickets/resolve.ts";
import type { EngineTicket, Sample } from "../../src/lib/types.ts";

export const GOLDEN_CASES = ["NI-1042", "NEX-5", "NEX-6", "NEX-7"] as const;
export type GoldenCase = (typeof GOLDEN_CASES)[number];

const root = process.cwd();
const inputsDir = path.join(root, "tests/golden/inputs");
export const snapshotDir = path.join(root, "tests/golden/snapshots");

type LockInputs = {
  baseline: Sample[];
  incident: Sample[];
  validation: Sample[];
  telemetry: { traceIds: string[]; logs: { id: string; level: string; mode: string; lockWaitMs: number | null }[] };
};
type OutageInputs = { outage: Sample[]; telemetry: { logs: { id: string; level: string }[] } };

function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(inputsDir, name), "utf8")) as T;
}

// The demo Jira issues NEX-5/6/7 (label nexus-demo). Same field values as
// tests/jira-ticket.test.ts. No live Jira call is made.
const SHARED = { issuetype: { name: "Defect test" }, project: { key: "NEX", name: "NEXUS" }, labels: ["nexus-demo"] };
const JIRA_ISSUES: Record<string, unknown> = {
  "NEX-5": {
    key: "NEX-5",
    fields: {
      ...SHARED,
      summary: "Checkout p95 latency spikes to over 600 ms under load",
      description:
        "Simulated sandbox data. Expected agent outcome: find the cause. This is not a customer incident and it is not a measurement.",
      priority: { name: "High" },
      created: "2026-11-01T10:00:00.000+0530",
      reporter: { displayName: "Demo reporter" },
    },
  },
  "NEX-6": {
    key: "NEX-6",
    fields: {
      ...SHARED,
      summary: "Catalog returns 503 for all product pages",
      description:
        "Simulated sandbox data. Expected agent outcome: abstain and escalate the outage. No customer trace is attached.",
      priority: { name: "Highest" },
      created: "2026-11-01T10:05:00.000+0530",
      reporter: { displayName: "Demo reporter" },
    },
  },
  "NEX-7": {
    key: "NEX-7",
    fields: {
      ...SHARED,
      summary: "Some users see wrong cart totals",
      description:
        "Simulated sandbox data. Expected agent outcome: ask for more information. Evidence is thin. No traces, logs, or reproduction are attached.",
      priority: { name: "Medium" },
      created: "2026-11-01T10:10:00.000+0530",
      reporter: { displayName: "Demo reporter" },
    },
  },
};

const JIRA_ENV = {
  JIRA_BASE_URL: "https://nexusintelligence.atlassian.net",
  JIRA_EMAIL: "golden@example.invalid",
  JIRA_API_TOKEN: "golden-test-token",
  JIRA_PROJECT_KEY: "NEX",
};

/** Run fn with a replaying fetch for Jira and the given env vars; restores both. */
async function withRecordedJira<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(JIRA_ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET") !== "GET") throw new Error("golden: non-GET request");
    const match = url.match(/\/rest\/api\/3\/issue\/([^?]+)/);
    const issue = match ? JIRA_ISSUES[decodeURIComponent(match[1])] : undefined;
    if (!issue) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(issue), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function lockCase(ticket: EngineTicket, runId: string) {
  const inputs = readJson<LockInputs>("lock.json");
  const store = createStore();
  const run = createRun("lock");
  run.id = runId;
  run.ticket = ticket;
  const phase = (samples: Sample[]) => ({ startedAt: "", finishedAt: "", summary: summarize(samples), samples });
  run.baseline = phase(inputs.baseline);
  run.incident = phase(inputs.incident);

  const source = readSourceRegion("readProduct", root);
  store.evidence.set(`source:${runId}:readProduct`, {
    id: `source:${runId}:readProduct`,
    runId,
    type: "source",
    title: `Source ${source.path}:${source.startLine}-${source.endLine}`,
    origin: "workspace-source",
    createdAt: "",
    body: source,
  });
  const evidenceIds = [
    `metric:${runId}:baseline`,
    `metric:${runId}:incident`,
    `source:${runId}:readProduct`,
    ...inputs.telemetry.traceIds.map((id) => `trace:${id}`),
    ...inputs.telemetry.logs.map((log) => `log:${runId}:${log.id}`),
  ];
  const warnLogs = inputs.telemetry.logs
    .filter((log) => log.mode === "incident" && log.level === "warn")
    .map((log) => ({ id: log.id, lockWaitMs: typeof log.lockWaitMs === "number" ? log.lockWaitMs : null }));

  run.diagnosis = diagnose({
    scenario: "lock",
    baseline: run.baseline.summary,
    incident: run.incident.summary,
    incidentSamples: run.incident.samples,
    evidenceIds,
    warnLogs,
    workMs: scenario.workMs,
    profile: scenario.load,
    runId,
  });
  run.status = "diagnosed";
  store.runs.set(run.id, run);

  const view = presentDiagnosis(run, undefined, store);
  const proposal = proposeRemediation(run.id, store);
  const gate = {
    missingToken: assertCanValidate(run, undefined),
    wrongToken: assertCanValidate(run, "apply it please"),
    approvalPhrase: assertCanValidate(run, CONFIRMATION_PHRASE),
  };
  const validation = interpretValidation(run.incident.summary, summarize(inputs.validation));
  return {
    ticket,
    summaries: { baseline: run.baseline.summary, incident: run.incident.summary },
    diagnosis: run.diagnosis,
    view,
    proposal,
    gate,
    validation,
  };
}

function outageCase(ticket: EngineTicket, runId: string) {
  const inputs = readJson<OutageInputs>("outage.json");
  const store = createStore();
  const run = createRun("outage");
  run.id = runId;
  run.ticket = ticket;
  run.outage = { startedAt: "", finishedAt: "", summary: summarize(inputs.outage), samples: inputs.outage };
  const evidenceIds = [`metric:${runId}:incident`, ...inputs.telemetry.logs.map((log) => `log:${runId}:${log.id}`)];
  run.diagnosis = diagnose({
    scenario: "outage",
    baseline: null,
    incident: run.outage.summary,
    incidentSamples: run.outage.samples,
    evidenceIds,
    warnLogs: [],
    workMs: scenario.workMs,
    profile: scenario.outageLoad,
    runId,
  });
  run.status = "diagnosed";
  store.runs.set(run.id, run);
  return {
    ticket,
    summaries: { outage: run.outage.summary },
    diagnosis: run.diagnosis,
    view: presentDiagnosis(run, undefined, store),
    proposal: proposeRemediation(run.id, store),
    gate: {
      approvalPhrase: assertCanValidate(run, CONFIRMATION_PHRASE),
    },
  };
}

export async function computeGolden(id: GoldenCase): Promise<unknown> {
  const runId = `run_golden_${id}`;
  let result: unknown;
  if (id === "NI-1042") {
    result = lockCase(await resolveTicket("NI-1042", {}), runId);
  } else if (id === "NEX-5") {
    result = await withRecordedJira(async () => lockCase(await resolveTicket("NEX-5"), runId));
  } else if (id === "NEX-6") {
    result = await withRecordedJira(async () => outageCase(await resolveTicket("NEX-6"), runId));
  } else {
    // NEX-7: the engine must stop before measuring. measureService returns
    // without starting a load, so no catalog is needed.
    result = await withRecordedJira(async () => {
      const measured = await measureService({ ticketId: "NEX-7", store: createStore() });
      return { measureService: measured };
    });
  }
  // JSON round-trip drops undefined fields so the comparison is on what a client sees.
  return JSON.parse(JSON.stringify(result));
}
