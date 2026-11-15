import assert from "node:assert/strict";
import test from "node:test";
import { IDE_TOOL_NAMES } from "../../services/mcp/ide-server.ts";
import { runFixtureAgent, type Fixture } from "../../src/ide/fixture-agent.ts";
import { capVerdict } from "../../src/ide/machine.ts";
import { LIMITS } from "../../src/ide/requests.ts";
import { ACME, connect, deps, fixture, tempStore } from "./helpers.ts";

type Report = {
  verdict: string;
  reason: string;
  evidence: { provenance: string; reportedTool: string | null; rawSha256: string | null }[];
  located: { path: string; startLine: number | null }[];
  gaps: { kind: string; required: boolean }[];
  missingInformation: string[];
  couldNotVerify: string[];
  whatWouldHelp: string[];
  timeline: { id: string; status: string }[];
  provenanceNote: string | null;
};

async function run(f: Fixture) {
  const { store } = tempStore();
  const d = deps(store);
  const agent = await connect(d, ACME);
  const out = await runFixtureAgent(agent.call, f);
  return { ...out, store, d, agent, report: (out.final as { report?: Report }).report! };
}

test("the IDE server registers only the high-level nexus_* tools, the investigate prompt and the report resource", async () => {
  const { store } = tempStore();
  const { client } = await connect(deps(store), ACME);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, [...IDE_TOOL_NAMES].sort());
  for (const demo of ["get_ticket", "measure_service", "diagnose", "apply_sandbox_remediation", "validate"]) assert.equal(tools.includes(demo), false);
  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  assert.deepEqual(prompts, ["investigate"]);
  const prompt = await client.getPrompt({ name: "investigate", arguments: { ticket: "PAY-1423" } });
  const text = (prompt.messages[0].content as { text: string }).text;
  assert.match(text, /nexus_start_investigation/);
  assert.match(text, /raw, unmodified/);
  assert.match(text, /Never call nexus_approve/);
  const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);
  assert.deepEqual(templates, ["nexus://investigations/{id}/report"]);
});

test("a full fixture run reaches a report that cites client-supplied evidence", async () => {
  const { report, final, transcript, store, investigationId } = await run(fixture("pay-1423.json"));
  assert.equal((final as { status: string }).status, "done");
  assert.equal(report.verdict, "not_enough_evidence");
  assert.ok(report.evidence.length >= 8);
  assert.ok(report.evidence.every((e) => e.provenance === "client-supplied" && e.rawSha256 && e.reportedTool));
  assert.match(report.provenanceNote ?? "", /supplied by the IDE agent/);
  const located = report.located.find((l) => l.path === "src/checkout/reserve.ts");
  assert.ok(located?.startLine, "the suspect file is located with a line range");
  assert.deepEqual(report.timeline.map((s) => s.status), ["done", "skipped", "done", "done", "done", "skipped", "skipped"]);
  assert.ok(transcript.length <= LIMITS.maxRounds + 1);
  // Hashes and tool names are kept for audit; no ticket body is in the audit log.
  const audit = store.auditFor(ACME, investigationId);
  assert.ok(audit.some((a) => a.action === "investigation.start"));
  assert.ok(audit.filter((a) => a.action === "evidence.round").every((a) => JSON.parse(a.detail_json).rawSha256));
  assert.equal(audit.some((a) => a.detail_json.includes("Lock wait timeout")), false);
  assert.ok(store.submissions(investigationId!).every((s) => s.status === "unavailable" || s.raw_sha256));
});

test("a required ticket that is unavailable ends as Needs more information, never a guess", async () => {
  const { report } = await run({ ticketRef: "PAY-9", results: { ticket: { unavailable: "No Jira tool is connected" } } });
  assert.equal(report.verdict, "needs_more_information");
  assert.match(report.missingInformation[0], /Connect your ticket tool/);
  assert.ok(report.gaps.some((g) => g.kind === "ticket" && g.required));
  assert.deepEqual(report.timeline.map((s) => s.status), ["failed", "skipped", "skipped", "skipped", "skipped", "skipped", "skipped"]);
});

test("missing optional evidence ends honestly with what to connect", async () => {
  const f = fixture("pay-1423.json");
  const { report } = await run({ ...f, capabilities: ["ticket"], repos: [], results: { ticket: f.results.ticket } });
  assert.equal(report.verdict, "not_enough_evidence");
  assert.ok(report.whatWouldHelp.some((h) => /list_commits/.test(h)));
  assert.ok(report.couldNotVerify.some((c) => /Commits: not connected/.test(c)));
});

test("a malformed result is rejected and asked for again once", async () => {
  const f = fixture("pay-1423.json");
  const good = await run({ ...f, capabilities: ["ticket"], results: { ticket: [{ output: "garbage with no key" }, f.results.ticket as never] } });
  assert.equal(good.report.verdict, "not_enough_evidence");
  const rejected = good.transcript.flatMap((t) => (t.result.rejected as { id: string }[] | undefined) ?? []);
  assert.deepEqual(rejected.map((r) => r.id), ["r1-ticket"]);
  const retried = good.transcript[1].result.requests as { id: string; instruction: string }[];
  assert.equal(retried[0].id, "r2-ticket-again");
  assert.match(retried[0].instruction, /previous result was rejected/);

  const bad = await run({ ...f, capabilities: ["ticket"], results: { ticket: { output: "still garbage" } } });
  assert.equal(bad.report.verdict, "needs_more_information");
  assert.equal(bad.transcript.length, 3, "start, first answer, one retry: never a third ask");
});

test("the round cap is enforced: later requests are dropped and recorded as gaps", async () => {
  const f = fixture("pay-1423.json");
  const { report, transcript } = await run({
    ...f,
    results: {
      ...f.results,
      ticket: [{ output: "no key here" }, f.results.ticket as never],
      code_search: [{ output: "not a list" }, f.results.code_search as never],
    },
  });
  const rounds = transcript.map((t) => t.result.progress as { round: number } | undefined).filter(Boolean).map((p) => p!.round);
  assert.ok(Math.max(...rounds) <= LIMITS.maxRounds);
  assert.ok(report.couldNotVerify.some((c) => /after 4 rounds/.test(c)));
  assert.ok(report.gaps.some((g) => g.kind === "file"));
});

test("evidence for an unknown request id is refused and changes nothing", async () => {
  const { store } = tempStore();
  const agent = await connect(deps(store), ACME);
  const start = await agent.call("nexus_start_investigation", { ticketRef: "PAY-1423" });
  const res = await agent.call("nexus_submit_evidence", { investigationId: start.investigationId, results: [{ id: "r9-file", status: "ok", output: "x" }] });
  assert.equal(res.status, "needs_evidence");
  assert.match(res.rejected[0].error, /no open request/);
  assert.equal(res.requests.length, 1);
  assert.equal(res.requests[0].id, "r1-ticket");
});

test("oversized and malformed submissions are rejected", async () => {
  const { store } = tempStore();
  const agent = await connect(deps(store), ACME);
  const start = await agent.call("nexus_start_investigation", { ticketRef: "PAY-1423" });
  const big = await agent.call("nexus_submit_evidence", { investigationId: start.investigationId, results: [{ id: "r1-ticket", status: "ok", output: "x".repeat(LIMITS.maxSubmissionBytes + 10) }] });
  assert.equal(big.__error, true);
  assert.equal(big.code, "too_large");
  const bad = await agent.call("nexus_start_investigation", { ticketRef: "not a ticket; rm -rf /" });
  assert.equal(bad.__error, true);
  assert.equal(bad.code, "invalid");
});

test("the provenance rule: client-supplied proof can never make Diagnosed and verified", () => {
  assert.equal(capVerdict("diagnosed_verified", [{ provenance: "client-supplied", kind: "code" }]), "diagnosed");
  assert.equal(capVerdict("diagnosed_verified", [{ provenance: "nexus-executed", kind: "sandbox" }, { provenance: "client-supplied", kind: "logs" }]), "diagnosed");
  assert.equal(capVerdict("diagnosed_verified", []), "diagnosed");
  assert.equal(capVerdict("diagnosed_verified", [{ provenance: "nexus-executed", kind: "sandbox" }]), "diagnosed_verified");
  assert.equal(capVerdict("not_enough_evidence", [{ provenance: "client-supplied", kind: "code" }]), "not_enough_evidence");
});
