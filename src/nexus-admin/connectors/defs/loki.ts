import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "loki",
  category: "logs",
  displayName: "Grafana Loki",
  description: "Log streams by label selector.",
  tier: "next",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "selectors", label: "Label selectors", type: "list", required: true, placeholder: "{app=\"api\"}" }],
  reads: ["log lines"],
});
