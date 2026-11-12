import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "servicenow",
  category: "defects",
  displayName: "ServiceNow",
  description: "Incidents from the listed assignment groups.",
  tier: "on-request",
  deployments: ["cloud"],
  fields: [tokenField()],
  scopeFields: [{ name: "assignmentGroups", label: "Assignment groups", type: "list", required: true, placeholder: "Checkout L2" }],
  reads: ["incidents"],
});
