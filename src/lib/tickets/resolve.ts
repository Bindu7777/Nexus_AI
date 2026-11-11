import { seededTicket } from "../ticket";
import type { EngineTicket } from "../types";
import { fetchJiraIssue, jiraConfigured, jiraSettings, type JiraEnv } from "./jira";

const SEEDED_ID = seededTicket.id;

function seededEngineTicket(): EngineTicket {
  return {
    id: seededTicket.id,
    source: "seeded",
    kind: seededTicket.kind,
    title: seededTicket.title,
    service: seededTicket.service,
    openedAt: seededTicket.openedAt,
    severity: seededTicket.severity,
    reporter: seededTicket.reporter,
    symptom: seededTicket.symptom,
    ask: seededTicket.ask,
    disclaimer: seededTicket.disclaimer,
    issueType: null,
    projectKey: null,
    detail: "sufficient",
    fallback: "none",
    sandboxScenario: null,
    labels: [],
    readOnly: true,
  };
}

function unavailable(id: string, source: EngineTicket["source"], disclaimer: string): EngineTicket {
  return {
    id,
    source,
    kind: "Jira issue",
    title: id,
    service: `Jira ${jiraSettings().projectKey}`,
    openedAt: "",
    severity: "unspecified",
    reporter: "Jira",
    symptom: "",
    ask: "Do not invent an issue body.",
    disclaimer,
    issueType: null,
    projectKey: jiraSettings().projectKey,
    detail: "unavailable",
    fallback: "none",
    sandboxScenario: null,
    labels: [],
    readOnly: true,
  };
}

export function isJiraIssueKey(value: string) {
  return /^[A-Z][A-Z0-9]+-\d+$/.test(value) && value !== SEEDED_ID;
}

export async function resolveTicket(id?: string, env: JiraEnv = process.env): Promise<EngineTicket> {
  const requested = id?.trim() || SEEDED_ID;
  if (!isJiraIssueKey(requested)) return seededEngineTicket();

  const settings = jiraSettings(env);
  if (!jiraConfigured(env)) {
    return unavailable(
      requested,
      "jira-unconfigured",
      `Jira project ${settings.projectKey} (${settings.baseUrl}) is not connected. Set JIRA_EMAIL and JIRA_API_TOKEN to read an issue. This response does not contain an issue body, and it is not the seeded scenario.`,
    );
  }

  const result = await fetchJiraIssue(requested, env);
  if (result.ok) return result.ticket;
  if (result.reason === "not-found") {
    return unavailable(
      requested,
      "jira-not-found",
      `Jira had no issue ${requested} in a read-only GET. Nothing was invented in its place.`,
    );
  }
  return unavailable(
    requested,
    "jira-error",
    `The read-only Jira GET failed${"message" in result && result.message ? `: ${result.message}` : ""}. No issue body was invented.`,
  );
}
