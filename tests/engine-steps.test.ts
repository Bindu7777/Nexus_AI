import assert from "node:assert/strict";
import test from "node:test";
import { diagnose } from "../src/lib/diagnosis.ts";
import {
  applySandboxRemediation,
  presentDiagnosis,
  proposeRemediation,
  validateRemediation,
} from "../src/lib/engine.ts";
import { checkNarrative } from "../src/lib/narrative.ts";
import { createStore } from "../src/lib/store.ts";
import type { RunRecord } from "../src/lib/types.ts";
import { resolveTarget } from "../src/lib/targets.ts";

function runWith(outcome: RunRecord["diagnosis"]): RunRecord {
  return {
    id: "run_test",
    scenario: "lock",
    status: "diagnosed",
    startedAt: "2026-11-09T00:00:00.000Z",
    finishedAt: "2026-11-09T00:00:01.000Z",
    progress: null,
    timeline: [],
    tail: [],
    baseline: null,
    incident: null,
    validation: null,
    outage: null,
    diagnosis: outcome,
    validationResult: null,
    validationError: null,
    error: null,
    evidence: [],
    profile: { requests: 8, concurrency: 4, timeoutMs: 2000, workMs: 80 },
  } as RunRecord;
}

test("astronomy shop target is refused", () => {
  const target = resolveTarget("astronomy-shop");
  assert.equal(target.ok, false);
  if (!target.ok) assert.match(target.message, /not implemented/);
});

test("outage diagnosis abstains and proposes nothing", () => {
  const diagnosis = diagnose({
    scenario: "outage",
    runId: "run_outage",
    workMs: 80,
    profile: { requests: 8, concurrency: 4, timeoutMs: 2000 },
    baseline: null,
    incident: {
      requests: 8,
      success: 0,
      errors: 8,
      timeouts: 0,
      latencyMs: null,
      lockWaitMs: null,
      lockHoldMs: null,
      maxQueueDepth: null,
    },
    incidentSamples: [],
    evidenceIds: [],
    warnLogs: [],
  });
  const store = createStore();
  const run = runWith(diagnosis);
  store.runs.set(run.id, run);
  const view = presentDiagnosis(run);
  assert.equal(view.abstain, true);
  assert.equal(view.confidence, "none");
  assert.equal(view.proposal, null);
  const proposal = proposeRemediation(run.id, store);
  assert.equal(proposal.proposal, null);
});

test("apply_sandbox_remediation refuses a missing or wrong token without calling the catalog", async () => {
  const store = createStore();
  const missing = await applySandboxRemediation({ runId: "missing", approvalToken: "APPLY_SANDBOX_REMEDIATION", store });
  assert.equal(missing.applied, false);
  assert.equal(missing.status, 404);

  const diagnosis = diagnose({
    scenario: "lock",
    runId: "run_gate",
    workMs: 80,
    profile: { requests: 32, concurrency: 8, timeoutMs: 5000 },
    baseline: {
      requests: 32,
      success: 32,
      errors: 0,
      timeouts: 0,
      latencyMs: { count: 32, min: 80, p50: 85, p95: 90, max: 100, mean: 86 },
      lockWaitMs: { count: 32, min: 0, p50: 0, p95: 0, max: 0, mean: 0 },
      lockHoldMs: null,
      maxQueueDepth: 0,
    },
    incident: {
      requests: 32,
      success: 32,
      errors: 0,
      timeouts: 0,
      latencyMs: { count: 32, min: 80, p50: 400, p95: 640, max: 700, mean: 500 },
      lockWaitMs: { count: 32, min: 0, p50: 300, p95: 560, max: 600, mean: 280 },
      lockHoldMs: null,
      maxQueueDepth: 7,
    },
    incidentSamples: [],
    evidenceIds: [],
    warnLogs: [],
  });
  const run = runWith(diagnosis);
  store.runs.set(run.id, run);
  const wrong = await applySandboxRemediation({ runId: run.id, approvalToken: "please", store });
  assert.equal(wrong.applied, false);
  assert.equal(wrong.status, 400);
  assert.equal(run.diagnosis?.proposal?.status, "not_applied");
  const early = await validateRemediation({ runId: run.id, store });
  assert.equal(early.ok, false);
  if (!early.ok) assert.match(early.message, /APPLY_SANDBOX_REMEDIATION/);
});

test("a model narrative that invents a saving is rejected by the guardrail", () => {
  const view = presentDiagnosis(null);
  const bad = checkNarrative("This change is 40% faster and production-ready.", {
    abstain: view.abstain,
    outcome: "lock_contention",
  });
  assert.equal(bad.aligned, false);
  const ok = checkNarrative("The sandbox rules abstained because the service was unavailable.", {
    abstain: true,
    outcome: "service_unavailable",
  });
  assert.equal(ok.aligned, true);
});
