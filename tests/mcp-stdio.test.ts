import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("MCP stdio client lists tools, reads the seeded ticket, and refuses a bad approval", { timeout: 30_000 }, async () => {
  const child = spawn(process.execPath, ["scripts/mcp-inspect.mjs"], { cwd: process.cwd() });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const code: number = await new Promise((resolve) => {
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  assert.equal(code, 0, stderr || stdout);
  const report = JSON.parse(stdout) as {
    tools: string[];
    seeded: string;
    nex4: { source: string; symptom: string };
    refused: { applied: boolean };
  };
  assert.ok(report.tools.includes("apply_sandbox_remediation"));
  assert.ok(report.tools.includes("diagnose"));
  assert.equal(report.seeded, "seeded");
  assert.equal(report.nex4.source, "jira-unconfigured");
  assert.equal(report.nex4.symptom, "");
  assert.equal(report.refused.applied, false);
});
