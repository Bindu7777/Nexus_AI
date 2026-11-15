import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "confluence",
  category: "docs",
  displayName: "Confluence",
  description: "Pages from the listed spaces. Cloud and Data Center.",
  tier: "now",
  deployments: ["cloud","self-hosted"],
  fields: [tokenField()],
  scopeFields: [{ name: "spaceKeys", label: "Space keys", type: "list", required: true, placeholder: "ENG" }],
  reads: ["pages"],
});
