import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const child = spawn(process.execPath, ["--import", "tsx", "services/mcp/server.ts"], {
  stdio: ["pipe", "pipe", "inherit"],
  cwd: process.cwd(),
});

const lines = createInterface({ input: child.stdout });
const pending = [];

lines.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const waiter = pending.shift();
  if (waiter) waiter(message);
});

function request(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${message.method}`)), 20000);
    pending.push((response) => {
      clearTimeout(timer);
      resolve(response);
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const report = {};
try {
  const initialized = await request({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nexus-inspect", version: "0.0.0" },
    },
  });
  report.server = initialized.result?.serverInfo ?? initialized;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const listed = await request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  report.tools = (listed.result?.tools ?? []).map((tool) => tool.name);
  const ticket = await request({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "get_ticket", arguments: { ticketId: "NI-1042" } },
  });
  report.seeded = JSON.parse(ticket.result.content[0].text).source;
  const sparse = await request({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "get_ticket", arguments: { ticketId: "NEX-4" } },
  });
  const sparseBody = JSON.parse(sparse.result.content[0].text);
  report.nex4 = { source: sparseBody.source, detail: sparseBody.detail, symptom: sparseBody.symptom };
  const refused = await request({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "apply_sandbox_remediation", arguments: { runId: "missing", approvalToken: "no" } },
  });
  report.refused = JSON.parse(refused.result.content[0].text);
  if (report.seeded !== "seeded") throw new Error("seeded ticket was not returned");
  if (report.nex4.source !== "jira-unconfigured") throw new Error(`expected unconfigured Jira, got ${report.nex4.source}`);
  if (report.nex4.symptom) throw new Error("unconfigured Jira response invented a symptom");
  if (report.refused.applied !== false) throw new Error("approval was not refused");
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill("SIGTERM");
}
