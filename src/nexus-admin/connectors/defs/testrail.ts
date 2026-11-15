import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "testrail",
  category: "tests",
  displayName: "TestRail",
  description: "Test cases, runs and results (read-only).",
  tier: "next",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "projects", label: "Projects", type: "list", required: true, placeholder: "Checkout" }],
  reads: ["test cases","test runs","results"],
});
