import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import net from "node:net";
import test from "node:test";

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
  const child = spawn(process.execPath, ["services/catalog/server.mjs"], {
    env: { ...process.env, CATALOG_PORT: String(port), CATALOG_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const catalogUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${catalogUrl}/health`)).ok) return { child, catalogUrl };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  child.kill();
  throw new Error("catalog did not start");
}

function startMcp(catalogUrl: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "services/mcp/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CATALOG_URL: catalogUrl, JIRA_EMAIL: "", JIRA_API_TOKEN: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending: Array<(message: { result?: { content?: Array<{ text: string }> }; error?: unknown }) => void> = [];
  let nextId = 1;
  const lines = createInterface({ input: child.stdout! });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line) as { id?: number; result?: { content?: Array<{ text: string }> } };
    if (message.id == null) return;
    const waiter = pending.shift();
    if (waiter) waiter(message);
  });
  function request(method: string, params: Record<string, unknown>) {
    const id = nextId++;
    return new Promise<{ result?: { content?: Array<{ text: string }> }; error?: unknown }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 30000);
      pending.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  async function call(name: string, args: Record<string, unknown>) {
    const response = await request("tools/call", { name, arguments: args });
    if (!response.result?.content?.[0]?.text) {
      throw new Error(`${name} failed: ${JSON.stringify(response.error ?? response)}`);
    }
    return JSON.parse(response.result.content[0].text) as Record<string, unknown>;
  }
  return { child, request, call };
}

test("MCP client runs NI-1042 to a cause, abstains on outage, and refuses a bad approval", { timeout: 60_000 }, async (t) => {
  const catalog = await startCatalog();
  const mcp = startMcp(catalog.catalogUrl);
  const stop = (child: ChildProcess) => {
    if (!child.killed) child.kill("SIGTERM");
  };
  t.after(() => {
    stop(mcp.child);
    stop(catalog.child);
  });
  await mcp.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "nexus-workflow", version: "0.0.0" },
  });
  mcp.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const ticket = await mcp.call("get_ticket", { ticketId: "NI-1042" });
  assert.equal(ticket.source, "seeded");
  const measured = await mcp.call("measure_service", { ticketId: "NI-1042", scenario: "lock" });
  assert.equal(measured.ok, true);
  const run = measured.run as { id: string };
  const evidence = await mcp.call("collect_evidence", { runId: run.id });
  assert.equal(evidence.ok, true);
  const diagnosis = await mcp.call("diagnose", { runId: run.id });
  const view = diagnosis.diagnosis as { outcome: string; abstain: boolean; confidence: string };
  assert.equal(view.outcome, "lock_contention");
  assert.equal(view.abstain, false);
  assert.equal(view.confidence, "high");
  const proposal = await mcp.call("propose_remediation", { runId: run.id });
  assert.ok(proposal.proposal);
  const refused = await mcp.call("apply_sandbox_remediation", { runId: run.id, approvalToken: "not-the-phrase" });
  assert.equal(refused.applied, false);
  assert.equal(refused.status, 400);

  const outage = await mcp.call("measure_service", { scenario: "outage" });
  assert.equal(outage.ok, true);
  const outageRun = outage.run as { id: string };
  const outageDiagnosis = await mcp.call("diagnose", { runId: outageRun.id });
  const outageView = outageDiagnosis.diagnosis as { abstain: boolean; outcome: string; proposal: unknown };
  assert.equal(outageView.abstain, true);
  assert.equal(outageView.outcome, "service_unavailable");
  assert.equal(outageView.proposal, null);
});
