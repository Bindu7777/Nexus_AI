import { createGitHubConnector } from "../../../../connectors/github";
import { createGitHubIssuesConnector } from "../../../../connectors/tickets/github-issues";
import { asList } from "../form";
import { allowInternalField, type ConnectorContext, defineConnector } from "../types";
import { githubApiBase } from "./github";

function connector(ctx: ConnectorContext) {
  const repo = String(ctx.scope.repository);
  const token = ctx.secrets.token || ctx.siblingSecret("github", "token");
  const github = createGitHubConnector({ repos: [repo], token, apiBase: githubApiBase(ctx), fetchImpl: ctx.fetchImpl });
  return createGitHubIssuesConnector({ github, repo });
}

export default defineConnector({
  id: "github-issues",
  category: "defects",
  displayName: "GitHub Issues",
  description: "Reads issues and their comments from one repository.",
  status: "available",
  tier: "now",
  deployments: ["cloud", "self-hosted"],
  selfHosted: { baseUrlLabel: "GitHub Enterprise Server URL", baseUrlPlaceholder: "https://github.example.com" },
  fields: [
    {
      name: "token",
      label: "Read-only access token",
      type: "secret",
      help: "Issues: Read-only. Leave blank to reuse the GitHub code connector's token, or to read a public repository without one.",
    },
    allowInternalField,
  ],
  scopeFields: [
    {
      name: "repository",
      label: "Repository for issues",
      type: "text",
      required: true,
      placeholder: "acme/web",
      validate: (v) => (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(v)) ? null : "Use owner/name, for example acme/web."),
    },
    { name: "labels", label: "Only issues with these labels", type: "list", placeholder: "bug" },
  ],
  capabilities: { readOnly: true, reads: ["issues", "issue comments"], transport: "http" },
  targets: (ctx) => [{ url: githubApiBase(ctx) }],
  test: async (ctx) => {
    const result = await connector(ctx).test();
    if (!ctx.secrets.token && !ctx.siblingSecret("github", "token")) {
      result.warnings.push("No token: only issues in a public repository can be read, with a low rate limit.");
    }
    if (asList(ctx.scope.labels).length) result.reached.push(`Label filter: ${asList(ctx.scope.labels).join(", ")}`);
    return result;
  },
  build: connector,
});
