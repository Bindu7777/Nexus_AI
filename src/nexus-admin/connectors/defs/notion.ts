import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "notion",
  category: "docs",
  displayName: "Notion",
  description: "Pages shared with the Nexus integration.",
  tier: "on-request",
  deployments: ["cloud"],
  fields: [tokenField()],
  scopeFields: [{ name: "pages", label: "Root pages", type: "list", required: true, placeholder: "Engineering wiki" }],
  reads: ["pages"],
});
