import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "azure-devops-boards",
  category: "defects",
  displayName: "Azure DevOps Boards",
  description: "Work items from the listed projects.",
  tier: "next",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "projects", label: "Projects", type: "list", required: true, placeholder: "Payments" }],
  reads: ["work items"],
});
