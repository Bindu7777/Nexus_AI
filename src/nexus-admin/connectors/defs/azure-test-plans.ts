import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "azure-test-plans",
  category: "tests",
  displayName: "Azure Test Plans",
  description: "Test plans and results.",
  tier: "on-request",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "plans", label: "Test plans", type: "list", required: true, placeholder: "Release 4" }],
  reads: ["test plans","results"],
});
