// The seeded demo company in IDE mode: the ticket comes from the (fixture) IDE
// agent, and the measurement, diagnosis and proof run in Nexus's own sandbox
// with the frozen engine. Results must match the golden snapshots.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { before } from "node:test";
import { runFixtureAgent } from "../../src/ide/fixture-agent.ts";
import { createDemoSandbox } from "../../src/ide/sandbox-demo.ts";
import { CONFIRMATION_PHRASE } from "../../src/lib/diagnosis.ts";
import { ACME, connect, deps, fixture, freePort, tempStore } from "./helpers.ts";

type R = {
  verdict: string;
  causes: { detectorId: string; cause: string; facts: Record<string, unknown>; evidence: { provenance: string }[] }[];
  suggestedFix: { title: string } | null;
  validation: { status: string; statement: string; before: unknown; after: unknown };
  missingInformation: string[];
};

const golden = (id: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/golden/snapshots", `${id}.json`), "utf8"));

let sandbox: ReturnType<typeof createDemoSandbox>;
before(async () => {
  const port = await freePort();
  sandbox = createDemoSandbox({ catalogUrl: `http://127.0.0.1:${port}`, projectRoot: process.cwd() });
});

function jiraIssue(id: "NEX-5" | "NEX-6" | "NEX-7") {
  const nex5 = fixture("nex-5.json").results.ticket as { output: { fields: Record<string, unknown> } };
  const text: Record<string, [string, string, string]> = {
    "NEX-5": ["Checkout p95 latency spikes to over 600 ms under load", nex5.output.fields.description as string, "High"],
    "NEX-6": ["Catalog returns 503 for all product pages", "Simulated sandbox data. Expected agent outcome: abstain and escalate the outage. No customer trace is attached.", "Highest"],
    "NEX-7": ["Some users see wrong cart totals", "Simulated sandbox data. Expected agent outcome: ask for more information. Evidence is thin. No traces, logs, or reproduction are attached.", "Medium"],
  };
  const [summary, description, priority] = text[id];
  return { key: id, fields: { ...nex5.output.fields, summary, description, priority: { name: priority } } };
}

test("NEX-5: the engine's ticket view equals the golden snapshot", async () => {
  const issue = jiraIssue("NEX-5");
  const ticket = await sandbox.engineTicket("NEX-5", {
    key: "NEX-5",
    source: "jira",
    title: issue.fields.summary,
    description: issue.fields.description as string,
    status: null,
    priority: "High",
    labels: ["nexus-demo"],
    components: [],
    environment: null,
    versions: [],
    createdAt: "2026-11-01T10:00:00.000+0530",
    updatedAt: null,
    comments: [],
    links: [],
    attachments: [],
    url: null,
  }, { issueType: "Defect test", projectKey: "NEX", reporter: "Demo reporter" });
  assert.deepEqual(ticket, golden("NEX-5").ticket);
});

test("NEX-5 end to end: lock contention, then approval and sandbox proof give Diagnosed and verified", { timeout: 120_000 }, async () => {
  const { store } = tempStore();
  const d = deps(store, { sandbox, approvalGapMs: 0 });
  const agent = await connect(d, ACME, "Visual Studio Code");
  const { final, investigationId } = await runFixtureAgent(agent.call, fixture("nex-5.json"));
  const f = final as { status: string; report: R };
  assert.equal(f.status, "awaiting_approval");
  const g = golden("NEX-5");
  assert.equal(g.diagnosis.outcome, "lock_contention");
  assert.equal(f.report.verdict, "diagnosed");
  assert.equal(f.report.causes[0].detectorId, "lock-contention");
  assert.equal(f.report.causes[0].cause, g.diagnosis.title);
  assert.equal(f.report.causes[0].facts.engineOutcome, g.diagnosis.outcome);
  assert.equal(f.report.suggestedFix.title, g.proposal.proposal.title);
  assert.ok(f.report.causes[0].evidence.every((e: { provenance: string }) => e.provenance === "nexus-executed"));
  assert.equal(f.report.validation.status, "not_validated");

  // The IDE agent cannot approve, even with the right phrase.
  const byAgent = await agent.call("nexus_approve", { investigationId, confirmation: CONFIRMATION_PHRASE });
  assert.equal(byAgent.__error, true);
  assert.match(byAgent.error, /only from the Nexus extension/);

  const ext = await connect(d, ACME, "nexus-vscode");
  const empty = await ext.call("nexus_approve", { investigationId, confirmation: "" });
  assert.equal(empty.__error, true);
  const wrong = await ext.call("nexus_approve", { investigationId, confirmation: "yes please" });
  assert.equal(wrong.__error, true);
  assert.equal((await ext.call("nexus_get_status", { investigationId })).phase, "awaiting_approval");

  const ok = await ext.call("nexus_approve", { investigationId, confirmation: CONFIRMATION_PHRASE });
  assert.equal(ok.status, "approved");
  assert.equal(ok.report.verdict, "diagnosed_verified");
  assert.equal(ok.report.validation.status, "validated");
  assert.equal(ok.report.validation.statement, g.validation.statement);
  assert.ok(ok.report.validation.before && ok.report.validation.after);
  const audit = store.auditFor(ACME, investigationId).map((a) => a.action);
  for (const a of ["investigation.start", "evidence.round", "approval.denied", "approval.approved"]) assert.ok(audit.includes(a), a);
});

test("approval cannot arrive together with an evidence submission", { timeout: 120_000 }, async () => {
  const { store } = tempStore();
  const d = deps(store, { sandbox, approvalGapMs: 60_000 });
  const agent = await connect(d, ACME, "Visual Studio Code");
  const { investigationId } = await runFixtureAgent(agent.call, fixture("nex-5.json"));
  const ext = await connect(d, ACME, "nexus-vscode");
  const res = await ext.call("nexus_approve", { investigationId, confirmation: CONFIRMATION_PHRASE });
  assert.equal(res.__error, true);
  assert.match(res.error, /cannot arrive together with an evidence submission/);
});

test("NEX-6: the outage abstains; NEX-7: thin evidence asks for more; NI-1042 needs no ticket fetch", { timeout: 120_000 }, async () => {
  const { store } = tempStore();
  const d = deps(store, { sandbox });
  const agent = await connect(d, ACME);
  const six = await runFixtureAgent(agent.call, { ticketRef: "NEX-6", capabilities: ["ticket"], results: { ticket: { output: jiraIssue("NEX-6") } } });
  const r6 = (six.final as { report: R }).report;
  assert.equal(golden("NEX-6").diagnosis.outcome, "service_unavailable");
  assert.equal(r6.verdict, "not_enough_evidence");
  assert.equal(r6.causes.length, 0);
  assert.equal(r6.suggestedFix, null);

  const seven = await runFixtureAgent(agent.call, { ticketRef: "NEX-7", capabilities: ["ticket"], results: { ticket: { output: jiraIssue("NEX-7") } } });
  const r7 = (seven.final as { report: R }).report;
  assert.equal(r7.verdict, "needs_more_information");
  assert.ok(r7.missingInformation.length >= 2);

  const seeded = await agent.call("nexus_start_investigation", { ticketRef: "NI-1042" });
  assert.equal(seeded.status, "awaiting_approval");
  assert.equal(seeded.report.causes[0].cause, golden("NI-1042").diagnosis.title);
  assert.equal(seeded.progress.sources.length, 0, "the seeded ticket is Nexus's own; nothing was requested");
});
