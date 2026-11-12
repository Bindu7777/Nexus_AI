import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "zephyr",
  category: "tests",
  displayName: "Zephyr",
  description: "Test cases and cycles.",
  tier: "on-request",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "projects", label: "Projects", type: "list", required: true, placeholder: "PAY" }],
  reads: ["test cases","cycles"],
});
