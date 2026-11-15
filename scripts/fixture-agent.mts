// Plays the IDE agent's part against the Nexus MCP server over stdio.
//   npx tsx scripts/fixture-agent.mts tests/ide/fixtures/pay-1423.json
// Starts its own server with the demo company and a throw-away database.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadFixture, runFixtureAgent } from "../src/ide/fixture-agent.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npx tsx scripts/fixture-agent.mts <fixture.json>");
  process.exit(2);
}
const fixture = loadFixture(file);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-fixture-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", "services/mcp/ide-server.ts"],
  env: { ...(process.env as Record<string, string>), NEXUS_IDE_DEMO: "1", NEXUS_IDE_COMPANY: "demo", NEXUS_IDE_DB: path.join(dir, "ide.sqlite") },
  stderr: "inherit",
});
const client = new Client({ name: "nexus-fixture-agent", version: "0.1.0" });
await client.connect(transport);
const call = async (name: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[] };
  return JSON.parse(res.content[0].text);
};
console.log(`Investigating ${fixture.ticketRef} with fixture ${path.basename(file)}`);
const { final } = await runFixtureAgent(call, fixture, { log: (l) => console.log(l) });
const report = final.report as { verdictLabel: string; reason: string; timeline: { title: string; status: string; summary: string }[]; evidence: { provenance: string; title: string }[]; whatWouldHelp: string[] } | undefined;
if (report) {
  console.log(`\nVerdict: ${report.verdictLabel}\n${report.reason}\n`);
  for (const s of report.timeline) console.log(`  ${s.status.padEnd(8)} ${s.title}: ${s.summary}`);
  console.log(`\nEvidence (${report.evidence.length}):`);
  for (const e of report.evidence.slice(0, 15)) console.log(`  [${e.provenance}] ${e.title}`);
  if (report.whatWouldHelp.length) console.log(`\nWhat would help:\n${report.whatWouldHelp.map((h) => `  - ${h}`).join("\n")}`);
} else {
  console.log(JSON.stringify(final, null, 2));
}
await client.close();
fs.rmSync(dir, { recursive: true, force: true });
