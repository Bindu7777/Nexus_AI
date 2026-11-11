import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync("agent/workflow.md", "utf8").trim();
const tools = [
  "get_ticket",
  "measure_service",
  "collect_evidence",
  "diagnose",
  "propose_remediation",
  "apply_sandbox_remediation",
  "validate",
];

function frontmatter(file: string) {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${file} is missing frontmatter`);
  return { yaml: match[1], body: text.slice(match[0].length) };
}

function mcpCommand(file: string) {
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
    servers?: { nexus?: { command?: string; args?: string[] } };
    mcpServers?: { nexus?: { command?: string; args?: string[] } };
  };
  return (json.servers ?? json.mcpServers)?.nexus;
}

test("generated IDE files match agent/workflow.md", () => {
  const result = spawnSync(process.execPath, ["scripts/build-agents.mjs", "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const file of [
    ".github/agents/nexus-investigator.agent.md",
    ".github/copilot-instructions.md",
    ".github/prompts/investigate.prompt.md",
    ".cursor/rules/nexus-investigation.mdc",
    ".cursor/commands/investigate.md",
    ".claude/agents/nexus-investigator.md",
    ".claude/skills/nexus-investigate/SKILL.md",
    ".claude/commands/investigate.md",
    "SKILL.md",
  ]) {
    assert.match(fs.readFileSync(file, "utf8"), new RegExp(workflow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("VS Code, Cursor, and Claude configs describe the same workflow and MCP command", () => {
  const agent = frontmatter(".github/agents/nexus-investigator.agent.md");
  assert.match(agent.yaml, /^name: Nexus investigator/m);
  assert.match(agent.yaml, /^description: /m);
  assert.doesNotMatch(agent.yaml, /^model:/m);
  for (const tool of tools) assert.match(agent.yaml, new RegExp(`nexus/${tool}`));

  const prompt = frontmatter(".github/prompts/investigate.prompt.md");
  assert.match(prompt.yaml, /^agent: nexus-investigator/m);
  assert.match(prompt.body, /NEX-5/);
  assert.match(prompt.body, /NEX-6/);
  assert.match(prompt.body, /NEX-7/);

  const rule = frontmatter(".cursor/rules/nexus-investigation.mdc");
  assert.match(rule.yaml, /^alwaysApply: false/m);
  assert.match(rule.yaml, /^description: /m);
  assert.match(fs.readFileSync(".cursor/commands/investigate.md", "utf8"), /\/investigate NEX-5/);

  const claude = frontmatter(".claude/agents/nexus-investigator.md");
  assert.match(claude.yaml, /^name: nexus-investigator/m);
  assert.doesNotMatch(claude.yaml, /^model:/m);
  for (const tool of tools) assert.match(claude.yaml, new RegExp(`mcp__nexus__${tool}`));
  assert.match(frontmatter(".claude/skills/nexus-investigate/SKILL.md").yaml, /^name: nexus-investigate/m);
  assert.match(frontmatter(".claude/commands/investigate.md").yaml, /^description: /m);

  const commands = [".vscode/mcp.json", ".cursor/mcp.json", ".mcp.json"].map(mcpCommand);
  assert.deepEqual(commands[0], commands[1]);
  assert.deepEqual(commands[1], commands[2]);
  assert.deepEqual(commands[0], { type: "stdio", command: "npx", args: ["tsx", "services/mcp/server.ts"] });
});
