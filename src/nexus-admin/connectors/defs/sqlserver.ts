import { plannedConnector } from "../planned";

export default plannedConnector({
  id: "sqlserver",
  category: "database",
  displayName: "SQL Server",
  description: "Schema and constraints through a read-only login.",
  tier: "next",
  deployments: ["cloud","self-hosted"],
  fields: [{ name: "host", label: "Host", type: "text", required: true }, { name: "password", label: "Password", type: "secret", required: true }],
  scopeFields: [{ name: "schemas", label: "Schemas", type: "list", required: true, placeholder: "dbo" }],
  reads: ["schema","constraints","indexes"],
  transport: "database",
  selfHosted: { baseUrl: false, caCert: true },
});
