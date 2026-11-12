import { createGitHubConnector } from "../../../../connectors/github";
import { asList } from "../form";
import { allowInternalField, type ConnectorContext, defineConnector } from "../types";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const githubApiBase = (ctx: Pick<ConnectorContext, "deployment" | "baseUrl">) =>
  ctx.deployment === "self-hosted" && ctx.baseUrl ? `${ctx.baseUrl.replace(/\/$/, "")}/api/v3` : "https://api.github.com";

const connector = (ctx: ConnectorContext) =>
  createGitHubConnector({ repos: asList(ctx.scope.repositories), token: ctx.secrets.token, apiBase: githubApiBase(ctx), fetchImpl: ctx.fetchImpl });

export default defineConnector({
  id: "github",
  category: "code",
  displayName: "GitHub",
  description: "Files, commits, diffs, pull requests and issues from the listed repositories.",
  status: "available",
  tier: "now",
  deployments: ["cloud", "self-hosted"],
  selfHosted: { baseUrlLabel: "GitHub Enterprise Server URL", baseUrlPlaceholder: "https://github.example.com" },
  fields: [
    {
      name: "token",
      label: "Read-only access token",
      type: "secret",
      help: "Fine-grained token with Contents, Issues, Pull requests and Metadata set to Read-only, limited to the repositories below. Leave blank for public repositories only (GitHub allows about 60 anonymous requests an hour).",
    },
    allowInternalField,
  ],
  scopeFields: [
    {
      name: "repositories",
      label: "Repositories",
      type: "list",
      required: true,
      placeholder: "acme/web\nacme/api",
      help: "One owner/name per line. Nexus reads only these.",
      validate: (v) => (asList(v).every((r) => REPO.test(r)) ? null : "Use owner/name per line, for example acme/web."),
    },
  ],
  capabilities: { readOnly: true, reads: ["files", "commits", "diffs", "pull requests", "issues"], transport: "http" },
  targets: (ctx) => [{ url: githubApiBase(ctx) }],
  test: async (ctx) => {
    const result = await connector(ctx).test();
    const n = result.reached.filter((r) => r.startsWith("Repository ")).length;
    if (n) result.reached.unshift(`${n} ${n === 1 ? "repository" : "repositories"} reachable`);
    return result;
  },
  build: connector,
});
