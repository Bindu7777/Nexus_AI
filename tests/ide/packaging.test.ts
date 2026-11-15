// Packaging: the bundled nexus-mcp command works on its own, dependencies are
// pinned, and nothing in the packages or docs asks for source credentials.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { IDE_TOOL_NAMES } from "../../services/mcp/ide-server.ts";

const BIN = "packages/nexus-mcp/dist/nexus-mcp.mjs";

test("the bundled nexus-mcp command builds, starts over stdio and lists only the nexus_* tools", { timeout: 60_000 }, async () => {
  execFileSync(process.execPath, ["scripts/build-nexus-mcp.mjs"], { stdio: "pipe" });
  assert.equal(execFileSync(process.execPath, [BIN, "--version"]).toString().trim(), "0.2.0");
  assert.match(execFileSync(process.execPath, [BIN, "--help"]).toString(), /nexus-mcp --http/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-pkg-"));
  const client = new Client({ name: "pkg-test", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN], env: { ...(process.env as Record<string, string>), NEXUS_IDE_DB: path.join(dir, "ide.sqlite") }, stderr: "pipe" }));
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [...IDE_TOOL_NAMES].sort());
  await client.close();
  for (const f of ["services/catalog/server.mjs", "services/scenario.json"]) assert.ok(fs.existsSync(path.join("packages/nexus-mcp", f)), f);
});

test("runtime dependencies are pinned to exact versions", () => {
  const pkg = JSON.parse(fs.readFileSync("packages/nexus-mcp/package.json", "utf8"));
  for (const [name, v] of Object.entries(pkg.dependencies as Record<string, string>)) assert.match(v, /^\d+\.\d+\.\d+$/, `${name} is not pinned`);
  assert.equal(pkg.private, true, "never published to a registry by accident");
  assert.deepEqual(pkg.bin, { "nexus-mcp": "dist/nexus-mcp.mjs" });
  const ext = JSON.parse(fs.readFileSync("extensions/vscode-nexus/package.json", "utf8"));
  assert.equal(ext.dependencies, undefined, "the extension bundles its code; it installs nothing at run time");
});

test("no package, deploy file or doc asks for Jira, GitHub, database or docs credentials", () => {
  const env = fs.readFileSync("packages/nexus-mcp/.env.example", "utf8");
  const setVars = env.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split("=")[0]);
  for (const v of setVars) assert.equal(/JIRA|GITHUB|GH_|DATABASE|PG|MYSQL|CONFLUENCE|NOTION|TOKEN|PASSWORD|SECRET/.test(v), false, `${v} looks like a source credential`);
  const values = fs.readFileSync("deploy/helm/nexus-mcp/values.yaml", "utf8");
  assert.equal(/token|password|secret:/i.test(values.replace(/#.*$/gm, "")), false);
  assert.equal(fs.readdirSync("deploy/helm/nexus-mcp/templates").some((f) => /secret/i.test(f)), false);
  const docs = fs.readFileSync("docs/ide-setup.md", "utf8");
  assert.match(docs, /never needs your Jira, GitHub, database or docs credentials/);
  for (const ide of ["### VS Code", "### Cursor", "### Claude Code"]) assert.ok(docs.includes(ide), ide);
  assert.match(docs, /"servers": \{\n\s+"nexus": \{ "type": "stdio", "command": "nexus-mcp" \}/);
});
