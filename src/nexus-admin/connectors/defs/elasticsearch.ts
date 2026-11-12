import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "elasticsearch",
  category: "logs",
  displayName: "Elasticsearch / ELK",
  description: "Log documents from the listed indexes.",
  tier: "next",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "indexes", label: "Indexes", type: "list", required: true, placeholder: "logs-api-*" }],
  reads: ["log documents"],
});
