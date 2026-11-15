import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discover, renderDetectors } from "../../scripts/build-connector-registry.mjs";
import { diagnose } from "../../src/lib/diagnosis.ts";
import { createRun, runInvestigation } from "../../src/lib/investigate.ts";
import { scenario } from "../../src/lib/scenario.ts";
import { summarize } from "../../src/lib/stats.ts";
import { createStore } from "../../src/lib/store.ts";
import type { Sample } from "../../src/lib/types.ts";
import lockContention, { lockDiagnosis } from "../../src/investigation/detectors/defs/lock-contention.ts";
import { DETECTORS } from "../../src/investigation/detectors/index.generated.ts";
import { checkDetector, createDetectorRegistry, rankFindings, runDetectors, type DetectorRun } from "../../src/investigation/detectors/registry.ts";
import { engineRecordToEvidence, engineRunEvidence, loadMeasurementsFromRun } from "../../src/investigation/engine-adapter.ts";
import { defineDetector, type DetectorContext, type EvidenceItem, type Finding, type LoadMeasurements } from "../../src/investigation/types.ts";

const root = process.cwd();
const readJson = <T>(p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8")) as T;

type LockInputs = {
  baseline: Sample[];
  incident: Sample[];
  telemetry: { traceIds: string[]; logs: { id: string; level: string; mode: string; lockWaitMs: number | null }[] };
};
type OutageInputs = { outage: Sample[]; telemetry: { logs: { id: string }[] } };

/** The same inputs tests/golden/cases.ts gives the frozen engine. */
function goldenLock(runId: string): LoadMeasurements {
  const i = readJson<LockInputs>("tests/golden/inputs/lock.json");
  return {
    scenario: "lock",
    baseline: summarize(i.baseline),
    incident: summarize(i.incident),
    incidentSamples: i.incident,
    evidenceIds: [
      `metric:${runId}:baseline`,
      `metric:${runId}:incident`,
      `source:${runId}:readProduct`,
      ...i.telemetry.traceIds.map((t) => `trace:${t}`),
      ...i.telemetry.logs.map((l) => `log:${runId}:${l.id}`),
    ],
    warnLogs: i.telemetry.logs.filter((l) => l.mode === "incident" && l.level === "warn").map((l) => ({ id: l.id, lockWaitMs: typeof l.lockWaitMs === "number" ? l.lockWaitMs : null })),
    workMs: scenario.workMs,
    profile: scenario.load,
    runId,
  };
}
function goldenOutage(runId: string): LoadMeasurements {
  const i = readJson<OutageInputs>("tests/golden/inputs/outage.json");
  return {
    scenario: "outage",
    baseline: null,
    incident: summarize(i.outage),
    incidentSamples: i.outage,
    evidenceIds: [`metric:${runId}:incident`, ...i.telemetry.logs.map((l) => `log:${runId}:${l.id}`)],
    warnLogs: [],
    workMs: scenario.workMs,
    profile: scenario.outageLoad,
    runId,
  };
}
const asEvidence = (ids: string[]): EvidenceItem[] =>
  ids.map((ref) => ({ source: "demo-catalog", kind: "sandbox", ref, timestamp: null, retrievedAt: "", title: ref, excerpt: "", observation: "observed" }));
const ctxFor = (load?: LoadMeasurements): DetectorContext => ({ investigationId: "inv_test", evidence: asEvidence(load?.evidenceIds ?? []), load });

test("every registered detector satisfies the interface; placeholders are registered but never run", () => {
  for (const d of DETECTORS) assert.doesNotThrow(() => checkDetector(d), d.id);
  const runs = runDetectors(ctxFor());
  assert.equal(runs.find((r) => r.detectorId === "config-drift")?.status, "placeholder");
  assert.equal(runs.find((r) => r.detectorId === "dependency-regression")?.status, "placeholder");
  assert.throws(() => checkDetector({ ...lockContention, id: "bad", writeTicket: () => 1 } as never), /unexpected function "writeTicket"/);
  assert.throws(() => checkDetector({ ...lockContention, id: "bad2", requires: [] }), /requires/);
});

test("detector 1 reproduces the NI-1042 golden diagnosis exactly and finds the cause", () => {
  const golden = readJson<{ diagnosis: unknown }>("tests/golden/snapshots/NI-1042.json");
  const load = goldenLock("run_golden_NI-1042");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(lockDiagnosis(ctxFor(load)))), golden.diagnosis);
  const ctx = ctxFor(load);
  assert.equal(lockContention.applies(ctx), true);
  const result = lockContention.check(ctx);
  assert.equal(result.abstained, null);
  assert.equal(result.findings.length, 1);
  const f = result.findings[0];
  assert.equal(f.score, 1);
  assert.equal(f.facts.engineOutcome, "lock_contention");
  assert.equal(f.facts.rulesFired, 3);
  assert.ok(f.evidence.length >= 3, "cites the engine's evidence");
  assert.ok(f.evidence.every((e) => e.observation === "observed"));
  assert.equal(rankFindings(runDetectors(ctx))[0].kind, "cause");
});

test("detector 1 keeps the outage abstention exactly (NEX-6)", () => {
  const golden = readJson<{ diagnosis: { summary: string } }>("tests/golden/snapshots/NEX-6.json");
  const load = goldenOutage("run_golden_NEX-6");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(lockDiagnosis(ctxFor(load)))), golden.diagnosis);
  const result = lockContention.check(ctxFor(load));
  assert.equal(result.findings.length, 0);
  assert.equal(result.abstained, golden.diagnosis.summary);
});

test("a partial lock pattern is a weak lead, never a cause, and matches the engine's no_signal", () => {
  const load = goldenLock("run_partial");
  // Same incident as baseline: no rule fires → abstain, no finding.
  const flat = { ...load, incident: load.baseline, incidentSamples: readJson<LockInputs>("tests/golden/inputs/lock.json").baseline };
  const none = lockContention.check(ctxFor(flat));
  assert.equal(none.findings.length, 0);
  assert.match(none.abstained ?? "", /did not all fire|rule missed/);

  // Latency alone regresses: one rule fires.
  const base = load.baseline!;
  const latencyOnly = {
    ...load,
    incident: { ...base, latencyMs: { ...base.latencyMs!, p95: base.latencyMs!.p95 * 3 + 100 } },
  };
  const engine = diagnose({ ...latencyOnly });
  assert.equal(engine.outcome, "no_signal");
  const r = lockContention.check(ctxFor(latencyOnly));
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].score, engine.rules.filter((x) => x.fired).length / 3);
  assert.ok(r.findings[0].score < r.findings[0].threshold);
  assert.equal(rankFindings(runDetectors(ctxFor(latencyOnly)))[0].kind, "weak_lead");
});

test("without load measurements (a real company), detector 1 is skipped, not run", () => {
  const run = runDetectors(ctxFor()).find((r) => r.detectorId === "lock-contention")!;
  assert.equal(run.status, "skipped");
  assert.match(run.reason ?? "", /load measurements from a service that reports lock timings/);
});

test("ranking does not average across detectors, flags ties, and separates weak leads", () => {
  const f = (detectorId: string, score: number, threshold = 0.7): Finding => ({ detectorId, cause: detectorId, evidence: [], score, threshold, rule: "r", facts: {} });
  const runs: DetectorRun[] = [
    { detectorId: "a", name: "a", status: "ran", reason: null, result: { findings: [f("a", 0.9)], abstained: null } },
    { detectorId: "b", name: "b", status: "ran", reason: null, result: { findings: [f("b", 0.9)], abstained: null } },
    { detectorId: "c", name: "c", status: "ran", reason: null, result: { findings: [f("c", 0.4)], abstained: null } },
  ];
  const ranked = rankFindings(runs);
  assert.deepEqual(ranked.map((r) => [r.detectorId, r.kind, r.score]), [["a", "cause", 0.9], ["b", "cause", 0.9], ["c", "weak_lead", 0.4]]);
  assert.deepEqual(ranked[0].tiedWith, ["b"]);
  assert.deepEqual(ranked[1].tiedWith, ["a"]);
});

test("adding a detector is one file: the generator picks it up and the registry runs it", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-detectors-"));
  for (const n of ["lock-contention.ts", "made-up.ts", "README.md"]) fs.writeFileSync(path.join(tmp, n), "");
  const text = renderDetectors(discover(tmp));
  assert.match(text, /import def_made_up from "\.\/defs\/made-up";/);
  assert.doesNotMatch(text, /README/);
  assert.equal(
    fs.readFileSync(path.join(root, "src/investigation/detectors/index.generated.ts"), "utf8"),
    renderDetectors(discover(path.join(root, "src/investigation/detectors/defs"))),
    "generated index is in sync",
  );
  const madeUp = defineDetector({
    id: "made-up",
    name: "Made-up",
    category: "change",
    requires: ["commits"],
    status: "active",
    applies: (ctx) => ctx.evidence.some((e) => e.ref.startsWith("github:commit:")),
    check: (ctx) => ({
      findings: [{ detectorId: "made-up", cause: "A commit is present", evidence: ctx.evidence, score: 0.8, threshold: 0.5, rule: "commit present", facts: { commits: ctx.evidence.length } }],
      abstained: null,
    }),
    explain: (fnd) => fnd.facts,
  });
  const reg = createDetectorRegistry([...DETECTORS, madeUp]);
  const ctx: DetectorContext = { investigationId: "x", evidence: asEvidence(["github:commit:acme/web@abc1234"]) };
  const runs = runDetectors(ctx, reg);
  assert.equal(runs.find((r) => r.detectorId === "made-up")?.status, "ran");
  assert.equal(rankFindings(runs)[0].detectorId, "made-up");
});

// ---------- the adapter rebuilds the engine's exact inputs from a live demo run ----------

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

test("adapter: detector 1 on a live demo run equals the engine's own diagnosis", { timeout: 60_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["services/catalog/server.mjs"], { env: { ...process.env, CATALOG_PORT: String(port), CATALOG_HOST: "127.0.0.1" }, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 200; i += 1) {
      try {
        if ((await fetch(`${url}/health`)).ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 40));
      }
    }
    const store = createStore();
    const run = createRun("lock");
    store.runs.set(run.id, run);
    await runInvestigation({ catalogUrl: url, store, run });
    assert.ok(run.diagnosis);
    const load = loadMeasurementsFromRun(run, store)!;
    const evidence = engineRunEvidence(run, store);
    assert.equal(evidence.length, run.evidence.length);
    const source = evidence.find((e) => e.ref.startsWith("source:"))!;
    assert.equal(source.location?.path, "services/catalog/server.mjs");
    const ctx: DetectorContext = { investigationId: run.id, evidence, load };
    assert.deepStrictEqual(lockDiagnosis(ctx), run.diagnosis, "same inputs, same diagnosis");
    const out = lockContention.check(ctx);
    if (run.diagnosis.outcome === "lock_contention") assert.equal(out.findings[0].score, 1);
    // Every cited engine id resolves to an EvidenceItem.
    for (const c of run.diagnosis.citations) assert.ok(evidence.some((e) => e.ref === c.evidenceId), c.evidenceId);
    assert.equal(engineRecordToEvidence(store.evidence.get(run.evidence[0].id)!).observation, "observed");
  } finally {
    child.kill("SIGTERM");
  }
});
