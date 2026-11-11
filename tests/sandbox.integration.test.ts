import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { CONFIRMATION_PHRASE, assertCanValidate } from "../src/lib/diagnosis.ts";
import { createRun, runInvestigation, runValidation } from "../src/lib/investigate.ts";
import { createStore } from "../src/lib/store.ts";

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function startCatalog() {
  const port = await freePort();
  let logs = "";
  const child: ChildProcess = spawn(process.execPath, ["services/catalog/server.mjs"], {
    env: { ...process.env, CATALOG_PORT: String(port), CATALOG_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  const catalogUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${catalogUrl}/health`);
      if (response.ok) return { child, catalogUrl, logs: () => logs };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  child.kill("SIGTERM");
  throw new Error(`Catalog did not start.\n${logs}`);
}

function stop(child: ChildProcess) {
  if (!child.killed) child.kill("SIGTERM");
}

test("sandbox investigation collects real contention, cites stored records, and gates validation", { timeout: 60_000 }, async () => {
  const catalog = await startCatalog();
  try {
    const store = createStore();
    const run = createRun("lock");
    store.runs.set(run.id, run);
    await runInvestigation({ catalogUrl: catalog.catalogUrl, store, run });

    assert.equal(run.status, "diagnosed", run.error ?? "investigation failed");
    assert.ok(run.baseline);
    assert.ok(run.incident);
    assert.ok(run.diagnosis);
    const baselineWait = run.baseline.summary.lockWaitMs?.mean ?? 999;
    const incidentWait = run.incident.summary.lockWaitMs?.mean ?? 0;
    const baselineP95 = run.baseline.summary.latencyMs?.p95 ?? 0;
    const incidentP95 = run.incident.summary.latencyMs?.p95 ?? 0;
    assert.ok(baselineWait < 15, `baseline mean lock wait ${baselineWait}`);
    assert.ok(incidentWait > 40, `incident mean lock wait ${incidentWait}`);
    assert.ok(incidentP95 > baselineP95 + 40, `p95 baseline ${baselineP95} incident ${incidentP95}`);
    assert.ok((run.incident.summary.maxQueueDepth ?? 0) >= 3);
    assert.equal(run.diagnosis.outcome, "lock_contention");
    assert.equal(run.diagnosis.method, "rule-based-sandbox");
    assert.equal(run.diagnosis.proposal?.status, "not_applied");
    assert.match(run.diagnosis.summary, new RegExp(String(incidentP95)));

    for (const citation of run.diagnosis.citations) {
      const record = store.evidence.get(citation.evidenceId);
      assert.ok(record, `missing evidence ${citation.evidenceId}`);
      assert.equal(record.runId, run.id);
    }
    const traceCitation = run.diagnosis.citations.find((citation) => citation.evidenceId.startsWith("trace:"));
    assert.ok(traceCitation);
    const trace = store.evidence.get(traceCitation.evidenceId);
    const traceBody = trace?.body as { traceId?: string; spans?: { name: string }[] };
    assert.ok(run.incident.samples.some((sample) => sample.traceId === traceBody.traceId));
    assert.ok(traceBody.spans?.some((span) => span.name === "catalog.lock.wait"));

    const source = store.evidence.get(`source:${run.id}:readProduct`);
    const sourceBody = source?.body as { excerpt?: string; startLine?: number; path?: string };
    assert.match(sourceBody.excerpt ?? "", /inside-lock/);
    const disk = fs.readFileSync(path.join(process.cwd(), "services/catalog/server.mjs"), "utf8").split(/\r?\n/);
    const excerptLines = (sourceBody.excerpt ?? "").split("\n");
    assert.equal(disk[(sourceBody.startLine ?? 1) - 1], excerptLines[0]);

    const blocked = assertCanValidate(run, "looks-good");
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.status, 400);
    run.status = "diagnosed";
    await runValidation({ catalogUrl: catalog.catalogUrl, run });
    assert.equal(run.status, "validated", run.validationError ?? "validation failed");
    assert.equal(run.validationResult?.outcome, "sandbox_improved");
    assert.equal(run.diagnosis.proposal?.status, "applied_in_sandbox");
    const remediatedWait = run.validation?.summary.lockWaitMs?.mean ?? 999;
    assert.ok(remediatedWait < incidentWait / 2, `remediated mean lock wait ${remediatedWait}`);

    const health = await fetch(`${catalog.catalogUrl}/health`).then((response) => response.json());
    assert.equal(health.mode, "remediated");

    const outage = createRun("outage");
    await runInvestigation({ catalogUrl: catalog.catalogUrl, store, run: outage });
    assert.equal(outage.status, "diagnosed");
    assert.equal(outage.diagnosis?.outcome, "service_unavailable");
    assert.equal(outage.diagnosis?.proposal, null);
    assert.equal(outage.outage?.summary.errors, outage.outage?.summary.requests);
    const outageGate = assertCanValidate(outage, CONFIRMATION_PHRASE);
    assert.equal(outageGate.ok, false);

    const snapshot = {
      baseline: run.baseline.summary,
      incident: run.incident.summary,
      validation: run.validation?.summary,
      diagnosis: run.diagnosis.outcome,
      validationOutcome: run.validationResult?.outcome,
      outageErrors: outage.outage?.summary.errors,
    };
    fs.writeFileSync("/tmp/nexus-demo-measurements.json", JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    stop(catalog.child);
  }
});

test("an unreachable catalog fails the investigation without a diagnosis", { timeout: 20_000 }, async () => {
  const store = createStore();
  const run = createRun("lock");
  await runInvestigation({ catalogUrl: "http://127.0.0.1:9", store, run });
  assert.equal(run.status, "failed");
  assert.match(run.error ?? "", /not reachable/);
  assert.equal(run.diagnosis, null);
});
