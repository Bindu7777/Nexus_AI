import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "datadog",
  category: "logs",
  displayName: "Datadog",
  description: "Logs matching the listed queries.",
  tier: "on-request",
  deployments: ["cloud"],
  fields: [tokenField()],
  scopeFields: [{ name: "queries", label: "Log queries", type: "list", required: true, placeholder: "service:api" }],
  reads: ["log lines"],
});
