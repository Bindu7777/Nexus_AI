import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "gitlab",
  category: "code",
  displayName: "GitLab",
  description: "Files, commits, diffs and merge requests.",
  tier: "next",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField("Read-only access token", "A token with read_api and read_repository scopes only.")],
  scopeFields: [{ name: "projects", label: "Projects", type: "list", required: true, placeholder: "group/project" }],
  reads: ["files","commits","diffs","merge requests"],
});
