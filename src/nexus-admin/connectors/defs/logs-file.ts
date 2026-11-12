// Generic logs: files or folders on the Nexus server (for example a mounted
// log volume). Opened for reading only.
import { createFileLogConnector } from "../../../../connectors/logs/file";
import type { Connector, EvidenceItem, SearchQuery } from "../../../../connectors/types";
import { asList } from "../form";
import { type ConnectorContext, defineConnector } from "../types";

function connectors(ctx: ConnectorContext) {
  return asList(ctx.scope.paths).map((p, i) => createFileLogConnector({ id: `logs-file-${i + 1}`, path: p }));
}

export default defineConnector({
  id: "logs-file",
  category: "logs",
  displayName: "Log files on the Nexus server",
  description: "Reads .log, .jsonl, .ndjson, .txt and .out files from the listed files or folders.",
  status: "available",
  tier: "now",
  deployments: ["self-hosted"],
  selfHosted: { baseUrl: false, caCert: false },
  fields: [],
  scopeFields: [
    {
      name: "paths",
      label: "Files or folders",
      type: "list",
      required: true,
      placeholder: "/var/log/acme\n/srv/acme/api.log",
      help: "Absolute paths on the Nexus server. Nexus never reads outside them.",
      validate: (v) => (asList(v).every((p) => p.startsWith("/") && !p.split("/").includes("..")) ? null : "Use absolute paths without .., for example /var/log/acme."),
    },
  ],
  capabilities: { readOnly: true, reads: ["log lines"], transport: "files" },
  test: async (ctx) => {
    const out = { ok: true, reached: [] as string[], problems: [] as string[], warnings: [] as string[] };
    for (const c of connectors(ctx)) {
      const r = await c.test();
      out.ok &&= r.ok;
      out.reached.push(...r.reached);
      out.problems.push(...r.problems);
      out.warnings.push(...r.warnings);
    }
    return out;
  },
  build: (ctx): Connector => {
    const parts = connectors(ctx);
    return {
      id: "logs-file",
      kind: "logs",
      readOnly: true,
      implemented: true,
      description: "Log files on the Nexus server.",
      test: async () => {
        const rs = await Promise.all(parts.map((p) => p.test()));
        return { ok: rs.every((r) => r.ok), reached: rs.flatMap((r) => r.reached), problems: rs.flatMap((r) => r.problems), warnings: rs.flatMap((r) => r.warnings) };
      },
      search: async (q: SearchQuery) => (await Promise.all(parts.map((p) => p.search(q)))).flat().slice(0, q.limit ?? 50),
      fetch: async (ref: string): Promise<EvidenceItem | null> => {
        for (const p of parts) {
          try {
            const item = await p.fetch(ref);
            if (item) return item;
          } catch {
            /* not this root */
          }
        }
        return null;
      },
    };
  },
});
