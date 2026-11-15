import { plannedConnector } from "../planned";

export default plannedConnector({
  id: "docs-upload",
  category: "docs",
  displayName: "Markdown or PDF upload",
  description: "Documents uploaded to the Nexus server.",
  tier: "next",
  deployments: ["self-hosted"],
  fields: [],
  scopeFields: [{ name: "collections", label: "Document collections", type: "list", required: true, placeholder: "architecture" }],
  reads: ["uploaded documents"],
  transport: "files",
});
