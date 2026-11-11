import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workflow = fs.readFileSync(path.join(root, "agent/workflow.md"), "utf8").trim();
const check = process.argv.includes("--check");

const mcpCommand = {
  command: "npx",
  args: ["tsx", "services/mcp/server.ts"],
};

const nexusTools = [
  "get_ticket",
  "measure_service",
  "collect_evidence",
  "diagnose",
  "propose_remediation",
  "apply_sandbox_remediation",
  "validate",
];

function wrap(frontmatter, body) {
  return `---\n${frontmatter.trim()}\n---\n\n${body.trim()}\n`;
}

const files = {
  ".github/agents/nexus-investigator.agent.md": wrap(
    `name: Nexus investigator
description: Run the Nexus sandbox defect investigation with the engineer's selected Copilot model. Not a production agent.
tools:
${nexusTools.map((tool) => `  - nexus/${tool}`).join("\n")}`,
    workflow,
  ),
  ".github/copilot-instructions.md": `# Nexus defect investigation

Use the custom agent in \`.github/agents/nexus-investigator.agent.md\`. The shared backend is the Nexus MCP server. Do not hardcode a model. The Copilot model picker is the model for the session.

The \`@nexus\` VS Code extension is optional. The built-in custom agent is the default path.

${workflow}
`,
  ".github/prompts/investigate.prompt.md": wrap(
    `description: Investigate a Nexus sandbox defect with the nexus-investigator agent
agent: nexus-investigator
argument-hint: NI-1042, NEX-5, NEX-6, or NEX-7`,
    `Investigate the ticket key from the prompt. If none is given, use NI-1042.

Use the Nexus investigator agent and only its Nexus MCP tools. Offline example: NI-1042. Live Jira examples, which need JIRA_EMAIL and JIRA_API_TOKEN: /investigate NEX-5, /investigate NEX-6, /investigate NEX-7.

${workflow}`,
  ),
  ".cursor/rules/nexus-investigation.mdc": wrap(
    `description: Use when investigating a defect, NI-1042, or a NEX Jira issue in the Nexus sandbox. Read-only. Abstain on thin evidence or an outage. Do not claim savings.
alwaysApply: false`,
    workflow,
  ),
  ".cursor/commands/investigate.md": `# Investigate a Nexus defect

The text after \`/investigate\` is the ticket key. Examples: \`/investigate NI-1042\`, \`/investigate NEX-5\`, \`/investigate NEX-6\`, \`/investigate NEX-7\`.

Use the Nexus MCP server. Do not choose a different model in this file. The model selected in Cursor is the model for the chat.

${workflow}
`,
  ".claude/agents/nexus-investigator.md": wrap(
    `name: nexus-investigator
description: Investigate a Nexus sandbox defect using only the nexus MCP tools. Use for NI-1042 or NEX issues. Read-only Jira. Abstain on thin evidence or an outage.
tools: ${nexusTools.map((tool) => `mcp__nexus__${tool}`).join(", ")}`,
    workflow,
  ),
  ".claude/skills/nexus-investigate/SKILL.md": wrap(
    `name: nexus-investigate
description: Investigate a Nexus sandbox defect ticket. Offline example NI-1042. Live Jira examples NEX-5, NEX-6, and NEX-7 need JIRA_EMAIL and JIRA_API_TOKEN. Read-only. Abstain on thin evidence or an outage.
disable-model-invocation: true
argument-hint: NI-1042, NEX-5, NEX-6, or NEX-7`,
    `Run this when the user types /nexus-investigate or asks to investigate a Nexus ticket. Use the nexus-investigator subagent and the nexus MCP tools.

${workflow}`,
  ),
  ".claude/commands/investigate.md": wrap(
    `description: Investigate a Nexus sandbox defect ticket
argument-hint: NI-1042, NEX-5, NEX-6, or NEX-7
disable-model-invocation: true`,
    `The argument is the ticket key. Examples: /investigate NI-1042, /investigate NEX-5, /investigate NEX-6, /investigate NEX-7.

Delegate to the nexus-investigator subagent. Use only the nexus MCP tools.

${workflow}`,
  ),
  "SKILL.md": `# Nexus investigation process

Generated from \`agent/workflow.md\` by \`npm run agents:build\`. Edit that file, then rebuild. Do not edit this copy by hand.

${workflow}
`,
};

const mcpFiles = {
  ".vscode/mcp.json": {
    servers: { nexus: { type: "stdio", ...mcpCommand } },
  },
  ".cursor/mcp.json": {
    mcpServers: { nexus: { type: "stdio", ...mcpCommand } },
  },
  ".mcp.json": {
    mcpServers: { nexus: { type: "stdio", ...mcpCommand } },
  },
};

let drift = false;
for (const [relativePath, contents] of Object.entries(files)) {
  const full = path.join(root, relativePath);
  const next = contents.endsWith("\n") ? contents : `${contents}\n`;
  const current = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
  if (current !== next) {
    drift = true;
    if (!check) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, next);
    }
  }
}
for (const [relativePath, value] of Object.entries(mcpFiles)) {
  const full = path.join(root, relativePath);
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const current = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
  if (current !== next) {
    drift = true;
    if (!check) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, next);
    }
  }
}

if (check && drift) {
  console.error("Generated IDE files differ from agent/workflow.md. Run npm run agents:build.");
  process.exit(1);
}
if (!check) console.log("Wrote IDE agent files from agent/workflow.md");
