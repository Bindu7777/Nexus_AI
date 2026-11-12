import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "bitbucket",
  category: "code",
  displayName: "Bitbucket",
  description: "Files, commits, diffs and pull requests.",
  tier: "next",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "repositories", label: "Repositories", type: "list", required: true, placeholder: "workspace/repo" }],
  reads: ["files","commits","diffs","pull requests"],
});
