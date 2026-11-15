// Connector registry. Builds the configured connectors from a plain settings
// object; Step 2 (onboarding) will produce that object from a validated config
// file plus environment variables. Secrets are passed in, never read from here.
import { createDemoCatalogConnector } from "./demo-catalog";
import { createMySqlConnector } from "./database/mysql";
import { createPostgresConnector, type PostgresConfig } from "./database/postgres";
import { createConfluenceConnector } from "./docs/confluence";
import { createGitHubMarkdownConnector } from "./docs/github-markdown";
import { createMarkdownFolderConnector } from "./docs/markdown-folder";
import { createGitHubConnector, type GitHubConnector } from "./github";
import type { FetchLike } from "./http";
import { createFileLogConnector } from "./logs/file";
import { createCloudWatchLogsConnector, createDatadogLogsConnector, createLokiLogsConnector, createSentryConnector } from "./logs/stubs";
import { createSupabaseLogsConnector } from "./logs/supabase";
import { createGitHubIssuesConnector } from "./tickets/github-issues";
import { createJiraConnector } from "./tickets/jira";
import type { TicketConnector } from "./tickets/types";
import type { Connector } from "./types";

export * from "./types";
export { evidenceItemToRecord } from "./evidence";

export type ConnectorSettings = {
  github?: { repos: string[]; token?: string; apiBase?: string };
  database?:
    | ({ type: "supabase" | "postgres" } & Omit<PostgresConfig, "flavor" | "clientFactory">)
    | { type: "mysql" };
  logs?:
    | { type: "file"; path: string }
    | { type: "supabase"; projectRef: string; accessToken?: string; sources?: string[] }
    | { type: "datadog" | "cloudwatch" | "loki" | "sentry" };
  docs?: { type: "folder"; path: string } | { type: "github"; repo: string; pathPrefix?: string } | { type: "confluence" };
  tickets?: { type: "github-issues"; repo: string } | { type: "jira"; env?: Record<string, string | undefined> };
  demoCatalog?: { baseUrl: string; projectRoot?: string };
};

export type ConnectorSet = {
  all: Connector[];
  github: GitHubConnector | null;
  tickets: TicketConnector | null;
  byId(id: string): Connector | undefined;
};

export function buildConnectors(settings: ConnectorSettings, options: { fetchImpl?: FetchLike } = {}): ConnectorSet {
  const all: Connector[] = [];
  const github = settings.github ? createGitHubConnector({ ...settings.github, fetchImpl: options.fetchImpl }) : null;
  if (github) all.push(github);

  const db = settings.database;
  if (db) {
    if (db.type === "mysql") all.push(createMySqlConnector());
    else all.push(createPostgresConnector({ ...db, flavor: db.type }));
  }

  const logs = settings.logs;
  if (logs) {
    if (logs.type === "file") all.push(createFileLogConnector({ path: logs.path }));
    else if (logs.type === "supabase") all.push(createSupabaseLogsConnector({ ...logs, fetchImpl: options.fetchImpl }));
    else if (logs.type === "datadog") all.push(createDatadogLogsConnector());
    else if (logs.type === "cloudwatch") all.push(createCloudWatchLogsConnector());
    else if (logs.type === "loki") all.push(createLokiLogsConnector());
    else all.push(createSentryConnector());
  }

  const docs = settings.docs;
  if (docs) {
    if (docs.type === "folder") all.push(createMarkdownFolderConnector({ path: docs.path }));
    else if (docs.type === "confluence") all.push(createConfluenceConnector());
    else if (github) all.push(createGitHubMarkdownConnector({ github, repo: docs.repo, pathPrefix: docs.pathPrefix }));
    else throw new Error("Docs in a GitHub repository need the GitHub connector to be configured.");
  }

  let tickets: TicketConnector | null = null;
  if (settings.tickets) {
    if (settings.tickets.type === "jira") tickets = createJiraConnector({ env: settings.tickets.env, fetchImpl: options.fetchImpl });
    else if (github) tickets = createGitHubIssuesConnector({ github, repo: settings.tickets.repo });
    else throw new Error("GitHub Issues needs the GitHub connector to be configured.");
    all.push(tickets);
  }

  if (settings.demoCatalog) all.push(createDemoCatalogConnector({ ...settings.demoCatalog, fetchImpl: options.fetchImpl }));

  for (const connector of all) {
    if (connector.readOnly !== true) throw new Error(`${connector.id} does not declare readOnly.`);
  }
  return { all, github, tickets, byId: (id) => all.find((c) => c.id === id) };
}
