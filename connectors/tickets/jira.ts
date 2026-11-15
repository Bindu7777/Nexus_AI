// Jira behind the shared connector interface. The issue read itself is the
// existing, unchanged src/lib/tickets/jira.ts fetchJiraIssue (HTTP GET only).
// test() and search() add two more GETs: /myself and /search/jql.
import { fetchJiraIssue, jiraConfigured, jiraSettings, type JiraEnv } from "../../src/lib/tickets/jira";
import { createReadOnlyHttp, type FetchLike, redact } from "../http";
import { emptyTestResult, nowIso, type SearchQuery } from "../types";
import { type TicketConnector, type TicketRecord, ticketEvidence } from "./types";

export function createJiraConnector(options: { env?: JiraEnv; fetchImpl?: FetchLike } = {}): TicketConnector {
  const env = options.env ?? process.env;
  const settings = jiraSettings(env);
  const auth = settings.email && settings.token ? Buffer.from(`${settings.email}:${settings.token}`).toString("base64") : "";
  const http = createReadOnlyHttp({
    fetchImpl: options.fetchImpl,
    secrets: [settings.token, auth],
    baseHeaders: auth ? { authorization: `Basic ${auth}` } : {},
  });
  const clean = (m: string) => redact(m, [settings.token, auth]);

  async function readTicket(key: string) {
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key.trim())) {
      return { ok: false as const, reason: "invalid-key" as const, message: `"${key}" is not a Jira issue key such as ${settings.projectKey}-12.` };
    }
    if (!jiraConfigured(env)) {
      return { ok: false as const, reason: "unconfigured" as const, message: "Jira is not connected. Set JIRA_EMAIL and JIRA_API_TOKEN." };
    }
    const result = await fetchJiraIssue(key.trim(), env, options.fetchImpl);
    if (!result.ok) {
      if (result.reason === "not-found") return { ok: false as const, reason: "not-found" as const, message: `Jira had no issue ${key}.` };
      return { ok: false as const, reason: "error" as const, message: clean("message" in result && result.message ? result.message : "Jira read failed.") };
    }
    const t = result.ticket;
    const ticket: TicketRecord = {
      key: t.id,
      source: "jira",
      title: t.title,
      body: t.symptom,
      state: null,
      labels: t.labels,
      author: t.reporter,
      createdAt: t.openedAt || null,
      updatedAt: null,
      url: `${settings.baseUrl}/browse/${encodeURIComponent(t.id)}`,
      comments: [],
      trust: "untrusted-input",
    };
    return { ok: true as const, ticket, evidence: ticketEvidence(ticket, `ticket:jira:${t.id}`, nowIso()), engineTicket: t };
  }

  return {
    id: "jira",
    kind: "tickets",
    readOnly: true,
    implemented: true,
    description: `Jira project ${settings.projectKey} at ${settings.baseUrl}, read with HTTP GET only.`,
    readTicket,
    async test() {
      const result = emptyTestResult();
      if (!jiraConfigured(env)) {
        result.problems.push("Set JIRA_EMAIL and JIRA_API_TOKEN (and JIRA_BASE_URL, JIRA_PROJECT_KEY) to connect Jira.");
        return result;
      }
      try {
        const me = await http.getJson<{ displayName?: string }>(`${settings.baseUrl}/rest/api/3/myself`);
        if (me.status !== 200) {
          result.problems.push(`Jira rejected the credentials (HTTP ${me.status}). Check the email and API token.`);
          return result;
        }
        result.reached.push(`Jira ${settings.baseUrl} as ${me.data?.displayName ?? "the configured account"}`);
        const project = await http.getJson<{ name?: string; key?: string }>(
          `${settings.baseUrl}/rest/api/3/project/${encodeURIComponent(settings.projectKey)}`,
        );
        if (project.status === 200) result.reached.push(`Project ${project.data?.key} (${project.data?.name})`);
        else result.problems.push(`Project ${settings.projectKey} was not visible (HTTP ${project.status}).`);
        result.ok = result.problems.length === 0;
      } catch (error) {
        result.problems.push(clean(error instanceof Error ? error.message : String(error)));
      }
      return result;
    },
    async search(query: SearchQuery) {
      if (!jiraConfigured(env)) return [];
      const text = query.text.replace(/["\\]/g, " ").trim();
      const jql = `project = "${settings.projectKey}" AND text ~ "${text}" ORDER BY updated DESC`;
      const params = new URLSearchParams({ jql, maxResults: String(Math.min(query.limit ?? 20, 50)), fields: "summary,updated,status" });
      const res = await http.getJson<{ issues?: { key: string; fields?: { summary?: string; updated?: string; status?: { name?: string } } }[] }>(
        `${settings.baseUrl}/rest/api/3/search/jql?${params}`,
      );
      if (res.status !== 200) throw new Error(`Jira search returned HTTP ${res.status}.`);
      const retrievedAt = nowIso();
      return (res.data?.issues ?? []).map((i) => ({
        source: "jira",
        kind: "tickets" as const,
        ref: `ticket:jira:${i.key}`,
        timestamp: i.fields?.updated ?? null,
        retrievedAt,
        title: `${i.key} ${i.fields?.summary ?? ""}`,
        excerpt: i.fields?.summary ?? "",
        observation: "observed" as const,
        location: { url: `${settings.baseUrl}/browse/${i.key}` },
        meta: { state: i.fields?.status?.name ?? null, trust: "untrusted-input" },
      }));
    },
    async fetch(ref: string) {
      const m = ref.match(/^ticket:jira:(.+)$/);
      if (!m) return null;
      const read = await readTicket(m[1]);
      return read.ok ? read.evidence : null;
    },
  };
}
