import { plannedConnector, tokenField } from "../planned";

export default plannedConnector({
  id: "visio",
  category: "design",
  displayName: "Visio",
  description: "Diagrams from the listed files.",
  tier: "on-request",
  deployments: ["cloud"],
  fields: [tokenField()],
  scopeFields: [{ name: "files", label: "Files", type: "list", required: true, placeholder: "architecture.vsdx" }],
  reads: ["diagrams"],
});
