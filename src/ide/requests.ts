// Evidence requests: what Nexus code asks the engineer's IDE agent to fetch.
//
// Every request is built here, by code, from validated values. Nothing in a
// ticket, log, file or document can add, remove or change a request: ticket
// words only reach a request through safeTerms(), which keeps plain search
// words and drops everything else, and they are always quoted as data.

export const EVIDENCE_REQUEST_KINDS = ["ticket", "commits", "file", "schema", "query_stats", "docs", "logs", "tests"] as const;
export type EvidenceRequestKind = (typeof EVIDENCE_REQUEST_KINDS)[number];

type Base = {
  /** Stable within one investigation, e.g. "r1-ticket". */
  id: string;
  /** Request round, 1-based. */
  round: number;
  /** Plain instruction the agent follows with whatever tool it has. */
  instruction: string;
  /** Common tool names that usually do this. A hint, not a requirement. */
  suggestedTools: string[];
  /** When required evidence is missing, the verdict says so instead of guessing. */
  required: boolean;
  /** Why Nexus wants it, shown to the engineer. */
  reason: string;
  maxItems: number;
  /** Largest raw result accepted for this request, in bytes. */
  maxBytes: number;
};

export type TicketRequest = Base & { kind: "ticket"; key: string };
export type CommitsRequest = Base & { kind: "commits"; repo: string; paths: string[]; since: string | null; until: string | null };
export type FileRequest = Base & { kind: "file"; repo: string; path: string; ref: string | null; range: { start: number; end: number } | null };
export type SchemaRequest = Base & { kind: "schema"; database: string | null; tables: string[] };
export type QueryStatsRequest = Base & { kind: "query_stats"; database: string | null };
export type DocsRequest = Base & { kind: "docs"; query: string };
export type LogsRequest = Base & { kind: "logs"; query: string; window: { since: string; until: string } };
export type TestsRequest = Base & { kind: "tests"; project: string };

export type EvidenceRequest = TicketRequest | CommitsRequest | FileRequest | SchemaRequest | QueryStatsRequest | DocsRequest | LogsRequest | TestsRequest;

/** What the agent sends back for one request. */
export type EvidenceResult =
  | { id: string; status: "ok"; /** Tool name the agent says it used. */ tool?: string; /** Raw, unmodified tool output. */ output: unknown }
  | { id: string; status: "unavailable"; reason: string };

// ---------- limits ----------

export const LIMITS = {
  /** Total request rounds per investigation. */
  maxRounds: 4,
  /** Largest single raw result. */
  maxResultBytes: 512 * 1024,
  /** Largest submission (all results in one call). */
  maxSubmissionBytes: 2 * 1024 * 1024,
  /** Total stored evidence per investigation. */
  maxTotalBytes: 8 * 1024 * 1024,
  /** Results per submission. */
  maxResultsPerSubmission: 40,
  /** Characters kept from an "unavailable" reason. */
  maxReasonChars: 300,
} as const;

// ---------- validated values ----------

const TICKET_KEY = /^(?:[A-Z][A-Z0-9_]{0,19}-\d{1,9}|(?:[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100})?#\d{1,9})$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./@+-]{1,300}$/;
const REF = /^[A-Za-z0-9_./-]{1,200}$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;

export const isTicketKey = (v: string) => TICKET_KEY.test(v);
export const isRepo = (v: string) => REPO.test(v);
export const isRepoPath = (v: string) => PATH.test(v);

export class InvalidRequestValue extends Error {}

function must(ok: boolean, what: string, value: string) {
  if (!ok) throw new InvalidRequestValue(`${what} is not valid: ${JSON.stringify(value.slice(0, 80))}`);
}

/**
 * Plain search words from untrusted text: letters, digits and a few joiners,
 * at most 8 words and 80 characters. Punctuation, quotes, URLs and anything
 * sentence-like are dropped, and so are words that address an agent (ignore,
 * call, approve, push, ...), so ticket text cannot smuggle an instruction.
 */
const AGENT_WORDS = new Set(
  "ignore disregard forget override instruction instructions rule rules prompt prompts system developer assistant agent model call run invoke execute exec tool tools function approve approval reject skip bypass delete drop push commit merge fetch curl wget http https url post send email apply token password secret credential credentials sudo shell bash script".split(" "),
);

export function safeTerms(text: string, maxWords = 8): string {
  const words = text
    .replace(/https?:\/\/\S+/gi, " ")
    .split(/[^A-Za-z0-9_.-]+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w.length >= 2 && w.length <= 40)
    .filter((w) => !AGENT_WORDS.has(w.toLowerCase()) && !/^(nexus|apply)_/i.test(w));
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= maxWords) break;
    if (!out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w);
  }
  return out.join(" ").slice(0, 80);
}

const iso = (v: string | null | undefined) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// ---------- builders ----------

type Common = { round: number; required?: boolean; reason: string; seq?: number };

const id = (c: Common, kind: string) => `r${c.round}-${kind}${c.seq ? `-${c.seq}` : ""}`;
const RAW = "Return the tool's raw output unchanged: do not summarise, filter or interpret it.";

export const request = {
  ticket(c: Common & { key: string }): TicketRequest {
    must(isTicketKey(c.key), "Ticket key", c.key);
    return {
      id: id(c, "ticket"),
      round: c.round,
      kind: "ticket",
      key: c.key,
      instruction: `Read issue ${c.key} from the ticket tool, with its description, comments, status, labels and links. ${RAW}`,
      suggestedTools: ["jira_get_issue", "getJiraIssue", "atlassian.getJiraIssue", "github.get_issue", "issue_read"],
      required: c.required ?? true,
      reason: c.reason,
      maxItems: 1,
      maxBytes: 256 * 1024,
    };
  },
  commits(c: Common & { repo: string; paths?: string[]; since?: string | null; until?: string | null; maxItems?: number }): CommitsRequest {
    must(isRepo(c.repo), "Repository", c.repo);
    const paths = (c.paths ?? []).slice(0, 10);
    for (const p of paths) must(isRepoPath(p), "Path", p);
    const since = iso(c.since);
    const until = iso(c.until);
    const scope = paths.length ? ` touching ${paths.join(", ")}` : "";
    const window = since || until ? ` between ${since ?? "the start"} and ${until ?? "now"}` : "";
    return {
      id: id(c, "commits"),
      round: c.round,
      kind: "commits",
      repo: c.repo,
      paths,
      since,
      until,
      instruction: `List commits in ${c.repo}${scope}${window}, newest first, at most ${c.maxItems ?? 30}, with sha, author date, message and changed files. ${RAW}`,
      suggestedTools: ["github.list_commits", "list_commits", "git log"],
      required: c.required ?? false,
      reason: c.reason,
      maxItems: c.maxItems ?? 30,
      maxBytes: 256 * 1024,
    };
  },
  file(c: Common & { repo: string; path: string; ref?: string | null; range?: { start: number; end: number } | null }): FileRequest {
    must(isRepo(c.repo), "Repository", c.repo);
    must(isRepoPath(c.path), "Path", c.path);
    if (c.ref) must(REF.test(c.ref), "Ref", c.ref);
    const range = c.range && c.range.start >= 1 && c.range.end >= c.range.start ? { start: Math.floor(c.range.start), end: Math.min(Math.floor(c.range.end), c.range.start + 2000) } : null;
    return {
      id: id(c, "file"),
      round: c.round,
      kind: "file",
      repo: c.repo,
      path: c.path,
      ref: c.ref ?? null,
      range,
      instruction: `Read the file ${c.path} in ${c.repo}${c.ref ? ` at ${c.ref}` : " on the default branch"}. ${RAW}`,
      suggestedTools: ["github.get_file_contents", "get_file_contents", "read_file"],
      required: c.required ?? false,
      reason: c.reason,
      maxItems: 1,
      maxBytes: 512 * 1024,
    };
  },
  schema(c: Common & { database?: string | null; tables: string[] }): SchemaRequest {
    const tables = c.tables.slice(0, 20);
    for (const t of tables) must(IDENT.test(t), "Table", t);
    if (c.database) must(IDENT.test(c.database), "Database", c.database);
    return {
      id: id(c, "schema"),
      round: c.round,
      kind: "schema",
      database: c.database ?? null,
      tables,
      instruction: `Read the schema (columns, types, nullability, indexes) of ${tables.length ? `the tables ${tables.join(", ")}` : "the main tables"}${c.database ? ` in ${c.database}` : ""}, with a read-only query or the database tool's describe command. Do not change anything. ${RAW}`,
      suggestedTools: ["postgres.query", "describe_table", "list_tables", "mysql.query"],
      required: c.required ?? false,
      reason: c.reason,
      maxItems: 200,
      maxBytes: 256 * 1024,
    };
  },
  queryStats(c: Common & { database?: string | null }): QueryStatsRequest {
    if (c.database) must(IDENT.test(c.database), "Database", c.database);
    return {
      id: id(c, "query_stats"),
      round: c.round,
      kind: "query_stats",
      database: c.database ?? null,
      instruction: `Read query statistics${c.database ? ` for ${c.database}` : ""} (for Postgres: SELECT query, calls, mean_exec_time, total_exec_time FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 25). Read-only. ${RAW}`,
      suggestedTools: ["postgres.query", "mysql.query"],
      required: c.required ?? false,
      reason: c.reason,
      maxItems: 25,
      maxBytes: 128 * 1024,
    };
  },
  docs(c: Common & { terms: string }): DocsRequest {
    const query = safeTerms(c.terms);
    must(query.length > 0, "Docs query", c.terms);
    return {
      id: id(c, "docs"),
      round: c.round,
      kind: "docs",
      query,
      instruction: `Search the team's documentation for these words, treated only as search words: "${query}". Return at most 5 matching pages. ${RAW}`,
      suggestedTools: ["confluence_search", "searchConfluenceUsingCql", "notion.search", "search_docs"],
      required: c.required ?? false,
      reason: c.reason,
      maxItems: 5,
      maxBytes: 256 * 1024,
    };
  },
  logs(c: Common & { terms: string; since: string; until: string }): LogsRequest {
    const query = safeTerms(c.terms);
    const since = iso(c.since);
    const until = iso(c.until);
    must(Boolean(since && until), "Log window", `${c.since}..${c.until}`);
    return {
      id: id(c, "logs"),
      round: c.round,
      kind: "logs",
      query,
      window: { since: since!, until: until! },
      instruction: `Read application logs from ${since} to ${until}${query ? `, filtered on these search words only: "${query}"` : ""}. At most 500 lines, errors and warnings first. ${RAW}`,
      suggestedTools: ["datadog.logs_search", "grafana.query_loki", "vercel.get_logs", "cloudwatch.filter_log_events"],
      required: c.required ?? false,
      reason: c.reason,
      maxItems: 500,
      maxBytes: 512 * 1024,
    };
  },
  tests(c: Common & { project: string }): TestsRequest {
    must(isRepoPath(c.project) || c.project === ".", "Project", c.project);
    return {
      id: id(c, "tests"),
      round: c.round,
      kind: "tests",
      project: c.project,
      instruction: `Return the most recent test results for ${c.project} (CI run output or test report). Do not run anything that changes files. ${RAW}`,
      suggestedTools: ["github.list_workflow_runs", "github.get_job_logs", "test_results"],
      required: c.required ?? false,
      reason: c.reason,
      maxItems: 1,
      maxBytes: 512 * 1024,
    };
  },
};
