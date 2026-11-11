import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import {
  applySandboxRemediation,
  collectEvidence,
  diagnoseRun,
  getTicket,
  listSteps,
  measureService,
  proposeRemediation,
  validateRemediation,
} from "../../src/lib/engine";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function createNexusMcpServer() {
  const server = new McpServer({
    name: "nexus-defect-demo",
    version: "0.1.0",
  });

  server.registerTool(
    "get_ticket",
    {
      title: "Get ticket",
      description:
        "Read one ticket. NI-1042 is a seeded example. Any other KEY-number is a read-only Jira GET for project NEX (Defect test). This tool never writes to Jira. Sparse issues are labeled and are not turned into evidence.",
      inputSchema: { ticketId: z.string().optional() },
    },
    async ({ ticketId }) => text(await getTicket(ticketId)),
  );

  server.registerTool(
    "measure_service",
    {
      title: "Measure service",
      description:
        "Run the live sandbox load. scenario lock compares baseline and incident on the local catalog. scenario outage arms HTTP 503. Refuses the Astronomy Shop placeholder. Does not invent measurements.",
      inputSchema: {
        ticketId: z.string().optional(),
        scenario: z.enum(["lock", "outage"]).optional(),
        targetId: z.string().optional(),
      },
    },
    async (args) => text(await measureService(args)),
  );

  server.registerTool(
    "collect_evidence",
    {
      title: "Collect evidence",
      description:
        "Return evidence stored for a sandbox run, including source citations with path and line numbers from services/catalog/server.mjs.",
      inputSchema: { runId: z.string() },
    },
    async ({ runId }) => text(collectEvidence(runId)),
  );

  server.registerTool(
    "diagnose",
    {
      title: "Diagnose",
      description:
        "Rule-based sandbox diagnosis. Returns hypothesis, evidence, confidence, and abstain. Abstains when the rules do not fire or the Jira text is too thin. Not a model call and not a production finding.",
      inputSchema: { runId: z.string() },
    },
    async ({ runId }) => text(diagnoseRun(runId)),
  );

  server.registerTool(
    "propose_remediation",
    {
      title: "Propose remediation",
      description:
        "Return the sandbox proposal when the rules found lock contention. Returns no proposal when the diagnosis abstains. Nothing is applied.",
      inputSchema: { runId: z.string() },
    },
    async ({ runId }) => text(proposeRemediation(runId)),
  );

  server.registerTool(
    "apply_sandbox_remediation",
    {
      title: "Apply sandbox remediation",
      description:
        "Switch only the local catalog to remediated mode. Requires approvalToken APPLY_SANDBOX_REMEDIATION. Any other value is refused. Does not write to Jira, git, or a remote system.",
      inputSchema: { runId: z.string(), approvalToken: z.string().optional() },
    },
    async ({ runId, approvalToken }) => text(await applySandboxRemediation({ runId, approvalToken })),
  );

  server.registerTool(
    "validate",
    {
      title: "Validate",
      description:
        "Repeat the sandbox load after remediated mode was applied with the approval token. Refuses when that apply step has not happened. The result is a sandbox check, not a production verification.",
      inputSchema: { runId: z.string() },
    },
    async ({ runId }) => text(await validateRemediation({ runId })),
  );

  return server;
}

async function main() {
  const server = createNexusMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export const toolNames = listSteps();
