// GitHub Issues as the ticket tool. Reuses the read-only GitHub connector, so
// it shares its GET-only client and its configured-repository allow-list.
import type { GitHubConnector } from "../github";
import { parseRepo } from "../github";
import { emptyTestResult, nowIso, type SearchQuery } from "../types";
import { type TicketConnector, type TicketRecord, ticketEvidence } from "./types";

export function parseIssueKey(key: string, defaultRepo: string): { repo: string; number: number } | null {
  const trimmed = key.trim();
  let m = trimmed.match(/^#?(\d+)$/);
  if (m) return { repo: defaultRepo, number: Number(m[1]) };
  m = trimmed.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/);
  if (m) return { repo: m[1], number: Number(m[2]) };
  m = trimmed.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/i);
  if (m) return { repo: m[1], number: Number(m[2]) };
  return null;
}

export function createGitHubIssuesConnector(options: { github: GitHubConnector; repo: string }): TicketConnector {
  const parsed = parseRepo(options.repo);
  const repo = parsed ? `${parsed.owner}/${parsed.repo}` : options.repo;
  const { github } = options;

  async function readTicket(key: string) {
    const target = parseIssueKey(key, repo);
    if (!target) {
      return { ok: false as const, reason: "invalid-key" as const, message: `"${key}" is not a GitHub issue number. Use 12, #12 or owner/repo#12.` };
    }
    try {
      const result = await github.readIssue(target.repo, target.number);
      if (!result) return { ok: false as const, reason: "not-found" as const, message: `${target.repo}#${target.number} was not found.` };
      if (result.issue.pull_request) {
        return { ok: false as const, reason: "invalid-key" as const, message: `${target.repo}#${target.number} is a pull request, not an issue.` };
      }
      const i = result.issue;
      const ticket: TicketRecord = {
        key: `${target.repo}#${target.number}`,
        source: "github-issues",
        title: i.title,
        body: i.body ?? "",
        state: i.state,
        labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean),
        author: i.user?.login ?? null,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        url: i.html_url,
        comments: result.comments.map((c) => ({ author: c.user?.login ?? null, body: c.body, createdAt: c.created_at })),
        trust: "untrusted-input",
      };
      return { ok: true as const, ticket, evidence: ticketEvidence(ticket, `ticket:github:${ticket.key}`, nowIso()) };
    } catch (error) {
      return { ok: false as const, reason: "error" as const, message: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    id: "github-issues",
    kind: "tickets",
    readOnly: true,
    implemented: true,
    description: `GitHub Issues in ${repo}, read with HTTP GET only.`,
    readTicket,
    async test() {
      const result = emptyTestResult();
      try {
        const issues = await github.listIssues(repo, { limit: 5 });
        result.ok = true;
        result.reached.push(`Issues in ${repo} (${issues.length} recent issue${issues.length === 1 ? "" : "s"} visible)`);
      } catch (error) {
        result.problems.push(`Could not read issues in ${repo}. ${error instanceof Error ? error.message : ""}`.trim());
      }
      return result;
    },
    async search(query: SearchQuery) {
      const needle = query.text.toLowerCase();
      const issues = await github.listIssues(repo, { limit: 100, since: query.since });
      return issues.filter((i) => `${i.title}\n${i.excerpt}`.toLowerCase().includes(needle)).slice(0, query.limit ?? 20);
    },
    async fetch(ref: string) {
      const m = ref.match(/^ticket:github:(.+)$/);
      if (!m) return null;
      const read = await readTicket(m[1]);
      return read.ok ? read.evidence : null;
    },
  };
}
