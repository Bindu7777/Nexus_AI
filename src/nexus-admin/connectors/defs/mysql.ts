import { plannedConnector } from "../planned";

export default plannedConnector({
  id: "mysql",
  category: "database",
  displayName: "MySQL",
  description: "Schema and constraints through a read-only account.",
  tier: "now",
  deployments: ["cloud","self-hosted"],
  fields: [{ name: "host", label: "Host", type: "text", required: true }, { name: "port", label: "Port", type: "number", defaultValue: 3306, min: 1, max: 65535 }, { name: "username", label: "Read-only username", type: "text", defaultValue: "nexus_readonly" }, { name: "password", label: "Password", type: "secret", required: true }],
  scopeFields: [{ name: "schemas", label: "Databases", type: "list", required: true, placeholder: "app" }],
  reads: ["schema","constraints","indexes"],
  transport: "database",
  selfHosted: { baseUrl: false, caCert: true },
});
