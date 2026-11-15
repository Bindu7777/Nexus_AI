// Confluence placeholder. When implemented it will read pages with the REST API
// over GET using a read-only API token, behind the same interface.
import { createStubConnector } from "../stub";

export const createConfluenceConnector = () =>
  createStubConnector({ id: "confluence", kind: "docs", description: "Confluence spaces and pages (placeholder)." });
