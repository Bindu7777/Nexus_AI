// Reading a defect ticket (read-only) and turning it into a structured
// DefectSpec with deterministic rules. No model is involved: the ticket text
// is untrusted input and is only ever parsed, never followed.
import { createReadOnlyHttp, redact } from "../../connectors/http";
import type { TicketConnector } from "../../connectors/tickets/types";
import type { ConnectorContext } from "../nexus-admin/connectors/types";
import { adfToText } from "../lib/tickets/jira";

export type TicketFull = {
  key: string;
  source: "jira" | "github-issues";
  title: string;
  description: string;
  status: string | null;
  priority: string | null;
  labels: string[];
  components: string[];
  environment: string | null;
  versions: string[];
  createdAt: string | null;
  updatedAt: string | null;
  comments: { author: string | null; body: string; createdAt: string | null }[];
  links: { relation: string; key: string; title: string }[];
  attachments: string[];
  url: string | null;
};

export type TicketRead = { ok: true; ticket: TicketFull } | { ok: false; reason: "not-found" | "error" | "unsupported"; message: string };

const text = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? adfToText(v).trim() : "");

/** Jira Cloud (v3, Basic) or Data Center (v2, Bearer), one GET for the whole issue. */
export async function readJiraTicket(ctx: ConnectorContext, key: string): Promise<TicketRead> {
  const cloud = ctx.deployment === "cloud";
  const base = String(cloud ? ctx.config.siteUrl : ctx.baseUrl).replace(/\/$/, "");
  const token = ctx.secrets.token ?? "";
  const auth = cloud ? `Basic ${Buffer.from(`${ctx.config.email}:${token}`).toString("base64")}` : `Bearer ${token}`;
  const http = createReadOnlyHttp({ fetchImpl: ctx.fetchImpl, secrets: [token, auth], baseHeaders: { authorization: auth } });
  const fields = "summary,description,comment,issuelinks,components,environment,versions,created,updated,priority,status,labels,attachment";
  const url = `${base}/rest/api/${cloud ? 3 : 2}/issue/${encodeURIComponent(key)}?fields=${fields}`;
  let res;
  try {
    res = await http.getJson<{ key?: string; fields?: Record<string, unknown> }>(url);
  } catch (error) {
    return { ok: false, reason: "error", message: redact(error instanceof Error ? error.message : String(error), [token, auth]) };
  }
  if (res.status === 404) return { ok: false, reason: "not-found", message: `${key} was not found in Jira, or this account cannot see it.` };
  if (res.status >= 400 || !res.data) return { ok: false, reason: "error", message: `Jira answered HTTP ${res.status} when reading ${key}.` };
  const f = res.data.fields ?? {};
  const named = (v: unknown) => (Array.isArray(v) ? v.map((x) => String((x as { name?: string })?.name ?? "")).filter(Boolean) : []);
  const comments = ((f.comment as { comments?: unknown[] } | undefined)?.comments ?? []).slice(-20).map((c) => {
    const cc = c as { author?: { displayName?: string }; body?: unknown; created?: string };
    return { author: cc.author?.displayName ?? null, body: text(cc.body), createdAt: cc.created ?? null };
  });
  const links = ((f.issuelinks as unknown[]) ?? []).slice(0, 20).map((l) => {
    const ll = l as { type?: { outward?: string; inward?: string }; outwardIssue?: { key?: string; fields?: { summary?: string } }; inwardIssue?: { key?: string; fields?: { summary?: string } } };
    const issue = ll.outwardIssue ?? ll.inwardIssue;
    return { relation: (ll.outwardIssue ? ll.type?.outward : ll.type?.inward) ?? "relates to", key: issue?.key ?? "", title: issue?.fields?.summary ?? "" };
  });
  return {
    ok: true,
    ticket: {
      key: res.data.key ?? key,
      source: "jira",
      title: String(f.summary ?? "").trim(),
      description: text(f.description),
      status: (f.status as { name?: string } | undefined)?.name ?? null,
      priority: (f.priority as { name?: string } | undefined)?.name ?? null,
      labels: Array.isArray(f.labels) ? (f.labels as unknown[]).map(String) : [],
      components: named(f.components),
      environment: text(f.environment) || null,
      versions: named(f.versions),
      createdAt: typeof f.created === "string" ? f.created : null,
      updatedAt: typeof f.updated === "string" ? f.updated : null,
      comments,
      links: links.filter((l) => l.key),
      attachments: ((f.attachment as unknown[]) ?? []).map((a) => String((a as { filename?: string })?.filename ?? "")).filter(Boolean).slice(0, 30),
      url: `${base}/browse/${encodeURIComponent(res.data.key ?? key)}`,
    },
  };
}

export async function readGitHubIssueTicket(connector: TicketConnector, key: string): Promise<TicketRead> {
  const r = await connector.readTicket(key);
  if (!r.ok) return { ok: false, reason: r.reason === "not-found" ? "not-found" : "error", message: r.message };
  const t = r.ticket;
  return {
    ok: true,
    ticket: {
      key: t.key,
      source: "github-issues",
      title: t.title,
      description: t.body,
      status: t.state,
      priority: null,
      labels: t.labels,
      components: [],
      environment: null,
      versions: [],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      comments: t.comments,
      links: [],
      attachments: [],
      url: t.url,
    },
  };
}

// ---------- DefectSpec ----------

export type DefectSpec = {
  area: string | null;
  steps: string[];
  expected: string | null;
  actual: string | null;
  environment: string | null;
  version: string | null;
  identifiers: string[];
  errorMessages: string[];
  codeHints: string[];
  searchTerms: string[];
  firstReportedAt: string | null;
  window: { from: string; to: string } | null;
};

export type SpecResult = { ok: true; spec: DefectSpec } | { ok: false; missing: string[]; partial: DefectSpec };

type Section = "steps" | "expected" | "actual" | "environment" | "version";
const HEADINGS: [Section, RegExp][] = [
  ["steps", /^(?:#+\s*)?(?:\*\*)?\s*(?:steps(?:\s+to\s+(?:reproduce|repro))?|repro(?:duction)?(?:\s+steps)?|how\s+to\s+reproduce)\s*(?:\*\*)?\s*:?\s*(.*)$/i],
  ["expected", /^(?:#+\s*)?(?:\*\*)?\s*expected(?:\s+(?:behaviou?r|result|outcome))?\s*(?:\*\*)?\s*:\s*(.*)$|^(?:#+\s*)?(?:\*\*)?\s*expected(?:\s+(?:behaviou?r|result|outcome))\s*(?:\*\*)?\s*$/i],
  ["actual", /^(?:#+\s*)?(?:\*\*)?\s*(?:actual|observed|current)(?:\s+(?:behaviou?r|result|outcome))?\s*(?:\*\*)?\s*:\s*(.*)$|^(?:#+\s*)?(?:\*\*)?\s*(?:actual|observed|current)(?:\s+(?:behaviou?r|result|outcome))\s*(?:\*\*)?\s*$/i],
  ["environment", /^(?:#+\s*)?(?:\*\*)?\s*(?:environment|env|browser|device|platform)\s*(?:\*\*)?\s*:\s*(.*)$/i],
  ["version", /^(?:#+\s*)?(?:\*\*)?\s*(?:version|build|release)\s*(?:\*\*)?\s*:\s*(.*)$/i],
];
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/;
const STOP = new Set(
  "the a an and or but is are was were be been it its this that these those to of in on for with at by from as not no when then than after before into onto our your their his her they we you i me my can cannot cant could should would will wont does doesnt do dont did didnt has have had get gets got getting page screen user users app application error issue bug problem working work works shows show showing button click clicked please".split(" "),
);

function parseSections(body: string) {
  const out: Partial<Record<Section, string[]>> = {};
  let current: Section | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = HEADINGS.find(([, re]) => re.test(line));
    if (head) {
      current = head[0];
      const m = line.match(head[1]);
      const rest = (m?.[1] ?? m?.[2] ?? "").trim();
      out[current] = out[current] ?? [];
      if (rest) out[current]!.push(rest);
      continue;
    }
    if (/^(?:#+\s|\*\*[^*]+\*\*\s*:?\s*$)/.test(line)) {
      current = null;
      continue;
    }
    if (current) out[current]!.push(line);
  }
  return out;
}

function sentences(body: string) {
  return body
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 6);
}

/**
 * Builds a DefectSpec from ticket text with fixed rules: labelled sections
 * first ("Steps to reproduce", "Expected", "Actual"), then numbered lists and
 * "should" / "instead" sentences. Steps and an expected behaviour are required.
 */
export function extractDefectSpec(ticket: TicketFull): SpecResult {
  const body = [ticket.description, ...ticket.comments.map((c) => c.body)].join("\n");
  const sec = parseSections(ticket.description);
  const strip = (s: string) => s.replace(LIST_ITEM, "$1").trim();
  let steps = (sec.steps ?? []).map(strip).filter(Boolean);
  if (!steps.length) steps = ticket.description.split(/\r?\n/).map((l) => l.match(LIST_ITEM)?.[1]?.trim()).filter((s): s is string => Boolean(s));
  const sents = sentences(ticket.description);
  const expected = (sec.expected ?? []).join(" ").trim() || sents.find((s) => /\b(should|expected|supposed to|ought to)\b/i.test(s)) || null;
  // Explicit contrast ("instead", "but it") wins over generic failure words.
  const actual =
    (sec.actual ?? []).join(" ").trim() ||
    sents.find((s) => /\b(instead|but (?:it|the|we|i)|actually)\b/i.test(s) && s !== expected) ||
    sents.find((s) => /\b(fails?|failing|throws?|crash(?:es)?|errors?|blank|wrong|incorrect|not (?:shown|saved|loading|working))\b/i.test(s) && s !== expected) ||
    null;

  const errorMessages = [...new Set([...body.matchAll(/["“`']([^"”`'\n]{6,160})["”`']/g)].map((m) => m[1].trim()).filter((s) => /error|fail|exception|cannot|unable|invalid|denied|timeout|null|undefined|500|404/i.test(s)))].slice(0, 6);
  const identifiers = [
    ...new Set(
      [
        ...body.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi),
        ...body.matchAll(/\b(?:order|user|booking|payment|invoice|txn|transaction|customer|account|id)[\s#:=_-]*([A-Za-z0-9_-]{3,40})\b/gi),
        ...body.matchAll(/\bHTTP\s?([45]\d\d)\b/gi),
      ].map((m) => (m[1] ?? m[0]).trim()),
    ),
  ].slice(0, 10);
  const codeHints = [
    ...new Set(
      [...body.matchAll(/\b([\w./-]+\.(?:ts|tsx|js|jsx|mjs|py|go|java|rb|php|sql|cs|kt|swift))(?::(\d+))?\b/g), ...body.matchAll(/`([A-Za-z_][\w.]{2,60})`/g), ...body.matchAll(/\/api\/[\w/-]{2,80}/g)].map((m) => (m[1] ?? m[0]).trim()),
    ),
  ].slice(0, 10);
  const words = `${ticket.title} ${ticket.components.join(" ")}`
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  const searchTerms = [...new Set([...codeHints.filter((h) => !h.includes("/") || h.startsWith("/api/")), ...errorMessages.map((e) => e.slice(0, 60)), ...words])].slice(0, 8);
  const created = ticket.createdAt ? Date.parse(ticket.createdAt) : NaN;
  const spec: DefectSpec = {
    area: ticket.components[0] ?? (words[0] ?? null),
    steps: steps.slice(0, 20),
    expected,
    actual,
    environment: (sec.environment ?? []).join(" ").trim() || ticket.environment || null,
    version: (sec.version ?? []).join(" ").trim() || ticket.versions[0] || null,
    identifiers,
    errorMessages,
    codeHints,
    searchTerms,
    firstReportedAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
    window: Number.isFinite(created) ? { from: new Date(created - 72 * 3600_000).toISOString(), to: new Date(created + 24 * 3600_000).toISOString() } : null,
  };
  const missing: string[] = [];
  if (ticket.description.trim().length < 20) missing.push("A description of the problem: what you were doing and what went wrong.");
  if (!spec.steps.length) missing.push('Steps to reproduce, as a numbered list under a "Steps to reproduce" heading (for example: 1. Open the booking page 2. Choose a date 3. Press Pay).');
  if (!spec.expected) missing.push('The expected behaviour, under an "Expected" heading (what should have happened).');
  if (!spec.actual) missing.push('The actual behaviour, under an "Actual" heading (what happened instead, with any error message exactly as shown).');
  return missing.length ? { ok: false, missing, partial: spec } : { ok: true, spec };
}
