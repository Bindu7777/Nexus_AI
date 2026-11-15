import { plannedConnector } from "../planned";

export default plannedConnector({
  id: "design-upload",
  category: "design",
  displayName: "Design file upload (PDF, images)",
  description: "Design PDFs and images uploaded to the Nexus server.",
  tier: "now",
  deployments: ["self-hosted"],
  fields: [],
  scopeFields: [{ name: "collections", label: "Design collections", type: "list", required: true, placeholder: "checkout-flow" }],
  reads: ["uploaded designs"],
  transport: "files",
});
