import { plannedConnector } from "../planned";

export default plannedConnector({
  id: "oracle",
  category: "database",
  displayName: "Oracle",
  description: "Schema metadata through a read-only user.",
  tier: "on-request",
  deployments: ["cloud","self-hosted"],
  fields: [{ name: "host", label: "Host", type: "text", required: true }, { name: "password", label: "Password", type: "secret", required: true }],
  scopeFields: [{ name: "schemas", label: "Schemas", type: "list", required: true, placeholder: "APP" }],
  reads: ["schema"],
  transport: "database",
  selfHosted: { baseUrl: false, caCert: true },
});
