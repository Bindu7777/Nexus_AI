import { plannedConnector } from "../planned";

export default plannedConnector({
  id: "logs-http",
  category: "logs",
  displayName: "HTTP endpoint returning log lines",
  description: "An internal URL that returns log lines over GET.",
  tier: "now",
  deployments: ["cloud","self-hosted"],
  fields: [{ name: "endpoint", label: "Endpoint URL", type: "url", required: true }, { name: "token", label: "Read-only token (optional)", type: "secret" }],
  scopeFields: [{ name: "streams", label: "Streams or query names", type: "list", required: true, placeholder: "api" }],
  reads: ["log lines"],
});
