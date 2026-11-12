import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "splunk",
  category: "logs",
  displayName: "Splunk",
  description: "Events from the listed indexes.",
  tier: "on-request",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "indexes", label: "Indexes", type: "list", required: true, placeholder: "main" }],
  reads: ["events"],
});
