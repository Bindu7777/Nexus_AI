import { createVercelLogsConnector } from "../../../../connectors/logs/vercel";
import { asList } from "../form";
import { type ConnectorContext, defineConnector } from "../types";

const connector = (ctx: ConnectorContext) =>
  createVercelLogsConnector({
    token: ctx.secrets.token,
    teamId: String(ctx.config.teamId ?? "") || undefined,
    projects: asList(ctx.scope.projects),
    deploymentsPerProject: Number(ctx.config.deployments || 3),
    streamMs: 4000,
    fetchImpl: ctx.fetchImpl,
  });

export default defineConnector({
  id: "vercel-logs",
  category: "logs",
  displayName: "Vercel logs",
  description:
    "Runtime logs from the listed Vercel projects: recent deployments when gathering evidence, and the live production stream while Nexus reproduces a defect.",
  status: "available",
  tier: "now",
  deployments: ["cloud"],
  fields: [
    {
      name: "token",
      label: "Vercel access token",
      type: "secret",
      required: true,
      help: "Create one at vercel.com/account/tokens, scoped to the team that owns the project, with an expiry. Vercel tokens cannot be made read-only; Nexus only sends GET requests.",
    },
    {
      name: "teamId",
      label: "Team ID",
      type: "text",
      placeholder: "team_xxxxxxxxxxxxxxxx",
      help: "Only if the project belongs to a team: Team Settings → General → Team ID. Leave blank for a personal account.",
      validate: (v) => (!v || /^team_[A-Za-z0-9]{6,}$/.test(String(v)) ? null : "A Team ID starts with team_."),
    },
    { name: "deployments", label: "Recent deployments to read per project", type: "number", defaultValue: 3, min: 1, max: 10 },
    {
      name: "liveTail",
      label: "Watch live server logs while Nexus reproduces a defect",
      type: "checkbox",
      defaultValue: true,
      help: "While the reproduction browser runs, Nexus keeps the production deployment's log stream open (GET only) and attaches the server lines it sees to the report.",
    },
  ],
  scopeFields: [
    {
      name: "projects",
      label: "Vercel projects",
      type: "list",
      required: true,
      placeholder: "happy-moments",
      help: "Project names or IDs, one per line. Nexus reads logs for these only.",
      validate: (v) => (asList(v).every((p) => /^[A-Za-z0-9._-]{1,100}$/.test(p)) ? null : "Use the project name or ID as shown in Vercel."),
    },
  ],
  capabilities: { readOnly: true, reads: ["runtime logs", "live runtime logs", "deployments"], transport: "http" },
  targets: () => [{ url: "https://api.vercel.com" }],
  test: (ctx) => connector(ctx).test(),
  build: connector,
});
