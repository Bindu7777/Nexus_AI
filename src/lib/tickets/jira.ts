import type { EngineTicket } from "../types";

export const JIRA_SITE = "https://nexusintelligence.atlassian.net";
export const JIRA_PROJECT_KEY = "NEX";
export const JIRA_PROJECT_NAME = "NEXUS";
export const JIRA_DEFECT_ISSUE_TYPE = "Defect test";

export type JiraEnv = {
  [key: string]: string | undefined;
  JIRA_BASE_URL?: string;
  JIRA_EMAIL?: string;
  JIRA_API_TOKEN?: string;
  JIRA_PROJECT_KEY?: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
};

export function jiraSettings(env: JiraEnv = process.env) {
  return {
    baseUrl: (env.JIRA_BASE_URL || JIRA_SITE).replace(/\/$/, ""),
    projectKey: env.JIRA_PROJECT_KEY || JIRA_PROJECT_KEY,
    email: env.JIRA_EMAIL?.trim() ?? "",
    token: env.JIRA_API_TOKEN?.trim() ?? "",
    defectIssueType: JIRA_DEFECT_ISSUE_TYPE,
  };
}

export function jiraConfigured(env: JiraEnv = process.env) {
  const settings = jiraSettings(env);
  return Boolean(settings.email && settings.token);
}

export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const current = node as AdfNode;
  const own = typeof current.text === "string" ? current.text : "";
  const children = Array.isArray(current.content) ? current.content.map((child) => adfToText(child)).join("") : "";
  const piece = `${own}${children}`;
  if (current.type === "paragraph" || current.type === "heading") return `${piece}\n`;
  return piece;
}

export function sandboxScenarioFromIssue(input: {
  key?: string;
  summary: string;
  description: string;
  labels?: string[];
}): "lock" | "outage" | "ask-for-info" | null {
  const key = input.key ?? "";
  const text = `${input.summary}\n${input.description}`;
  if (key === "NEX-6" || /503 for all product pages/i.test(text) || /catalog returns 503/i.test(text)) {
    return "outage";
  }
  if (key === "NEX-7" || /wrong cart totals/i.test(text)) return "ask-for-info";
  if (key === "NEX-5" || /p95 latency spikes to over 600 ms/i.test(text)) return "lock";
  return null;
}

export function isSparseJiraText(summary: string, description: string) {
  const body = description.trim();
  const combined = `${summary}\n${body}`;
  if (body.length < 80) return true;
  const mentionsSymptom = /(latency|lock|timeout|error|slow|fail|exception|queue|p95|stall)/i.test(combined);
  if (!mentionsSymptom && body.length < 200) return true;
  return false;
}

export function mapJiraIssue(issue: {
  key?: string;
  fields?: {
    summary?: string;
    description?: unknown;
    issuetype?: { name?: string };
    status?: { name?: string };
    priority?: { name?: string };
    reporter?: { displayName?: string };
    created?: string;
    labels?: string[];
    project?: { key?: string; name?: string };
  };
}, env: JiraEnv = process.env): EngineTicket {
  const settings = jiraSettings(env);
  const fields = issue.fields ?? {};
  const summary = fields.summary?.trim() || "(no summary)";
  const description = typeof fields.description === "string" ? fields.description : adfToText(fields.description).trim();
  const issueType = fields.issuetype?.name ?? null;
  const projectKey = fields.project?.key ?? null;
  const labels = Array.isArray(fields.labels) ? fields.labels.filter((label) => typeof label === "string") : [];
  const sandboxScenario = sandboxScenarioFromIssue({ key: issue.key, summary, description, labels });
  const sparse = sandboxScenario === "ask-for-info" || (sandboxScenario == null && isSparseJiraText(summary, description));
  const typeNote =
    issueType && issueType !== settings.defectIssueType
      ? ` Jira issue type is "${issueType}", not "${settings.defectIssueType}".`
      : "";
  const projectNote =
    projectKey && projectKey !== settings.projectKey
      ? ` Project key is ${projectKey}, not the configured ${settings.projectKey}.`
      : "";
  const symptom = description || "(Jira returned no description.)";
  const demoLabel = labels.includes("nexus-demo")
    ? " The Jira label nexus-demo is present, so this text is simulated sandbox data, not a customer incident."
    : "";
  const scenarioNote =
    sandboxScenario === "lock"
      ? " Matching sandbox scenario: lock. Measure the local catalog only, then report the rule result. Do not treat the Jira wording as a measurement."
      : sandboxScenario === "outage"
        ? " Matching sandbox scenario: outage. The rules must abstain from a lock finding when the catalog returns 503."
        : sandboxScenario === "ask-for-info"
          ? " Matching sandbox scenario: none. The evidence is thin. Ask for traces, logs, or a reproduction. Do not invent cart totals or run a different scenario in their place."
          : "";
  const fallbackNote =
    sparse && sandboxScenario !== "ask-for-info"
      ? " The investigation can fall back to the seeded scenario NI-1042, and that fallback is labeled as a seeded example."
      : "";
  const disclaimer = sparse
    ? `Read from Jira ${settings.baseUrl}, project ${settings.projectKey} (${JIRA_PROJECT_NAME}).${demoLabel}${typeNote}${projectNote}${scenarioNote}${fallbackNote} No evidence was inferred from the issue text.`
    : `Read from Jira ${settings.baseUrl}. This adapter only sends HTTP GET. It does not write to Jira.${demoLabel}${typeNote}${projectNote}${scenarioNote}`;

  return {
    id: issue.key ?? "unknown",
    source: "jira",
    kind: sparse ? "Jira issue, sparse" : "Jira issue",
    title: summary,
    service: `Jira ${projectKey ?? settings.projectKey}`,
    openedAt: fields.created ?? "",
    severity: fields.priority?.name ?? fields.status?.name ?? "unspecified",
    reporter: fields.reporter?.displayName ?? "Jira",
    symptom,
    ask:
      sandboxScenario === "ask-for-info"
        ? "Ask the engineer for traces, logs, or a reproduction. Do not invent a cause."
        : sparse
          ? "Do not invent a defect from this text. Say the ticket is sparse, then use the seeded sandbox scenario only if the engineer continues, and keep that label visible."
          : "Investigate from sandbox measurements. Do not treat the Jira text as measurement evidence.",
    disclaimer,
    issueType,
    projectKey,
    detail: sparse ? "sparse" : "sufficient",
    fallback: sparse && sandboxScenario !== "ask-for-info" ? "seeded-scenario" : "none",
    sandboxScenario,
    labels,
    readOnly: true,
  };
}

export async function fetchJiraIssue(key: string, env: JiraEnv = process.env, fetchImpl: FetchLike = fetch) {
  const settings = jiraSettings(env);
  if (!settings.email || !settings.token) {
    return { ok: false as const, reason: "unconfigured" as const };
  }
  const url = `${settings.baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,issuetype,status,priority,reporter,created,labels,project`;
  const auth = Buffer.from(`${settings.email}:${settings.token}`).toString("base64");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Basic ${auth}`,
        accept: "application/json",
      },
    });
  } catch (error) {
    return {
      ok: false as const,
      reason: "error" as const,
      message: error instanceof Error ? error.message : "Jira request failed.",
    };
  }
  if (response.status === 404) return { ok: false as const, reason: "not-found" as const };
  if (!response.ok) {
    return { ok: false as const, reason: "error" as const, message: `Jira returned HTTP ${response.status}.` };
  }
  const body = (await response.json()) as Parameters<typeof mapJiraIssue>[0];
  return { ok: true as const, ticket: mapJiraIssue(body, env) };
}
