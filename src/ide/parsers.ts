// Per-kind parsers for raw results the IDE agent submits.
//
// Input is whatever the agent's tool returned: a JSON value, a JSON string,
// an MCP content array, or plain text. Output is EvidenceItems marked
// client-supplied, redacted, with a hash of the raw result. A parser only ever
// produces evidence: it cannot produce a request, a verdict or an action, so
// content inside a result cannot steer the investigation.
import { createHash } from "node:crypto";
import { clip, type EvidenceItem } from "../../connectors/types";
import { jiraIssueToTicket, type TicketFull } from "../investigation/ticket";
import { adfToText } from "../lib/tickets/jira";
import { mergeCounts, redactEvidenceText, type RedactionCount } from "./redact";
import { LIMITS, type EvidenceRequest, type EvidenceResult } from "./requests";

export type ParsedResult =
  | {
      ok: true;
      items: EvidenceItem[];
      /** Structured ticket, for the ticket request only. */
      ticket?: TicketFull;
      /** One line for the progress view, e.g. "12 commits in window". */
      summary: string;
      rawSha256: string;
      bytes: number;
      tool: string | null;
      redactions: RedactionCount[];
    }
  | { ok: false; error: string; rawSha256: string | null; bytes: number };

type Ok = Extract<EvidenceResult, { status: "ok" }>;

// ---------- raw handling ----------

export function canonicalRaw(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output) ?? "";
  } catch {
    return "";
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Unwrap MCP content arrays and JSON strings into a value or plain text. */
export function unwrap(output: unknown, depth = 0): unknown {
  if (depth > 3) return output;
  if (typeof output === "string") {
    const t = output.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return unwrap(JSON.parse(t), depth + 1);
      } catch {
        return output;
      }
    }
    return output;
  }
  const content = Array.isArray(output)
    ? output
    : output && typeof output === "object" && Array.isArray((output as { content?: unknown }).content)
      ? (output as { content: unknown[] }).content
      : null;
  if (content && content.length && content.every((c) => c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string")) {
    const joined = content.map((c) => (c as { text: string }).text).join("\n");
    return unwrap(joined, depth + 1);
  }
  return output;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const pick = (o: Record<string, unknown> | null, ...paths: string[]): unknown => {
  for (const p of paths) {
    let cur: unknown = o;
    for (const k of p.split(".")) cur = obj(cur)?.[k];
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
};
const isoOrNull = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** First array found at the top or under a common wrapper key. */
function listOf(v: unknown, ...keys: string[]): unknown[] | null {
  if (Array.isArray(v)) return v;
  const o = obj(v);
  for (const k of [...keys, "items", "results", "data", "rows", "nodes", "values"]) if (Array.isArray(o?.[k])) return o![k] as unknown[];
  return null;
}

// ---------- item factory ----------

class Builder {
  redactions: RedactionCount[] = [];
  constructor(
    private req: EvidenceRequest,
    private tool: string | null,
    private rawHash: string,
    private now: string,
  ) {}
  clean(text: string, max = 6000) {
    const r = redactEvidenceText(text);
    this.redactions = mergeCounts(this.redactions, r.redactions);
    return clip(r.text, max);
  }
  item(i: Omit<EvidenceItem, "source" | "retrievedAt" | "observation" | "provenance" | "excerpt"> & { excerpt: string; meta?: Record<string, unknown> }, max?: number): EvidenceItem {
    return {
      ...i,
      title: this.clean(i.title, 300),
      excerpt: this.clean(i.excerpt, max),
      source: "ide-agent",
      retrievedAt: this.now,
      observation: "observed",
      provenance: "client-supplied",
      meta: {
        ...(i.meta ?? {}),
        requestId: this.req.id,
        evidenceKind: this.req.kind,
        reportedTool: this.tool,
        rawSha256: this.rawHash,
        trust: "untrusted-input",
      },
    };
  }
}

class Reject extends Error {}

// ---------- entry point ----------

export function parseResult(req: EvidenceRequest, result: Ok, now = new Date()): ParsedResult {
  const raw = canonicalRaw(result.output);
  const bytes = Buffer.byteLength(raw, "utf8");
  const rawSha256 = raw ? sha256(raw) : null;
  const limit = Math.min(req.maxBytes, LIMITS.maxResultBytes);
  if (!raw.trim()) return { ok: false, error: "The result is empty. Send the tool's raw output, or mark the request unavailable with a reason.", rawSha256, bytes };
  if (bytes > limit) return { ok: false, error: `The result is ${bytes} bytes; the limit for this request is ${limit}. Narrow the query and send it again.`, rawSha256, bytes };
  const tool = str(result.tool)?.slice(0, 120) ?? null;
  const b = new Builder(req, tool, rawSha256!, now.toISOString());
  const value = unwrap(result.output);
  try {
    const out = PARSERS[req.kind](req as never, value, b);
    return { ok: true, items: out.items.slice(0, req.maxItems), ticket: out.ticket, summary: out.summary, rawSha256: rawSha256!, bytes, tool, redactions: b.redactions };
  } catch (error) {
    if (error instanceof Reject) return { ok: false, error: error.message, rawSha256, bytes };
    return { ok: false, error: "The result could not be read.", rawSha256, bytes };
  }
}

type Out = { items: EvidenceItem[]; summary: string; ticket?: TicketFull };
type Parser<K extends EvidenceRequest["kind"]> = (req: Extract<EvidenceRequest, { kind: K }>, value: unknown, b: Builder) => Out;

const asText = (v: unknown) => (typeof v === "string" ? v : null);
const errorLike = (v: unknown) => {
  const o = obj(v);
  const t = asText(v);
  if (o && (o.error || o.errorMessages) && Object.keys(o).length <= 4) return str(o.error) ?? str((o.errorMessages as unknown[])?.[0]) ?? "error";
  if (t && /^\s*(error|fatal|not found|404|403|401|permission denied)\b/i.test(t) && t.length < 400) return t.trim();
  return null;
};
function noError(v: unknown) {
  const e = errorLike(v);
  if (e) throw new Reject(`The tool reported an error instead of a result (${e.slice(0, 160)}). Mark the request unavailable with that reason, or retry.`);
}

// ---------- ticket ----------

function keyMatches(requested: string, found: string | null) {
  if (!found) return true;
  const r = requested.toUpperCase();
  const f = found.toUpperCase();
  if (r === f) return true;
  const rn = r.match(/#(\d+)$/)?.[1];
  return Boolean(rn && (f === rn || f.endsWith(`#${rn}`)));
}

const ticket: Parser<"ticket"> = (req, value, b) => {
  noError(value);
  const o = obj(value);
  let t: TicketFull | null = null;
  if (o && obj(o.fields)) {
    const key = str(o.key);
    if (!keyMatches(req.key, key)) throw new Reject(`The result is ticket ${key}, not ${req.key}.`);
    const self = str(o.self);
    const base = self ? self.replace(/\/rest\/api\/.*$/, "") : "";
    t = jiraIssueToTicket(o as { key?: string; fields?: Record<string, unknown> }, base, req.key);
  } else if (o && (o.number !== undefined || str(o.html_url)?.includes("/issues/")) && str(o.title)) {
    if (!keyMatches(req.key, str(o.number))) throw new Reject(`The result is issue #${String(o.number)}, not ${req.key}.`);
    const comments = (listOf(o.comments) ?? []).slice(-20).map((c) => ({ author: str(pick(obj(c), "user.login", "author.login", "author")) , body: str(pick(obj(c), "body")) ?? "", createdAt: isoOrNull(pick(obj(c), "created_at", "createdAt")) }));
    t = {
      key: req.key,
      source: "github-issues",
      title: str(o.title)!.trim(),
      description: str(o.body) ?? "",
      status: str(o.state),
      priority: null,
      labels: (listOf(o.labels) ?? []).map((l) => str(pick(obj(l), "name")) ?? str(l)).filter((x): x is string => Boolean(x)),
      components: [],
      environment: null,
      versions: [],
      createdAt: isoOrNull(pick(o, "created_at", "createdAt")),
      updatedAt: isoOrNull(pick(o, "updated_at", "updatedAt")),
      comments,
      links: [],
      attachments: [],
      url: str(o.html_url) ?? str(o.url),
    };
  } else if (o && str(pick(o, "summary", "title"))) {
    const key = str(pick(o, "key", "id", "identifier"));
    if (!keyMatches(req.key, key)) throw new Reject(`The result is ticket ${key}, not ${req.key}.`);
    const desc = pick(o, "description", "body");
    t = {
      key: req.key,
      source: "jira",
      title: str(pick(o, "summary", "title"))!.trim(),
      description: typeof desc === "string" ? desc : desc && typeof desc === "object" ? adfToText(desc).trim() : "",
      status: str(pick(o, "status.name", "status")),
      priority: str(pick(o, "priority.name", "priority")),
      labels: (listOf(o.labels) ?? []).map((l) => str(l) ?? str(pick(obj(l), "name"))).filter((x): x is string => Boolean(x)),
      components: [],
      environment: str(o.environment),
      versions: [],
      createdAt: isoOrNull(pick(o, "created", "createdAt", "created_at")),
      updatedAt: isoOrNull(pick(o, "updated", "updatedAt", "updated_at")),
      comments: (listOf(pick(o, "comments", "comment.comments")) ?? []).slice(-20).map((c) => ({ author: str(pick(obj(c), "author.displayName", "author")), body: str(pick(obj(c), "body")) ?? "", createdAt: isoOrNull(pick(obj(c), "created", "createdAt")) })),
      links: [],
      attachments: [],
      url: str(pick(o, "url", "link")),
    };
  } else if (typeof value === "string") {
    const needle = req.key.includes("#") ? `#${req.key.split("#").pop()}` : req.key;
    if (!value.toUpperCase().includes(needle.toUpperCase())) {
      throw new Reject(`The text result does not mention ${req.key}. Send the ticket tool's raw output for ${req.key}.`);
    }
    const lines = value.trim().split("\n");
    const title = lines.find((l) => l.trim() && !l.toUpperCase().includes(req.key.toUpperCase()))?.trim() ?? lines[0].trim();
    t = { key: req.key, source: "jira", title: title.replace(/^(summary|title)\s*:\s*/i, "").slice(0, 300), description: value, status: null, priority: null, labels: [], components: [], environment: null, versions: [], createdAt: null, updatedAt: null, comments: [], links: [], attachments: [], url: null };
  }
  if (!t || !t.title) throw new Reject(`The result does not look like ticket ${req.key}: no title or summary was found.`);
  const clean: TicketFull = {
    ...t,
    title: b.clean(t.title, 300),
    description: b.clean(t.description, 20_000),
    comments: t.comments.map((c) => ({ ...c, author: c.author ? b.clean(c.author, 120) : null, body: b.clean(c.body, 4000) })),
  };
  const comments = clean.comments.map((c) => `--- ${c.author ?? "unknown"} ${c.createdAt ?? ""}\n${c.body}`).join("\n");
  const item = b.item(
    {
      kind: "tickets",
      ref: `ide:ticket:${req.key}`,
      timestamp: clean.updatedAt ?? clean.createdAt,
      title: `${req.key} ${clean.title}`,
      excerpt: `${clean.title}\n\n${clean.description}${comments ? `\n\nComments:\n${comments}` : ""}`,
      location: clean.url ? { url: clean.url } : undefined,
      meta: { status: clean.status, labels: clean.labels },
    },
    20_000,
  );
  return { items: [item], ticket: clean, summary: `${clean.source === "github-issues" ? "GitHub issue" : "Ticket"} ${req.key} read` };
};

// ---------- commits ----------

type Commit = { sha: string; date: string | null; author: string | null; message: string; files: string[] };

function commitsFromGitLog(text: string): Commit[] {
  const out: Commit[] = [];
  for (const block of text.split(/^(?=commit [0-9a-f]{7,40}\b)/m)) {
    const sha = block.match(/^commit ([0-9a-f]{7,40})/)?.[1];
    if (!sha) continue;
    const author = block.match(/^Author:\s*(.+)$/m)?.[1]?.trim() ?? null;
    const date = isoOrNull(block.match(/^(?:Date|AuthorDate|CommitDate):\s*(.+)$/m)?.[1]?.trim());
    const rest = block.split("\n").slice(1).filter((l) => !/^(Author|Date|AuthorDate|Commit|CommitDate|Merge):/.test(l));
    const message = rest.filter((l) => /^ {4}/.test(l)).map((l) => l.slice(4)).join("\n").trim();
    const files = rest.filter((l) => /^(?:[AMDRT]\d*\t|\S.*\s\|\s+\d+)/.test(l)).map((l) => l.replace(/^[AMDRT]\d*\t/, "").replace(/\s+\|.*$/, "").trim()).filter(Boolean);
    out.push({ sha, date, author, message, files });
  }
  return out;
}

const commits: Parser<"commits"> = (req, value, b) => {
  noError(value);
  let list: Commit[];
  const arr = listOf(value, "commits");
  if (arr) {
    list = arr.map((c) => {
      const o = obj(c);
      return {
        sha: str(pick(o, "sha", "oid", "id", "hash")) ?? "",
        date: isoOrNull(pick(o, "commit.author.date", "commit.committer.date", "authoredDate", "committedDate", "date", "created_at")),
        author: str(pick(o, "commit.author.name", "author.login", "author.name", "authorName", "author")),
        message: str(pick(o, "commit.message", "message", "messageHeadline", "title")) ?? "",
        files: (listOf(pick(o, "files", "changedFiles")) ?? []).map((f) => str(pick(obj(f), "filename", "path")) ?? str(f)).filter((x): x is string => Boolean(x)),
      };
    });
  } else if (typeof value === "string") {
    list = commitsFromGitLog(value);
    if (!list.length && value.trim() && !/no commits/i.test(value)) throw new Reject("The commits result is neither a JSON list of commits nor git log output.");
  } else {
    throw new Reject("The commits result is neither a JSON list of commits nor git log output.");
  }
  list = list.filter((c) => /^[0-9a-f]{7,40}$/i.test(c.sha));
  const items = list.slice(0, req.maxItems).map((c) =>
    b.item({
      kind: "code",
      ref: `ide:commit:${req.repo}@${c.sha}`,
      timestamp: c.date,
      title: `${c.sha.slice(0, 7)} ${c.message.split("\n")[0]}`,
      excerpt: `${c.message}${c.files.length ? `\n\nFiles:\n${c.files.slice(0, 50).join("\n")}` : ""}`,
      location: { revision: c.sha },
      meta: { repo: req.repo, author: c.author ? b.clean(c.author, 120) : null, files: c.files.slice(0, 50) },
    }, 4000),
  );
  return { items, summary: `${items.length} commit${items.length === 1 ? "" : "s"} in window` };
};

// ---------- file ----------

const file: Parser<"file"> = (req, value, b) => {
  noError(value);
  let text: string | null = null;
  let sha: string | null = null;
  const o = obj(value);
  if (o && str(o.content)) {
    const enc = str(o.encoding);
    text = enc === "base64" ? Buffer.from(String(o.content).replace(/\s/g, ""), "base64").toString("utf8") : String(o.content);
    sha = str(o.sha);
    const p = str(o.path);
    if (p && p.replace(/^\/+/, "") !== req.path) throw new Reject(`The result is ${p}, not ${req.path}.`);
  } else if (o && str(o.text)) {
    text = String(o.text);
  } else if (typeof value === "string") {
    text = value;
  }
  if (text === null) throw new Reject(`The result does not hold the contents of ${req.path}.`);
  if (/\u0000/.test(text.slice(0, 2000))) throw new Reject(`${req.path} looks like a binary file; Nexus reads text files only.`);
  const lines = text.split("\n");
  const start = req.range ? req.range.start : 1;
  const end = req.range ? Math.min(req.range.end, lines.length) : Math.min(lines.length, 400);
  const excerpt = lines.slice(start - 1, end).join("\n");
  const item = b.item(
    {
      kind: "code",
      ref: `ide:file:${req.repo}@${req.ref ?? "default"}:${req.path}#L${start}-L${end}`,
      timestamp: null,
      title: `${req.path} lines ${start}-${end}`,
      excerpt,
      location: { path: req.path, startLine: start, endLine: end, revision: sha ?? req.ref ?? undefined },
      meta: { repo: req.repo, totalLines: lines.length },
    },
    40_000,
  );
  return { items: [item], summary: `${req.path} read (${lines.length} lines)` };
};

// ---------- schema ----------

const schema: Parser<"schema"> = (req, value, b) => {
  noError(value);
  const tables = new Map<string, string[]>();
  const add = (t: string, col: string) => {
    const list = tables.get(t) ?? [];
    list.push(col);
    tables.set(t, list);
  };
  const arr = listOf(value, "tables", "columns");
  if (arr) {
    for (const r of arr) {
      const o = obj(r);
      const cols = listOf(o?.columns);
      const tname = str(pick(o, "table_name", "tableName", "table", "name"));
      if (cols && tname) {
        for (const c of cols) {
          const co = obj(c);
          add(tname, `${str(pick(co, "column_name", "name")) ?? str(c) ?? "?"} ${str(pick(co, "data_type", "type")) ?? ""}${pick(co, "is_nullable", "nullable") === "NO" || pick(co, "nullable") === false ? " not null" : ""}`.trim());
        }
      } else if (tname && str(pick(o, "column_name", "column"))) {
        add(tname, `${str(pick(o, "column_name", "column"))} ${str(pick(o, "data_type", "type")) ?? ""}${pick(o, "is_nullable") === "NO" ? " not null" : ""}`.trim());
      } else if (tname) {
        add(tname, "");
      }
    }
  } else if (typeof value === "string") {
    for (const m of value.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_."]+)\s*\(([\s\S]*?)\);/gi)) {
      const name = m[1].replace(/"/g, "");
      for (const col of m[2].split(",\n")) add(name, col.trim());
    }
    if (!tables.size) {
      // psql \d output: "Table "public.x"" followed by a column table.
      for (const m of value.matchAll(/Table "([^"]+)"\s*\n([\s\S]*?)(?:\n\s*\n|$)/g)) {
        for (const line of m[2].split("\n").slice(2)) if (line.includes("|")) add(m[1], line.split("|").map((s) => s.trim()).filter(Boolean).slice(0, 3).join(" "));
      }
    }
    if (!tables.size) throw new Reject("The schema result has no tables: send information_schema rows as JSON, CREATE TABLE statements, or psql \\d output.");
  } else {
    throw new Reject("The schema result is not a list of tables or columns.");
  }
  const items = [...tables].slice(0, 50).map(([name, cols]) =>
    b.item({
      kind: "database",
      ref: `ide:db:${req.database ?? "default"}:table:${name}`,
      timestamp: null,
      title: `Table ${name}`,
      excerpt: cols.filter(Boolean).join("\n"),
      meta: { table: name, columns: cols.filter(Boolean).length },
    }, 8000),
  );
  return { items, summary: `schema for ${items.length} table${items.length === 1 ? "" : "s"}` };
};

// ---------- query stats ----------

const queryStats: Parser<"query_stats"> = (req, value, b) => {
  noError(value);
  const arr = listOf(value);
  if (!arr) throw new Reject("Query statistics must be a JSON list of rows (query, calls, mean time).");
  const rows = arr.map(obj).filter((o): o is Record<string, unknown> => Boolean(o && str(pick(o, "query", "digest_text", "statement"))));
  if (arr.length && !rows.length) throw new Reject("No row in the result has a query column.");
  const items = rows.slice(0, req.maxItems).map((r, i) => {
    const n = (k: string[]) => {
      const v = Number(pick(r, ...k));
      return Number.isFinite(v) ? v : null;
    };
    const calls = n(["calls", "count_star", "exec_count"]);
    const mean = n(["mean_exec_time", "mean_time", "avg_timer_wait", "mean_ms"]);
    const total = n(["total_exec_time", "total_time", "sum_timer_wait", "total_ms"]);
    return b.item({
      kind: "database",
      ref: `ide:db:${req.database ?? "default"}:query_stats#${i + 1}`,
      timestamp: null,
      title: `Query #${i + 1}: ${calls ?? "?"} calls, mean ${mean ?? "?"} ms`,
      excerpt: String(pick(r, "query", "digest_text", "statement")),
      meta: { calls, meanMs: mean, totalMs: total },
    }, 2000);
  });
  return { items, summary: `query stats for ${items.length} quer${items.length === 1 ? "y" : "ies"}` };
};

// ---------- docs ----------

const docs: Parser<"docs"> = (req, value, b) => {
  noError(value);
  const arr = listOf(value, "pages", "documents");
  let pages: { title: string; url: string | null; text: string }[];
  if (arr) {
    pages = arr.map((p) => {
      const o = obj(p);
      return {
        title: str(pick(o, "title", "name")) ?? "Untitled",
        url: str(pick(o, "url", "_links.webui", "link", "href")),
        text: str(pick(o, "excerpt", "body.storage.value", "body", "content", "text", "snippet")) ?? "",
      };
    });
  } else if (obj(value) && str(pick(obj(value), "title"))) {
    const o = obj(value);
    pages = [{ title: str(pick(o, "title"))!, url: str(pick(o, "url")), text: str(pick(o, "body", "content", "text")) ?? "" }];
  } else if (typeof value === "string") {
    pages = [{ title: `Docs search: ${req.query}`, url: null, text: value }];
  } else {
    throw new Reject("The docs result is not a list of pages or text.");
  }
  const items = pages.slice(0, req.maxItems).map((p, i) =>
    b.item({
      kind: "docs",
      ref: `ide:doc:${p.url ?? `search#${i + 1}`}`,
      timestamp: null,
      title: p.title,
      excerpt: p.text.replace(/<[^>]+>/g, " "),
      location: p.url ? { url: p.url } : undefined,
    }, 6000),
  );
  return { items, summary: `${items.length} doc page${items.length === 1 ? "" : "s"}` };
};

// ---------- logs ----------

const logs: Parser<"logs"> = (req, value, b) => {
  noError(value);
  const arr = listOf(value, "logs", "events", "lines", "entries");
  let lines: { at: string | null; level: string | null; text: string }[];
  if (arr) {
    lines = arr.map((l) => {
      const o = obj(l);
      if (!o) return { at: null, level: null, text: str(l) ?? "" };
      return {
        at: isoOrNull(pick(o, "timestamp", "time", "@timestamp", "date", "ts")),
        level: str(pick(o, "level", "severity", "status", "attributes.level")),
        text: str(pick(o, "message", "msg", "text", "line", "content")) ?? JSON.stringify(o),
      };
    });
  } else if (typeof value === "string") {
    lines = value.split("\n").filter((l) => l.trim()).map((l) => ({
      at: isoOrNull(l.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/)?.[0]),
      level: l.match(/\b(ERROR|WARN(?:ING)?|INFO|DEBUG|FATAL|error|warn|info|debug|fatal)\b/)?.[1]?.toLowerCase() ?? null,
      text: l,
    }));
  } else {
    throw new Reject("The logs result is not a list of log lines or text.");
  }
  lines = lines.filter((l) => l.text.trim()).slice(0, req.maxItems);
  const items = lines.map((l, i) =>
    b.item({
      kind: "logs",
      ref: `ide:log:${req.id}#${i + 1}`,
      timestamp: l.at,
      title: `${l.level ?? "log"} ${l.at ?? ""}`.trim(),
      excerpt: l.text,
      meta: { level: l.level },
    }, 2000),
  );
  const errors = lines.filter((l) => /error|fatal|5\d\d/i.test(l.level ?? "")).length;
  return { items, summary: `logs: ${items.length} line${items.length === 1 ? "" : "s"}${errors ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}` };
};

// ---------- tests ----------

const tests: Parser<"tests"> = (req, value, b) => {
  noError(value);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const o = obj(value);
  const num = (re: RegExp) => {
    const m = text.match(re);
    return m ? Number(m[1] ?? m[2]) : null;
  };
  const passed = (o && Number.isFinite(Number(pick(o, "numPassedTests", "passed", "stats.passes")))) ? Number(pick(o, "numPassedTests", "passed", "stats.passes")) : num(/(?:#\s*pass|passed|passing)\D{0,3}(\d+)|(\d+)\s+(?:passed|passing)/i);
  const failed = (o && Number.isFinite(Number(pick(o, "numFailedTests", "failed", "stats.failures")))) ? Number(pick(o, "numFailedTests", "failed", "stats.failures")) : num(/(?:#\s*fail|failed|failing)\D{0,3}(\d+)|(\d+)\s+(?:failed|failing)/i);
  if (passed === null && failed === null && !/\b(test|spec|suite|pass|fail)\b/i.test(text)) throw new Reject("The tests result does not look like test output.");
  const item = b.item({
    kind: "code",
    ref: `ide:tests:${req.project}`,
    timestamp: null,
    title: `Test results for ${req.project}: ${passed ?? "?"} passed, ${failed ?? "?"} failed`,
    excerpt: text,
    meta: { passed, failed },
  }, 20_000);
  return { items: [item], summary: `tests: ${passed ?? "?"} passed, ${failed ?? "?"} failed` };
};

const PARSERS: { [K in EvidenceRequest["kind"]]: Parser<K> } = {
  ticket,
  commits,
  file,
  schema,
  query_stats: queryStats,
  docs,
  logs,
  tests,
};
