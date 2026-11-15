// GitHub connector. Read-only: every call is an HTTP GET through connectors/http.ts.
//
// Reads only the repositories it was configured with. A ref that names any
// other repository is refused, so ticket or log text cannot point Nexus at a
// repository the user did not onboard.
import { createReadOnlyHttp, type FetchLike, redact } from "./http";
import { clip, type Connector, type EvidenceItem, emptyTestResult, nowIso, type SearchQuery } from "./types";

export type RepoName = { owner: string; repo: string };

export type GitHubConfig = {
  repos: string[];
  token?: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
};

export function parseRepo(input: string): RepoName | null {
  const trimmed = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const patterns = [
    /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)/i,
    /^git@github\.com:([^/\s]+)\/([^/\s]+)$/i,
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return null;
}

const full = (r: RepoName) => `${r.owner}/${r.repo}`;
const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

type GhRepo = {
  full_name: string;
  default_branch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  pushed_at: string;
  html_url: string;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
};
type GhCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; author?: { name?: string; date?: string } };
  files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[];
};
type GhPull = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  merged_at: string | null;
  updated_at: string;
  created_at: string;
  user?: { login?: string };
};
type GhIssue = GhPull & { labels?: ({ name?: string } | string)[]; pull_request?: unknown; closed_at: string | null };

export type GitHubConnector = Connector & {
  readonly repos: RepoName[];
  listRepos(): Promise<GhRepo[]>;
  readFile(repo: string, path: string, options?: { revision?: string; startLine?: number; endLine?: number }): Promise<EvidenceItem>;
  listTree(repo: string, options?: { revision?: string }): Promise<{ revision: string; paths: string[]; truncated: boolean }>;
  listCommits(repo: string, options?: { since?: string; path?: string; limit?: number }): Promise<EvidenceItem[]>;
  readCommit(repo: string, sha: string): Promise<EvidenceItem>;
  readDiff(repo: string, target: { sha: string } | { pull: number }): Promise<EvidenceItem>;
  listPulls(repo: string, options?: { state?: "open" | "closed" | "all"; limit?: number }): Promise<EvidenceItem[]>;
  listIssues(repo: string, options?: { state?: "open" | "closed" | "all"; limit?: number; since?: string }): Promise<EvidenceItem[]>;
  readIssue(repo: string, number: number): Promise<{ issue: GhIssue; comments: { user?: { login?: string }; body: string; created_at: string }[] } | null>;
};

export function createGitHubConnector(config: GitHubConfig): GitHubConnector {
  const apiBase = (config.apiBase ?? "https://api.github.com").replace(/\/$/, "");
  const repos = config.repos.map((r) => parseRepo(r)).filter((r): r is RepoName => r != null);
  const http = createReadOnlyHttp({
    fetchImpl: config.fetchImpl,
    secrets: [config.token],
    baseHeaders: {
      "x-github-api-version": "2022-11-28",
      "user-agent": "nexus-readonly-connector",
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
    },
  });
  const clean = (message: string) => redact(message, [config.token]);

  function allowed(repo: string): RepoName {
    const parsed = parseRepo(repo);
    if (!parsed) throw new Error(`"${repo}" is not a GitHub repository name.`);
    const hit = repos.find((r) => full(r).toLowerCase() === full(parsed).toLowerCase());
    if (!hit) throw new Error(`${full(parsed)} is not one of the onboarded repositories. Nexus only reads configured repositories.`);
    return hit;
  }

  async function json<T>(path: string, accept?: string): Promise<T> {
    const result = await http.getJson<T & { message?: string }>(`${apiBase}${path}`, accept ? { accept } : undefined);
    if (result.status >= 400 || result.data == null) {
      const message = (result.data as { message?: string } | null)?.message ?? "";
      throw new Error(clean(`GitHub GET ${path} returned HTTP ${result.status}${message ? `: ${message}` : ""}`));
    }
    return result.data;
  }

  async function text(path: string, accept: string): Promise<string> {
    const result = await http.getText(`${apiBase}${path}`, { accept });
    if (result.status >= 400) throw new Error(clean(`GitHub GET ${path} returned HTTP ${result.status}`));
    return result.text;
  }

  const repoCache = new Map<string, GhRepo>();
  async function repoInfo(r: RepoName) {
    const key = full(r).toLowerCase();
    if (!repoCache.has(key)) repoCache.set(key, await json<GhRepo>(`/repos/${r.owner}/${r.repo}`));
    return repoCache.get(key)!;
  }

  function commitItem(r: RepoName, c: GhCommit, retrievedAt: string): EvidenceItem {
    const files = c.files?.map((f) => `${f.status} ${f.filename} (+${f.additions}/-${f.deletions})`).join("\n");
    return {
      source: "github",
      kind: "code",
      ref: `github:commit:${full(r)}@${c.sha}`,
      timestamp: c.commit.author?.date ?? null,
      retrievedAt,
      title: `${full(r)} ${c.sha.slice(0, 7)} ${c.commit.message.split("\n")[0]}`,
      excerpt: clip(`${c.commit.message}${files ? `\n\nFiles:\n${files}` : ""}`),
      observation: "observed",
      location: { url: c.html_url, revision: c.sha },
      meta: { author: c.commit.author?.name ?? null, files: c.files?.map((f) => f.filename) },
    };
  }

  function issueItem(r: RepoName, i: GhIssue, kind: "issue" | "pr", retrievedAt: string): EvidenceItem {
    return {
      source: "github",
      kind: "code",
      ref: `github:${kind}:${full(r)}#${i.number}`,
      timestamp: i.updated_at ?? i.created_at,
      retrievedAt,
      title: `${full(r)} ${kind === "pr" ? "PR" : "issue"} #${i.number} [${i.state}${i.merged_at ? ", merged" : ""}] ${i.title}`,
      excerpt: clip(i.body ?? ""),
      observation: "observed",
      location: { url: i.html_url },
      meta: {
        state: i.state,
        author: i.user?.login ?? null,
        mergedAt: i.merged_at ?? null,
        labels: i.labels?.map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean),
      },
    };
  }

  const connector: GitHubConnector = {
    id: "github",
    kind: "code",
    readOnly: true,
    implemented: true,
    description: "GitHub repositories, read with HTTP GET only.",
    repos,

    async test() {
      const result = emptyTestResult();
      if (config.repos.length === 0) result.problems.push("No repository was configured.");
      for (const raw of config.repos) {
        if (!parseRepo(raw)) result.problems.push(`"${raw}" is not a GitHub repository URL or owner/name.`);
      }
      if (!config.token) result.warnings.push("No token is set. Only public repositories can be read, with a low rate limit.");
      for (const r of repos) {
        try {
          const info = await repoInfo(r);
          result.reached.push(
            `Repository ${info.full_name} (${info.private ? "private" : "public"}, default branch ${info.default_branch}, last push ${info.pushed_at})`,
          );
          if (info.permissions?.push || info.permissions?.admin) {
            result.warnings.push(
              `The token can push to ${info.full_name}. Nexus never writes, but a read-only token (fine-grained, Contents/Issues/Pull requests: Read) is recommended.`,
            );
          }
        } catch (error) {
          result.problems.push(
            `${full(r)} could not be read. Check the URL and that the token has read access. ${error instanceof Error ? error.message : ""}`.trim(),
          );
        }
      }
      result.ok = result.problems.length === 0 && result.reached.length > 0;
      return result;
    },

    async search(query: SearchQuery) {
      const retrievedAt = nowIso();
      const targets = query.scope ? [allowed(query.scope)] : repos;
      const out: EvidenceItem[] = [];
      for (const r of targets) {
        const q = encodeURIComponent(`${query.text} repo:${full(r)}`);
        const data = await json<{
          items: { path: string; sha: string; html_url: string; text_matches?: { fragment: string }[] }[];
        }>(`/search/code?q=${q}&per_page=${Math.min(query.limit ?? 20, 100)}`, "application/vnd.github.text-match+json");
        const info = await repoInfo(r);
        for (const item of data.items) {
          out.push({
            source: "github",
            kind: "code",
            ref: `github:file:${full(r)}@${info.default_branch}:${item.path}`,
            timestamp: null,
            retrievedAt,
            title: `${full(r)}:${item.path}`,
            excerpt: clip(item.text_matches?.map((m) => m.fragment).join("\n…\n") ?? ""),
            observation: "observed",
            location: { path: item.path, url: item.html_url, revision: info.default_branch },
            meta: { searchIndex: "GitHub code search indexes the default branch only." },
          });
        }
      }
      return out.slice(0, query.limit ?? 50);
    },

    async fetch(ref: string) {
      let m = ref.match(/^github:file:([^/]+)\/([^@]+)@([^:]+):(.+?)(?:#L(\d+)(?:-L(\d+))?)?$/);
      if (m) {
        return connector.readFile(`${m[1]}/${m[2]}`, m[4], {
          revision: m[3],
          startLine: m[5] ? Number(m[5]) : undefined,
          endLine: m[6] ? Number(m[6]) : m[5] ? Number(m[5]) : undefined,
        });
      }
      m = ref.match(/^github:(commit|diff):([^/]+)\/([^@]+)@([0-9a-f]{7,40})$/i);
      if (m) {
        const repo = `${m[2]}/${m[3]}`;
        return m[1] === "commit" ? connector.readCommit(repo, m[4]) : connector.readDiff(repo, { sha: m[4] });
      }
      m = ref.match(/^github:(pr|prdiff|issue):([^/]+)\/([^#]+)#(\d+)$/);
      if (m) {
        const r = allowed(`${m[2]}/${m[3]}`);
        const n = Number(m[4]);
        if (m[1] === "prdiff") return connector.readDiff(full(r), { pull: n });
        if (m[1] === "pr") return issueItem(r, await json<GhPull>(`/repos/${r.owner}/${r.repo}/pulls/${n}`) as GhIssue, "pr", nowIso());
        return issueItem(r, await json<GhIssue>(`/repos/${r.owner}/${r.repo}/issues/${n}`), "issue", nowIso());
      }
      return null;
    },

    async listRepos() {
      return Promise.all(repos.map((r) => repoInfo(r)));
    },

    async readFile(repo, path, options = {}) {
      const r = allowed(repo);
      const revision = options.revision ?? (await repoInfo(r)).default_branch;
      const body = await text(
        `/repos/${r.owner}/${r.repo}/contents/${encPath(path)}?ref=${encodeURIComponent(revision)}`,
        "application/vnd.github.raw+json",
      );
      const lines = body.split(/\r?\n/);
      const start = Math.max(1, options.startLine ?? 1);
      const end = Math.min(lines.length, options.endLine ?? lines.length);
      const numbered = lines.slice(start - 1, end).join("\n");
      return {
        source: "github",
        kind: "code",
        ref: `github:file:${full(r)}@${revision}:${path}#L${start}-L${end}`,
        timestamp: null,
        retrievedAt: nowIso(),
        title: `${full(r)}:${path}:${start}-${end} @ ${revision}`,
        excerpt: clip(numbered, 20_000),
        observation: "observed",
        location: { path, startLine: start, endLine: end, revision, url: `https://github.com/${full(r)}/blob/${encodeURIComponent(revision)}/${encPath(path)}#L${start}-L${end}` },
        meta: { totalLines: lines.length },
      };
    },

    async listTree(repo, options = {}) {
      const r = allowed(repo);
      const revision = options.revision ?? (await repoInfo(r)).default_branch;
      const data = await json<{ sha: string; truncated: boolean; tree: { path: string; type: string }[] }>(
        `/repos/${r.owner}/${r.repo}/git/trees/${encodeURIComponent(revision)}?recursive=1`,
      );
      return { revision, paths: data.tree.filter((t) => t.type === "blob").map((t) => t.path), truncated: data.truncated };
    },

    async listCommits(repo, options = {}) {
      const r = allowed(repo);
      const params = new URLSearchParams({ per_page: String(Math.min(options.limit ?? 20, 100)) });
      if (options.since) params.set("since", options.since);
      if (options.path) params.set("path", options.path);
      const retrievedAt = nowIso();
      const data = await json<GhCommit[]>(`/repos/${r.owner}/${r.repo}/commits?${params}`);
      return data.map((c) => commitItem(r, c, retrievedAt));
    },

    async readCommit(repo, sha) {
      const r = allowed(repo);
      return commitItem(r, await json<GhCommit>(`/repos/${r.owner}/${r.repo}/commits/${encodeURIComponent(sha)}`), nowIso());
    },

    async readDiff(repo, target) {
      const r = allowed(repo);
      const isPull = "pull" in target;
      const path = isPull
        ? `/repos/${r.owner}/${r.repo}/pulls/${target.pull}`
        : `/repos/${r.owner}/${r.repo}/commits/${encodeURIComponent(target.sha)}`;
      const diff = await text(path, "application/vnd.github.diff");
      const id = isPull ? `#${target.pull}` : `@${target.sha}`;
      return {
        source: "github",
        kind: "code",
        ref: isPull ? `github:prdiff:${full(r)}#${target.pull}` : `github:diff:${full(r)}@${target.sha}`,
        timestamp: null,
        retrievedAt: nowIso(),
        title: `Diff ${full(r)}${id}`,
        excerpt: clip(diff, 30_000),
        observation: "observed",
        location: { url: isPull ? `https://github.com/${full(r)}/pull/${target.pull}` : `https://github.com/${full(r)}/commit/${target.sha}` },
      };
    },

    async listPulls(repo, options = {}) {
      const r = allowed(repo);
      const retrievedAt = nowIso();
      const data = await json<GhPull[]>(
        `/repos/${r.owner}/${r.repo}/pulls?state=${options.state ?? "all"}&sort=updated&direction=desc&per_page=${Math.min(options.limit ?? 20, 100)}`,
      );
      return data.map((p) => issueItem(r, p as GhIssue, "pr", retrievedAt));
    },

    async listIssues(repo, options = {}) {
      const r = allowed(repo);
      const params = new URLSearchParams({
        state: options.state ?? "all",
        sort: "updated",
        direction: "desc",
        per_page: String(Math.min(options.limit ?? 30, 100)),
      });
      if (options.since) params.set("since", options.since);
      const retrievedAt = nowIso();
      const data = await json<GhIssue[]>(`/repos/${r.owner}/${r.repo}/issues?${params}`);
      return data.filter((i) => !i.pull_request).map((i) => issueItem(r, i, "issue", retrievedAt));
    },

    async readIssue(repo, number) {
      const r = allowed(repo);
      const result = await http.getJson<GhIssue>(`${apiBase}/repos/${r.owner}/${r.repo}/issues/${number}`);
      if (result.status === 404) return null;
      if (result.status >= 400 || !result.data) throw new Error(clean(`GitHub issue read returned HTTP ${result.status}`));
      const comments = await json<{ user?: { login?: string }; body: string; created_at: string }[]>(
        `/repos/${r.owner}/${r.repo}/issues/${number}/comments?per_page=50`,
      );
      return { issue: result.data, comments };
    },
  };
  return connector;
}
