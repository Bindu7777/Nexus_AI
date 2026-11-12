import { createGitHubMarkdownConnector } from "../../../../connectors/docs/github-markdown";
import { createGitHubConnector } from "../../../../connectors/github";
import { allowInternalField, type ConnectorContext, defineConnector } from "../types";
import { githubApiBase } from "./github";

function connector(ctx: ConnectorContext) {
  const repo = String(ctx.scope.repository);
  const token = ctx.secrets.token || ctx.siblingSecret("github", "token");
  const github = createGitHubConnector({ repos: [repo], token, apiBase: githubApiBase(ctx), fetchImpl: ctx.fetchImpl });
  return createGitHubMarkdownConnector({ github, repo, pathPrefix: String(ctx.scope.pathPrefix ?? "") });
}

export default defineConnector({
  id: "docs-repo",
  category: "docs",
  displayName: "Markdown in a GitHub repository",
  description: "Reads Markdown docs from a repository path.",
  status: "available",
  tier: "now",
  deployments: ["cloud", "self-hosted"],
  selfHosted: { baseUrlLabel: "GitHub Enterprise Server URL" },
  fields: [
    { name: "token", label: "Read-only access token", type: "secret", help: "Contents: Read-only. Leave blank to reuse the GitHub code connector's token." },
    allowInternalField,
  ],
  scopeFields: [
    {
      name: "repository",
      label: "Repository",
      type: "text",
      required: true,
      placeholder: "acme/web",
      validate: (v) => (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(v)) ? null : "Use owner/name, for example acme/web."),
    },
    { name: "pathPrefix", label: "Path inside the repository", type: "text", defaultValue: "docs/" },
  ],
  capabilities: { readOnly: true, reads: ["Markdown documents"], transport: "http" },
  targets: (ctx) => [{ url: githubApiBase(ctx) }],
  test: (ctx) => connector(ctx).test(),
  build: connector,
});
