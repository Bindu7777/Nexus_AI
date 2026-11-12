import { createMarkdownFolderConnector } from "../../../../connectors/docs/markdown-folder";
import { asList } from "../form";
import { defineConnector } from "../types";

export default defineConnector({
  id: "docs-folder",
  category: "docs",
  displayName: "Markdown folder on the Nexus server",
  description: "Reads Markdown files from folders on the Nexus server.",
  status: "available",
  tier: "now",
  deployments: ["self-hosted"],
  selfHosted: { baseUrl: false, caCert: false },
  fields: [],
  scopeFields: [
    {
      name: "paths",
      label: "Folders",
      type: "list",
      required: true,
      placeholder: "/srv/acme/docs",
      validate: (v) => (asList(v).every((p) => p.startsWith("/") && !p.split("/").includes("..")) ? null : "Use absolute folder paths without .."),
    },
  ],
  capabilities: { readOnly: true, reads: ["Markdown documents"], transport: "files" },
  test: async (ctx) => {
    const out = { ok: true, reached: [] as string[], problems: [] as string[], warnings: [] as string[] };
    for (const p of asList(ctx.scope.paths)) {
      const r = await createMarkdownFolderConnector({ path: p }).test();
      out.ok &&= r.ok;
      out.reached.push(...r.reached);
      out.problems.push(...r.problems);
    }
    return out;
  },
  build: (ctx) => createMarkdownFolderConnector({ path: asList(ctx.scope.paths)[0] }),
});
