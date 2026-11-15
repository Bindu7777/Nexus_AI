import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "figma",
  category: "design",
  displayName: "Figma",
  description: "Frames and comments from the listed files.",
  tier: "next",
  deployments: ["cloud"],
  fields: [tokenField()],
  scopeFields: [{ name: "files", label: "File keys", type: "list", required: true, placeholder: "AbC123" }],
  reads: ["frames","comments"],
});
