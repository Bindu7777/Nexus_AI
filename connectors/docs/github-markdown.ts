// Markdown docs that live in a GitHub repository (whole repo or a path prefix).
// Uses the read-only GitHub connector: tree listing plus readFile.
import type { GitHubConnector } from "../github";
import { type Connector, type EvidenceItem, emptyTestResult, nowIso, type SearchQuery } from "../types";
import { DOC_EXT, matchingSections } from "./markdown";

export function createGitHubMarkdownConnector(options: {
  github: GitHubConnector;
  repo: string;
  /** Path prefix inside the repo, e.g. "docs/". Empty means the whole repo. */
  pathPrefix?: string;
  revision?: string;
}): Connector & { listDocs(): Promise<{ revision: string; paths: string[] }> } {
  const { github, repo } = options;
  const prefix = (options.pathPrefix ?? "").replace(/^\/+/, "");

  async function listDocs() {
    const tree = await github.listTree(repo, { revision: options.revision });
    return { revision: tree.revision, paths: tree.paths.filter((p) => p.startsWith(prefix) && DOC_EXT.test(p)) };
  }

  const toDocItem = (item: EvidenceItem): EvidenceItem => ({ ...item, source: "github-docs", kind: "docs" });

  return {
    id: "github-docs",
    kind: "docs",
    readOnly: true,
    implemented: true,
    description: `Markdown docs in ${repo}${prefix ? ` under ${prefix}` : ""}, read through the GitHub connector.`,
    listDocs,
    async test() {
      const result = emptyTestResult();
      try {
        const docs = await listDocs();
        if (docs.paths.length === 0) result.problems.push(`No Markdown files found in ${repo}${prefix ? ` under ${prefix}` : ""}.`);
        else {
          result.ok = true;
          result.reached.push(`${docs.paths.length} Markdown file${docs.paths.length === 1 ? "" : "s"} in ${repo}${prefix ? `/${prefix}` : ""} at ${docs.revision}`);
        }
      } catch (error) {
        result.problems.push(error instanceof Error ? error.message : String(error));
      }
      return result;
    },
    async search(query: SearchQuery) {
      const docs = await listDocs();
      const out: EvidenceItem[] = [];
      const retrievedAt = nowIso();
      for (const p of docs.paths.slice(0, 200)) {
        const file = await github.readFile(repo, p, { revision: docs.revision });
        for (const s of matchingSections(file.excerpt, query.text)) {
          out.push({
            source: "github-docs",
            kind: "docs",
            ref: `github:file:${repo}@${docs.revision}:${p}#L${s.startLine}-L${s.endLine}`,
            timestamp: null,
            retrievedAt,
            title: `${repo}:${p} › ${s.heading}`,
            excerpt: s.body.slice(0, 6000),
            observation: "observed",
            location: { path: p, startLine: s.startLine, endLine: s.endLine, revision: docs.revision },
          });
          if (out.length >= (query.limit ?? 30)) return out;
        }
      }
      return out;
    },
    async fetch(ref: string) {
      if (!ref.startsWith("github:file:")) return null;
      const item = await github.fetch(ref);
      return item ? toDocItem(item) : null;
    },
  };
}
