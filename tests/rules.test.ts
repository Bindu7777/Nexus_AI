import assert from "node:assert/strict";
import test from "node:test";
import { assertCanValidate, CONFIRMATION_PHRASE, diagnose, interpretValidation } from "../src/lib/diagnosis.ts";
import { distribution, summarize } from "../src/lib/stats.ts";
import type { RunRecord, Sample, Summary } from "../src/lib/types.ts";

function summary(overrides: Partial<Summary> = {}): Summary {
  return {
    requests: 32,
    success: 32,
    errors: 0,
    timeouts: 0,
    latencyMs: { count: 32, min: 70, p50: 85, p95: 100, max: 120, mean: 88 },
    lockWaitMs: { count: 32, min: 0, p50: 0, p95: 1, max: 2, mean: 0.4 },
    lockHoldMs: { count: 32, min: 0, p50: 0.2, p95: 0.4, max: 0.5, mean: 0.2 },
    maxQueueDepth: 0,
    ...overrides,
  };
}

test("quantile uses the nearest rank and ignores empty input", () => {
  const result = distribution([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.ok(result);
  assert.equal(result.p50, 10);
  assert.equal(result.p95, 19);
  assert.equal(result.min, 1);
  assert.equal(result.max, 20);
  assert.equal(distribution([]), null);
});

test("summarize counts timeouts and lock samples separately", () => {
  const samples: Sample[] = [
    {
      index: 0,
      phase: "incident",
      productId: "orion-90",
      status: 200,
      latencyMs: 40,
      error: null,
      traceId: "t1",
      logId: "log_1",
      lockWaitMs: 10,
      lockHoldMs: 80,
      queueDepth: 2,
      serverDurationMs: 90,
      mode: "incident",
      completedAt: "2026-11-07T00:00:00.000Z",
    },
    {
      index: 1,
      phase: "incident",
      productId: "orion-90",
      status: 0,
      latencyMs: 2000,
      error: "timeout",
      traceId: null,
      logId: null,
      lockWaitMs: null,
      lockHoldMs: null,
      queueDepth: null,
      serverDurationMs: null,
      mode: null,
      completedAt: "2026-11-07T00:00:01.000Z",
    },
  ];
  const result = summarize(samples);
  assert.equal(result.requests, 2);
  assert.equal(result.success, 1);
  assert.equal(result.errors, 1);
  assert.equal(result.timeouts, 1);
  assert.equal(result.lockWaitMs?.count, 1);
  assert.equal(result.maxQueueDepth, 2);
});

test("lock rules fire only when latency, wait, and queue all move, and citations must exist", () => {
  const diagnosis = diagnose({
    scenario: "lock",
    runId: "run_test",
    workMs: 80,
    profile: { requests: 32, concurrency: 8, timeoutMs: 5000 },
    baseline: summary(),
    incident: summary({
      latencyMs: { count: 32, min: 80, p50: 300, p95: 640, max: 700, mean: 360 },
      lockWaitMs: { count: 32, min: 0, p50: 240, p95: 560, max: 600, mean: 280 },
      maxQueueDepth: 7,
    }),
    incidentSamples: [
      {
        index: 3,
        phase: "incident",
        productId: "lunar-atlas",
        status: 200,
        latencyMs: 640,
        error: null,
        traceId: "trace-real",
        logId: "log_9",
        lockWaitMs: 560,
        lockHoldMs: 80,
        queueDepth: 7,
        serverDurationMs: 640,
        mode: "incident",
        completedAt: "2026-11-07T00:00:02.000Z",
      },
    ],
    evidenceIds: ["metric:run_test:baseline", "metric:run_test:incident", "source:run_test:readProduct", "trace:trace-real"],
    warnLogs: [{ id: "log_missing", lockWaitMs: 500 }],
  });

  assert.equal(diagnosis.outcome, "lock_contention");
  assert.equal(diagnosis.method, "rule-based-sandbox");
  assert.equal(diagnosis.proposal?.status, "not_applied");
  assert.equal(diagnosis.rules.every((rule) => rule.fired), true);
  assert.ok(diagnosis.citations.some((citation) => citation.evidenceId === "trace:trace-real"));
  assert.equal(
    diagnosis.citations.some((citation) => citation.evidenceId === "log:run_test:log_missing"),
    false,
  );
  assert.match(diagnosis.summary, /640 ms/);
  assert.match(diagnosis.summary, /280 ms/);
});

test("a mostly failing load does not become a lock diagnosis", () => {
  const diagnosis = diagnose({
    scenario: "lock",
    runId: "run_down",
    workMs: 80,
    profile: { requests: 8, concurrency: 4, timeoutMs: 2000 },
    baseline: summary({ requests: 8, success: 8 }),
    incident: summary({ requests: 8, success: 0, errors: 8, latencyMs: null, lockWaitMs: null, maxQueueDepth: null }),
    incidentSamples: [],
    evidenceIds: [],
    warnLogs: [],
  });
  assert.equal(diagnosis.outcome, "service_unavailable");
  assert.equal(diagnosis.proposal, null);
});

test("close measurements produce no proposal", () => {
  const diagnosis = diagnose({
    scenario: "lock",
    runId: "run_quiet",
    workMs: 80,
    profile: { requests: 32, concurrency: 8, timeoutMs: 5000 },
    baseline: summary(),
    incident: summary(),
    incidentSamples: [],
    evidenceIds: [],
    warnLogs: [],
  });
  assert.equal(diagnosis.outcome, "no_signal");
  assert.equal(diagnosis.proposal, null);
  assert.equal(diagnosis.rules.some((rule) => !rule.fired), true);
});

test("validation comparison stays inconclusive when the sandbox did not improve", () => {
  const result = interpretValidation(summary(), summary());
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.method, "rule-based-sandbox");
});

test("engineer confirmation is required and is not enough for a non-diagnosis", () => {
  const run = {
    id: "run_gate",
    status: "diagnosed",
    diagnosis: { outcome: "lock_contention", proposal: { id: "p" } },
  } as RunRecord;
  assert.equal(assertCanValidate(run, "approve").ok, false);
  assert.equal(assertCanValidate(run, CONFIRMATION_PHRASE).ok, true);
  const missing = assertCanValidate(undefined, CONFIRMATION_PHRASE);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 404);
  const quiet = { ...run, diagnosis: { outcome: "no_signal", proposal: null } } as RunRecord;
  const rejected = assertCanValidate(quiet, CONFIRMATION_PHRASE);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.status, 409);
});
