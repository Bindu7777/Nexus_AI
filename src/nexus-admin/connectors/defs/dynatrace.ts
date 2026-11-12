import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "dynatrace",
  category: "logs",
  displayName: "Dynatrace",
  description: "Logs and problems for the listed entities.",
  tier: "on-request",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "entities", label: "Entities", type: "list", required: true, placeholder: "SERVICE-1234" }],
  reads: ["logs","problems"],
});
