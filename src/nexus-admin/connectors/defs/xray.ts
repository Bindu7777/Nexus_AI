import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "xray",
  category: "tests",
  displayName: "Xray",
  description: "Tests and executions.",
  tier: "on-request",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "projects", label: "Jira projects", type: "list", required: true, placeholder: "PAY" }],
  reads: ["tests","executions"],
});
