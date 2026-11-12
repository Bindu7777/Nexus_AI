import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "sharepoint",
  category: "docs",
  displayName: "SharePoint",
  description: "Documents from the listed sites.",
  tier: "on-request",
  deployments: ["cloud"],
  fields: [tokenField()],
  scopeFields: [{ name: "sites", label: "Sites", type: "list", required: true, placeholder: "Engineering" }],
  reads: ["documents"],
});
