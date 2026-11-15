import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "azure-devops-repos",
  category: "code",
  displayName: "Azure DevOps Repos",
  description: "Files, commits and pull requests.",
  tier: "on-request",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "repositories", label: "Repositories", type: "list", required: true, placeholder: "project/repo" }],
  reads: ["files","commits","pull requests"],
});
