// Company connections: validate, store (secrets encrypted), test, and hand to
// the engine later through getCompanyConnections(). Server-only.
import { createGitHubConnector } from "../../../connectors/github";
import { assertReadOnlyRequest, createReadOnlyHttp } from "../../../connectors/http";
import { createPostgresConnector } from "../../../connectors/database/postgres";
import { createGitHubMarkdownConnector } from "../../../connectors/docs/github-markdown";
import { createMarkdownFolderConnector } from "../../../connectors/docs/markdown-folder";
import { createFileLogConnector } from "../../../connectors/logs/file";
import { createSupabaseLogsConnector } from "../../../connectors/logs/supabase";
import { createGitHubIssuesConnector } from "../../../connectors/tickets/github-issues";
import { createJiraConnector } from "../../../connectors/tickets/jira";
import type { Connector, ConnectorTestResult } from "../../../connectors/types";
import { type ConnectionKind, type FieldDef, providerById } from "../providers";
import { audit, type Actor } from "./audit";
import { decryptSecret, encryptSecret } from "./crypto";
import { refreshStatus } from "./companies";
import { getDb, nowIso } from "./db";
import { probePostgresWrite, type ProbeClient } from "./probe";
import { maskSecret, redactText, redactValue } from "./redact";
import { checkHostTarget, checkUrlTarget } from "./ssrf";

type Config = Record<string, string | number | boolean>;

type ConnectionRow = {
  id: number;
  company_id: number;
  kind: ConnectionKind;
  provider: string;
  config_json: string;
  secret_enc: string | null;
  secret_last4: string | null;
  key_version: string | null;
  status: "pending" | "ok" | "failed";
  last_test_at: string | null;
  last_test_json: string | null;
  created_at: string;
  updated_at: string;
};

export type TestOutcome = {
  ok: boolean;
  supported: boolean;
  reached: string[];
  problems: string[];
  warnings: string[];
  readOnly: string[];
  testedAt: string;
};

/** What the browser may see about a connection. Never includes the secret. */
export type PublicConnection = {
  id: number;
  kind: ConnectionKind;
  provider: string;
  providerLabel: string;
  config: Config;
  hasSecret: boolean;
  secretMask: string;
  status: ConnectionRow["status"];
  lastTestAt: string | null;
  lastTest: TestOutcome | null;
};

const aad = (companyId: number, kind: string) => `company:${companyId}:connection:${kind}`;

// ---------- validation ----------
function coerce(field: FieldDef, raw: unknown): { value?: string | number | boolean; error?: string } {
  if (field.type === "checkbox") return { value: raw === true || raw === "true" || raw === "on" };
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!text) {
    if (field.required) return { error: `${field.label} is required.` };
    return { value: field.defaultValue ?? "" };
  }
  if (text.length > 4000) return { error: `${field.label} is too long.` };
  if (field.type === "number") {
    const n = Number(text);
    if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max)) {
      return { error: `${field.label} must be a number between ${field.min ?? "-"} and ${field.max ?? "-"}.` };
    }
    return { value: n };
  }
  if (field.type === "url") {
    try {
      const u = new URL(text);
      if (u.protocol !== "https:" && u.protocol !== "http:") return { error: `${field.label} must start with https:// or http://.` };
      if (u.username || u.password) return { error: `Do not put credentials in ${field.label}. Use the token field.` };
    } catch {
      return { error: `${field.label} must be a full URL, for example https://example.com.` };
    }
  }
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) return { error: `${field.label} must be an email address.` };
  if (field.type === "select" && field.options && !field.options.some((o) => o.value === text)) return { error: `Choose a value for ${field.label}.` };
  return { value: text };
}

export function validateConnection(kind: ConnectionKind, providerId: string, raw: Record<string, unknown>) {
  const provider = providerById(providerId);
  const errors: Record<string, string> = {};
  if (!provider || provider.kind !== kind) return { provider: null, config: {} as Config, errors: { provider: "Choose a supported provider." } };
  const config: Config = {};
  for (const field of provider.fields) {
    const { value, error } = coerce(field, raw[field.name]);
    if (error) errors[field.name] = error;
    else if (value !== undefined) config[field.name] = value;
  }
  if (provider.id === "github" || provider.id === "gitlab" || provider.id === "bitbucket") {
    const repos = String(config.repos ?? "").split(/[\n,]/).map((r) => r.trim()).filter(Boolean);
    if (repos.some((r) => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.*-]+$/.test(r))) errors.repos = "Use owner/name per line, for example acme/web.";
    config.repos = repos.join("\n");
  }
  if (provider.id === "http-service") {
    const envs = String(config.environments ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (envs.some((e) => /^(prod|production|live)$/.test(e))) errors.environments = "Production is never allowed as a target for load.";
    config.environments = envs.join(", ");
  }
  if ((provider.id === "docs-folder" || provider.id === "log-files") && !String(config.path ?? "").startsWith("/")) {
    errors.path = "Use an absolute path on the Nexus server, for example /var/log/acme.";
  }
  if (provider.kind === "database" && !config.useConnectionString && !config.host) errors.host = "Enter the database host, or tick the connection-string option.";
  return { provider, config, errors };
}

// ---------- storage ----------
function rowFor(companyId: number, kind: ConnectionKind) {
  return getDb().prepare("SELECT * FROM company_connections WHERE company_id = ? AND kind = ?").get(companyId, kind) as ConnectionRow | undefined;
}

function toPublic(row: ConnectionRow): PublicConnection {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    providerLabel: providerById(row.provider)?.label ?? row.provider,
    config: JSON.parse(row.config_json) as Config,
    hasSecret: Boolean(row.secret_enc),
    secretMask: row.secret_enc ? (row.secret_last4 ? `••••${row.secret_last4}` : "••••") : "",
    status: row.status,
    lastTestAt: row.last_test_at,
    lastTest: row.last_test_json ? (JSON.parse(row.last_test_json) as TestOutcome) : null,
  };
}

export function listConnections(companyId: number): PublicConnection[] {
  return (getDb().prepare("SELECT * FROM company_connections WHERE company_id = ? ORDER BY id").all(companyId) as ConnectionRow[]).map(toPublic);
}

export function getConnection(companyId: number, kind: ConnectionKind) {
  const row = rowFor(companyId, kind);
  return row ? toPublic(row) : null;
}

export function saveConnection(input: {
  companyId: number;
  kind: ConnectionKind;
  providerId: string;
  config: Config;
  secret?: string | null;
  actor: Actor;
  ip: string;
}) {
  const db = getDb();
  const existing = rowFor(input.companyId, input.kind);
  const provider = providerById(input.providerId)!;
  const secret = typeof input.secret === "string" ? input.secret.trim() : "";
  if (secret.length > 8000) throw new Error("The secret is too long.");
  let secretEnc = existing && existing.provider === input.providerId ? existing.secret_enc : null;
  let last4 = existing && existing.provider === input.providerId ? existing.secret_last4 : null;
  let keyVersion = existing && existing.provider === input.providerId ? existing.key_version : null;
  if (secret) {
    const enc = encryptSecret(secret, aad(input.companyId, input.kind));
    secretEnc = enc.blob;
    keyVersion = enc.keyVersion;
    last4 = secret.length > 8 ? secret.slice(-4) : null;
  }
  if (provider.secret?.required && !secretEnc) throw new Error(`${provider.secret.label} is required.`);
  const now = nowIso();
  db.prepare(
    `INSERT INTO company_connections (company_id, kind, provider, config_json, secret_enc, secret_last4, key_version, status, created_at, updated_at)
     VALUES (@company_id, @kind, @provider, @config, @secret_enc, @last4, @key_version, 'pending', @now, @now)
     ON CONFLICT (company_id, kind) DO UPDATE SET provider=@provider, config_json=@config, secret_enc=@secret_enc,
       secret_last4=@last4, key_version=@key_version, status='pending', last_test_json=NULL, updated_at=@now`,
  ).run({
    company_id: input.companyId,
    kind: input.kind,
    provider: input.providerId,
    config: JSON.stringify(input.config),
    secret_enc: secretEnc,
    last4,
    key_version: keyVersion,
    now,
  });
  audit({
    actor: input.actor,
    action: existing ? "connection.updated" : "connection.added",
    result: "ok",
    companyId: input.companyId,
    target: `${input.kind}:${input.providerId}`,
    ip: input.ip,
    detail: { secretChanged: Boolean(secret), config: input.config },
    scrub: [secret],
  });
  refreshStatus(input.companyId);
  return getConnection(input.companyId, input.kind)!;
}

export function removeConnection(companyId: number, kind: ConnectionKind, actor: Actor, ip: string) {
  const existing = rowFor(companyId, kind);
  if (!existing) return;
  getDb().prepare("DELETE FROM company_connections WHERE id = ?").run(existing.id);
  audit({ actor, action: "connection.removed", result: "ok", companyId, target: `${kind}:${existing.provider}`, ip });
  refreshStatus(companyId);
}

function secretOf(row: ConnectionRow | undefined) {
  if (!row?.secret_enc) return "";
  return decryptSecret(row.secret_enc, aad(row.company_id, row.kind));
}

// ---------- building connectors (server-side, at test time only) ----------
const lines = (v: unknown) => String(v ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

function githubApiBase(serverUrl: unknown) {
  const s = String(serverUrl ?? "").replace(/\/$/, "");
  return s ? `${s}/api/v3` : undefined;
}

function pgConnectionString(config: Config, secret: string) {
  if (config.useConnectionString) return secret;
  const user = encodeURIComponent(String(config.username || "nexus_readonly"));
  const pass = encodeURIComponent(secret);
  return `postgres://${user}:${pass}@${config.host}:${config.port || 5432}/${encodeURIComponent(String(config.database || "postgres"))}`;
}

function codeHostToken(companyId: number) {
  const code = rowFor(companyId, "code");
  return code?.provider === "github" ? secretOf(code) : "";
}

type Built = { connector?: Connector; targets: { url?: string; host?: string }[]; secrets: string[]; unsupported?: string };

function build(row: ConnectionRow): Built {
  const config = JSON.parse(row.config_json) as Config;
  const secret = secretOf(row);
  switch (row.provider) {
    case "github": {
      const apiBase = githubApiBase(config.serverUrl);
      return {
        connector: createGitHubConnector({ repos: lines(config.repos), token: secret, apiBase }),
        targets: [{ url: apiBase ?? "https://api.github.com" }],
        secrets: [secret],
      };
    }
    case "github-issues": {
      const token = secret || codeHostToken(row.company_id);
      const apiBase = githubApiBase(config.serverUrl);
      const github = createGitHubConnector({ repos: [String(config.repo)], token, apiBase });
      return { connector: createGitHubIssuesConnector({ github, repo: String(config.repo) }), targets: [{ url: apiBase ?? "https://api.github.com" }], secrets: [token] };
    }
    case "jira-cloud": {
      const env = {
        JIRA_BASE_URL: String(config.siteUrl),
        JIRA_EMAIL: String(config.email),
        JIRA_API_TOKEN: secret,
        JIRA_PROJECT_KEY: lines(config.projectKeys)[0] ?? "",
      };
      return { connector: createJiraConnector({ env }), targets: [{ url: String(config.siteUrl) }], secrets: [secret] };
    }
    case "supabase":
    case "postgres": {
      const cs = pgConnectionString(config, secret);
      let host = String(config.host ?? "");
      try {
        host = new URL(cs).hostname || host;
      } catch {
        /* keep configured host */
      }
      return {
        connector: createPostgresConnector({
          flavor: row.provider,
          connectionString: cs,
          schemas: lines(config.schemas),
          ssl: (config.ssl as "require" | "verify" | "disable") || "require",
          sampling: { enabled: Boolean(config.sampling), reportable: false },
        }),
        targets: [{ host }],
        secrets: [secret, cs],
      };
    }
    case "docs-repo": {
      const token = secret || codeHostToken(row.company_id);
      const code = rowFor(row.company_id, "code");
      const apiBase = code ? githubApiBase((JSON.parse(code.config_json) as Config).serverUrl) : undefined;
      const github = createGitHubConnector({ repos: [String(config.repo)], token, apiBase });
      return {
        connector: createGitHubMarkdownConnector({ github, repo: String(config.repo), pathPrefix: String(config.pathPrefix ?? "") }),
        targets: [{ url: apiBase ?? "https://api.github.com" }],
        secrets: [token],
      };
    }
    case "docs-folder":
      return { connector: createMarkdownFolderConnector({ path: String(config.path) }), targets: [], secrets: [] };
    case "log-files":
      return { connector: createFileLogConnector({ path: String(config.path) }), targets: [], secrets: [] };
    case "supabase-logs":
      return {
        connector: createSupabaseLogsConnector({ projectRef: String(config.projectRef), accessToken: secret, sources: lines(config.sources) }),
        targets: [{ url: "https://api.supabase.com" }],
        secrets: [secret],
      };
    case "http-service":
      return { targets: [{ url: String(config.baseUrl) }], secrets: [] };
    default:
      return { targets: [], secrets: [secret], unsupported: `${providerById(row.provider)?.label ?? row.provider} cannot be tested yet. Nexus will save it as pending.` };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`The test did not finish within ${ms / 1000} seconds.`)), ms))]);
}

async function pgProbeClient(cs: string, ssl: string): Promise<ProbeClient> {
  const pg = await import("pg");
  const Client = (pg.default?.Client ?? (pg as unknown as { Client: typeof pg.Client }).Client) as typeof pg.Client;
  return new Client({
    connectionString: cs,
    ssl: ssl === "disable" ? false : { rejectUnauthorized: ssl === "verify" },
    application_name: "nexus-readonly-probe",
    connectionTimeoutMillis: 10_000,
  }) as unknown as ProbeClient;
}

/** Runs the provider's read-only test and records the outcome. */
export async function testConnection(companyId: number, kind: ConnectionKind, actor: Actor, ip: string): Promise<TestOutcome> {
  const row = rowFor(companyId, kind);
  const testedAt = nowIso();
  if (!row) return { ok: false, supported: true, reached: [], problems: ["Save this connection before testing it."], warnings: [], readOnly: [], testedAt };
  const config = JSON.parse(row.config_json) as Config;
  let built: Built;
  let outcome: TestOutcome;
  try {
    built = build(row);
  } catch (error) {
    built = { targets: [], secrets: [] };
    outcome = { ok: false, supported: true, reached: [], problems: [error instanceof Error ? error.message : "The connection could not be prepared."], warnings: [], readOnly: [], testedAt };
    return record(row, outcome, [], actor, ip);
  }

  if (built.unsupported) {
    outcome = { ok: false, supported: false, reached: [], problems: [built.unsupported], warnings: [], readOnly: [], testedAt };
    return record(row, outcome, built.secrets, actor, ip);
  }

  // Refuse internal and metadata targets unless explicitly allowed.
  for (const target of built.targets) {
    const check = target.url ? await checkUrlTarget(target.url, Boolean(config.allowInternal)) : await checkHostTarget(target.host ?? "", Boolean(config.allowInternal));
    if (!check.ok) {
      outcome = { ok: false, supported: true, reached: [], problems: [check.message], warnings: [], readOnly: [], testedAt };
      return record(row, outcome, built.secrets, actor, ip);
    }
  }

  const readOnly: string[] = [];
  let result: ConnectorTestResult;
  try {
    if (row.provider === "http-service") {
      const http = createReadOnlyHttp({ timeoutMs: 8000 });
      const response = await http.get(String(config.baseUrl));
      result = {
        ok: response.status < 500,
        reached: [`${config.baseUrl} answered HTTP ${response.status} to one GET. No load was sent.`],
        problems: response.status >= 500 ? [`The service answered HTTP ${response.status}.`] : [],
        warnings: [],
      };
      readOnly.push(`Load limits recorded: at most ${config.maxRps} requests per second and ${config.maxTotal} per run, environments: ${config.environments}.`);
    } else {
      result = await withTimeout(built.connector!.test(), 25_000);
    }
  } catch (error) {
    result = { ok: false, reached: [], problems: [error instanceof Error ? error.message : "The test failed."], warnings: [] };
  }

  // Read-only proof.
  if (row.provider === "supabase" || row.provider === "postgres") {
    const cs = built.secrets[1];
    const probe = await probePostgresWrite(() => pgProbeClient(cs, String(config.ssl || "require")), lines(config.schemas));
    if (probe.error) {
      result.problems.push(`The write-safety check could not run: ${probe.error}`);
    } else if (probe.writeBlocked) {
      readOnly.push("Write attempt blocked: CREATE TEMP TABLE inside a read-only transaction was refused by the database (rolled back).");
    } else {
      result.problems.push("The write-safety check did not see the database refuse a write. Do not use this account.");
    }
    result.warnings.push(...probe.warnings);
  } else if (row.provider === "docs-folder" || row.provider === "log-files") {
    readOnly.push("Files are opened for reading only. The connector has no write path.");
  } else {
    try {
      assertReadOnlyRequest({ method: "POST" });
      result.problems.push("The HTTP client accepted a POST. This should never happen.");
    } catch {
      readOnly.push("Write attempt blocked: the connector's HTTP client refused a POST before sending it. Only GET requests are sent.");
    }
  }

  outcome = {
    ok: result.ok && result.problems.length === 0,
    supported: true,
    reached: result.reached,
    problems: result.problems,
    warnings: result.warnings,
    readOnly,
    testedAt,
  };
  return record(row, outcome, built.secrets, actor, ip);
}

function record(row: ConnectionRow, outcome: TestOutcome, secrets: string[], actor: Actor, ip: string): TestOutcome {
  const clean = redactValue(outcome, secrets) as TestOutcome;
  const status = clean.ok ? "ok" : clean.supported ? "failed" : "pending";
  getDb()
    .prepare("UPDATE company_connections SET status = ?, last_test_at = ?, last_test_json = ?, updated_at = ? WHERE id = ?")
    .run(status, clean.testedAt, JSON.stringify(clean), nowIso(), row.id);
  audit({
    actor,
    action: "connection.tested",
    result: clean.ok ? "ok" : "fail",
    companyId: row.company_id,
    target: `${row.kind}:${row.provider}`,
    ip,
    detail: { reached: clean.reached, problems: clean.problems, warnings: clean.warnings },
    scrub: secrets,
  });
  refreshStatus(row.company_id);
  return clean;
}

/**
 * For the engine and connectors later: the company's connection settings with
 * secrets decrypted. Server-side only. Never return this to a browser.
 */
export function getCompanyConnections(companyId: number) {
  const rows = getDb().prepare("SELECT * FROM company_connections WHERE company_id = ?").all(companyId) as ConnectionRow[];
  return rows.map((row) => ({
    kind: row.kind,
    provider: row.provider,
    status: row.status,
    config: JSON.parse(row.config_json) as Config,
    secret: secretOf(row) || null,
  }));
}

export { maskSecret, redactText };
