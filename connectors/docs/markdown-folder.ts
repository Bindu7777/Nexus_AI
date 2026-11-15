// Markdown docs from a local folder. Read-only, confined to the folder.
import fs from "node:fs";
import path from "node:path";
import { clip, type Connector, type EvidenceItem, emptyTestResult, nowIso, type SearchQuery } from "../types";
import { DOC_EXT, matchingSections, sections } from "./markdown";

export function createMarkdownFolderConnector(config: { id?: string; path: string }): Connector & {
  listDocs(): string[];
  readDoc(rel: string, startLine?: number, endLine?: number): EvidenceItem;
} {
  const id = config.id ?? "docs-folder";
  const root = path.resolve(config.path);

  function confined(rel: string) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
      throw new Error(`Refused doc path "${rel}": it must stay inside the docs folder.`);
    }
    const base = fs.realpathSync(root);
    const real = fs.realpathSync(path.join(base, rel));
    if (!real.startsWith(`${base}${path.sep}`)) throw new Error(`Refused doc path "${rel}": it resolves outside the docs folder.`);
    return real;
  }

  function listDocs() {
    const base = fs.realpathSync(root);
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && DOC_EXT.test(entry.name)) out.push(path.relative(base, full));
        if (out.length >= 2000) return;
      }
    };
    walk(base);
    return out.sort();
  }

  function readDoc(rel: string, startLine?: number, endLine?: number): EvidenceItem {
    const text = fs.readFileSync(confined(rel), "utf8");
    const { lines } = sections(text);
    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(lines.length, endLine ?? lines.length);
    return {
      source: id,
      kind: "docs",
      ref: `doc:file:${rel}#L${start}-L${end}`,
      timestamp: fs.statSync(confined(rel)).mtime.toISOString(),
      retrievedAt: nowIso(),
      title: `${rel}:${start}-${end}`,
      excerpt: clip(lines.slice(start - 1, end).join("\n"), 20_000),
      observation: "observed",
      location: { path: rel, startLine: start, endLine: end },
    };
  }

  return {
    id,
    kind: "docs",
    readOnly: true,
    implemented: true,
    description: `Markdown docs under ${root}. Read-only.`,
    listDocs,
    readDoc,
    async test() {
      const result = emptyTestResult();
      try {
        const docs = listDocs();
        if (docs.length === 0) result.problems.push(`${root} has no Markdown files.`);
        else {
          result.ok = true;
          result.reached.push(`${docs.length} Markdown file${docs.length === 1 ? "" : "s"} under ${root}${docs.some((d) => /readme/i.test(d)) ? ", including a README" : ""}`);
        }
      } catch (error) {
        result.problems.push(`Cannot read ${root}. ${error instanceof Error ? error.message : ""}`.trim());
      }
      return result;
    },
    async search(query: SearchQuery) {
      const retrievedAt = nowIso();
      const out: EvidenceItem[] = [];
      for (const rel of listDocs()) {
        if (query.scope && !rel.startsWith(query.scope)) continue;
        const text = fs.readFileSync(confined(rel), "utf8");
        for (const s of matchingSections(text, query.text)) {
          out.push({
            source: id,
            kind: "docs",
            ref: `doc:file:${rel}#L${s.startLine}-L${s.endLine}`,
            timestamp: null,
            retrievedAt,
            title: `${rel} › ${s.heading}`,
            excerpt: clip(s.body, 6000),
            observation: "observed",
            location: { path: rel, startLine: s.startLine, endLine: s.endLine },
          });
          if (out.length >= (query.limit ?? 30)) return out;
        }
      }
      return out;
    },
    async fetch(ref: string) {
      const m = ref.match(/^doc:file:(.+?)(?:#L(\d+)(?:-L(\d+))?)?$/);
      if (!m) return null;
      return readDoc(m[1], m[2] ? Number(m[2]) : undefined, m[3] ? Number(m[3]) : m[2] ? Number(m[2]) : undefined);
    },
  };
}
