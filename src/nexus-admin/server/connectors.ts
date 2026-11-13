// Company connectors: store (secrets encrypted, write-only), test (read-only,
// with history), apply changes only after a passing test, rotate secrets.
// Server-only. Every definition comes from the connector registry.
import { assertReadOnlyRequest } from "../../../connectors/http";
import type { Connector } from "../../../connectors/types";
import { fetchWithCa } from "../connectors/ca-fetch";
import { validateValues } from "../connectors/form";
import { registry } from "../connectors/registry";
import type { ConnectorContext, ConnectorDefinition, Deployment, Values } from "../connectors/types";
import { audit, type Actor } from "./audit";
import { refreshStatus } from "./companies";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb, nowIso } from "./db";
import { redactValue } from "./redact";
import { checkHostTarget, checkUrlTarget, type TargetCheck } from "./ssrf";

type Row = {
  id: number;
  company_id: number;
  registry_id: string;
  category: string;
  label: string;
  deployment: Deployment;
  config_json: string;
  scope_json: string;
  secrets_enc: string | null;
  secrets_saved_at: string | null;
  key_version: string | null;
  pending_deployment: Deployment | null;
  pending_config_json: string | null;
  pending_scope_json: string | null;
  pending_secrets_enc: string | null;
  pending_since: string | null;
  status: "never_tested" | "healthy" | "failing";
  activated_at: string | null;
  last_tested_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_result_json: string | null;
  needs_secret: number;
  created_at: string;
  updated_at: string;
};

export type CheckResult = {
  ok: boolean;
  /** False for planned connectors that cannot be tested yet. */
  supported: boolean;
  target: "live" | "pending";
  reached: string[];
  problems: string[];
  warnings: string[];
  readOnlyProof: string[];
  testedAt: string;
  durationMs: number;
};

/** What a browser may see. No secret value, no part of one. */
export type PublicConnector = {
  id: number;
  companyId: number;
  registryId: string;
  displayName: string;
  category: string;
  label: string;
  planned: boolean;
  deployment: Deployment;
  config: Values;
  scope: Values;
  secrets: { field: string; label: string; saved: boolean; savedAt: string | null }[];
  pending: null | { since: string; deployment: Deployment; config: Values; scope: Values; secretFieldsChanged: string[] };
  status: Row["status"];
  active: boolean;
  activatedAt: string | null;
  lastTestedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastResult: CheckResult | null;
  needsSecret: boolean;
};

export type CheckRow = { id: number; at: string; trigger: string; target: string; ok: boolean; statusBefore: string | null; statusAfter: string | null; durationMs: number | null; result: CheckResult };

const aad = (companyId: number, connectorId: number) => `company:${companyId}:connector:${connectorId}`;
const parse = <T>(text: string | null, fallback: T): T => (text ? (JSON.parse(text) as T) : fallback);

function definition(registryId: string): ConnectorDefinition {
  const def = registry().get(registryId);
  if (!def) throw new Error(`Unknown connector type "${registryId}".`);
  return def;
}

function rowOf(companyId: number, connectorId: number) {
  return getDb().prepare("SELECT * FROM company_connectors WHERE id = ? AND company_id = ?").get(connectorId, companyId) as Row | undefined;
}

function mustRow(companyId: number, connectorId: number) {
  const row = rowOf(companyId, connectorId);
  if (!row) throw new Error("Connector not found for this company.");
  return row;
}

function decryptSecrets(row: Row, which: "live" | "pending"): Record<string, string> {
  const blob = which === "pending" ? row.pending_secrets_enc : row.secrets_enc;
  if (!blob) return {};
  return JSON.parse(decryptSecret(blob, aad(row.company_id, row.id))) as Record<string, string>;
}

function encryptSecrets(companyId: number, connectorId: number, secrets: Record<string, string>) {
  if (!Object.keys(secrets).length) return { blob: null as string | null, keyVersion: null as string | null };
  const enc = encryptSecret(JSON.stringify(secrets), aad(companyId, connectorId));
  return { blob: enc.blob, keyVersion: enc.keyVersion };
}

function secretFieldsOf(def: ConnectorDefinition) {
  return def.fields.filter((f) => f.type === "secret");
}

function toPublic(row: Row): PublicConnector {
  const def = registry().get(row.registry_id);
  const liveSecretNames = row.secrets_enc ? Object.keys(decryptSecrets(row, "live")) : [];
  const pendingSecrets = row.pending_secrets_enc ? decryptSecrets(row, "pending") : null;
  const live = row.secrets_enc ? decryptSecrets(row, "live") : {};
  return {
    id: row.id,
    companyId: row.company_id,
    registryId: row.registry_id,
    displayName: def?.displayName ?? row.registry_id,
    category: row.category,
    label: row.label,
    planned: def?.status !== "available",
    deployment: row.deployment,
    config: parse<Values>(row.config_json, {}),
    scope: parse<Values>(row.scope_json, {}),
    secrets: (def ? secretFieldsOf(def) : []).map((f) => ({
      field: f.name,
      label: f.label,
      saved: liveSecretNames.includes(f.name),
      savedAt: liveSecretNames.includes(f.name) ? row.secrets_saved_at : null,
    })),
    pending: row.pending_since
      ? {
          since: row.pending_since,
          deployment: row.pending_deployment ?? row.deployment,
          config: parse<Values>(row.pending_config_json, {}),
          scope: parse<Values>(row.pending_scope_json, {}),
          secretFieldsChanged: pendingSecrets ? Object.keys(pendingSecrets).filter((k) => pendingSecrets[k] !== live[k]) : [],
        }
      : null,
    status: row.status,
    active: Boolean(row.activated_at),
    activatedAt: row.activated_at,
    lastTestedAt: row.last_tested_at,
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
    lastResult: parse<CheckResult | null>(row.last_result_json, null),
    needsSecret: row.needs_secret === 1,
  };
}

export function listCompanyConnectors(companyId: number): PublicConnector[] {
  return (getDb().prepare("SELECT * FROM company_connectors WHERE company_id = ? ORDER BY category, id").all(companyId) as Row[]).map(toPublic);
}

export function getCompanyConnector(companyId: number, connectorId: number) {
  const row = rowOf(companyId, connectorId);
  return row ? toPublic(row) : null;
}

type SaveInput = { deployment?: unknown; config?: unknown; scope?: unknown };

/** Add a connector to a company. It starts untested and inactive. */
export function addConnector(input: { companyId: number; registryId: string; label?: string; values: SaveInput; actor: Actor; ip: string }) {
  const def = definition(input.registryId);
  const v = validateValues(def, input.values);
  if (Object.keys(v.errors).length) return { ok: false as const, errors: v.errors };
  const db = getDb();
  const now = nowIso();
  const info = db
    .prepare(
      `INSERT INTO company_connectors (company_id, registry_id, category, label, deployment, config_json, scope_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'never_tested', ?, ?)`,
    )
    .run(input.companyId, def.id, def.category, (input.label ?? "").trim().slice(0, 80), v.deployment, JSON.stringify(v.config), JSON.stringify(v.scope), now, now);
  const id = Number(info.lastInsertRowid);
  const enc = encryptSecrets(input.companyId, id, v.secrets);
  db.prepare("UPDATE company_connectors SET secrets_enc = ?, key_version = ?, secrets_saved_at = ? WHERE id = ?").run(enc.blob, enc.keyVersion, enc.blob ? now : null, id);
  audit({
    actor: input.actor,
    action: "connector.added",
    result: "ok",
    companyId: input.companyId,
    target: `${def.id}#${id}`,
    ip: input.ip,
    detail: { category: def.category, deployment: v.deployment, scope: v.scope, secretFieldsSet: Object.keys(v.secrets) },
    scrub: Object.values(v.secrets),
  });
  refreshStatus(input.companyId);
  return { ok: true as const, connector: toPublic(mustRow(input.companyId, id)) };
}

/**
 * Change a connector. Before it has ever passed a test, the change replaces the
 * saved values. Once active, the change is held as pending and the old values
 * stay in use until the new ones pass a test.
 */
export function updateConnector(input: { companyId: number; connectorId: number; label?: string; values: SaveInput; actor: Actor; ip: string }) {
  const row = mustRow(input.companyId, input.connectorId);
  const def = definition(row.registry_id);
  const base = row.pending_since ? decryptSecrets(row, "pending") : decryptSecrets(row, "live");
  const v = validateValues(def, input.values, row.needs_secret ? [] : Object.keys(base));
  if (Object.keys(v.errors).length) return { ok: false as const, errors: v.errors };
  // Keep only secret fields that still exist for the chosen deployment.
  const allowed = new Set(secretFieldsOf(def).map((f) => f.name));
  const secrets = Object.fromEntries(Object.entries({ ...(row.needs_secret ? {} : base), ...v.secrets }).filter(([k]) => allowed.has(k)));
  const enc = encryptSecrets(row.company_id, row.id, secrets);
  const now = nowIso();
  const db = getDb();
  const label = input.label === undefined ? row.label : input.label.trim().slice(0, 80);
  const asPending = Boolean(row.activated_at);
  if (asPending) {
    db.prepare(
      `UPDATE company_connectors SET label = ?, pending_deployment = ?, pending_config_json = ?, pending_scope_json = ?, pending_secrets_enc = ?,
         pending_since = ?, key_version = COALESCE(?, key_version), updated_at = ? WHERE id = ?`,
    ).run(label, v.deployment, JSON.stringify(v.config), JSON.stringify(v.scope), enc.blob, now, enc.keyVersion, now, row.id);
  } else {
    db.prepare(
      `UPDATE company_connectors SET label = ?, deployment = ?, config_json = ?, scope_json = ?, secrets_enc = ?, key_version = ?,
         secrets_saved_at = CASE WHEN ? THEN ? ELSE secrets_saved_at END, needs_secret = 0, status = 'never_tested', last_result_json = NULL, updated_at = ? WHERE id = ?`,
    ).run(label, v.deployment, JSON.stringify(v.config), JSON.stringify(v.scope), enc.blob, enc.keyVersion, Object.keys(v.secrets).length ? 1 : 0, now, now, row.id);
  }
  audit({
    actor: input.actor,
    action: "connector.changed",
    result: "ok",
    companyId: row.company_id,
    target: `${def.id}#${row.id}`,
    ip: input.ip,
    detail: { heldUntilTestPasses: asPending, deployment: v.deployment, scope: v.scope, secretFieldsChanged: Object.keys(v.secrets) },
    scrub: Object.values(secrets),
  });
  return { ok: true as const, connector: toPublic(mustRow(row.company_id, row.id)) };
}

export function discardPending(companyId: number, connectorId: number, actor: Actor, ip: string) {
  const row = mustRow(companyId, connectorId);
  if (!row.pending_since) return toPublic(row);
  getDb()
    .prepare(
      "UPDATE company_connectors SET pending_deployment = NULL, pending_config_json = NULL, pending_scope_json = NULL, pending_secrets_enc = NULL, pending_since = NULL, updated_at = ? WHERE id = ?",
    )
    .run(nowIso(), row.id);
  audit({ actor, action: "connector.change_discarded", result: "info", companyId, target: `${row.registry_id}#${row.id}`, ip });
  return toPublic(mustRow(companyId, connectorId));
}

export function removeConnector(companyId: number, connectorId: number, actor: Actor, ip: string) {
  const row = mustRow(companyId, connectorId);
  getDb().prepare("DELETE FROM company_connectors WHERE id = ?").run(row.id);
  audit({ actor, action: "connector.removed", result: "ok", companyId, target: `${row.registry_id}#${row.id}`, ip });
  refreshStatus(companyId);
}

// ---------- testing ----------

function siblingSecretFor(companyId: number) {
  return (registryId: string, field: string) => {
    const sib = getDb()
      .prepare("SELECT * FROM company_connectors WHERE company_id = ? AND registry_id = ? AND secrets_enc IS NOT NULL ORDER BY activated_at IS NULL, id LIMIT 1")
      .get(companyId, registryId) as Row | undefined;
    return sib ? decryptSecrets(sib, "live")[field] : undefined;
  };
}

/** Build the definition context for the live or pending values of a row. Server-only. */
function contextOf(row: Row, which: "live" | "pending"): { ctx: ConnectorContext; secretValues: string[] } {
  const pending = which === "pending";
  const config = parse<Values>(pending ? row.pending_config_json : row.config_json, {});
  const scope = parse<Values>(pending ? row.pending_scope_json : row.scope_json, {});
  const secrets = decryptSecrets(row, which);
  const caCert = typeof config.caCert === "string" && config.caCert ? config.caCert : undefined;
  const siblingSecret = siblingSecretFor(row.company_id);
  const ctx: ConnectorContext = {
    deployment: (pending ? row.pending_deployment : row.deployment) ?? row.deployment,
    config,
    scope,
    secrets,
    baseUrl: typeof config.baseUrl === "string" && config.baseUrl ? config.baseUrl : undefined,
    caCert,
    fetchImpl: fetchWithCa(caCert),
    siblingSecret,
  };
  const sib = [siblingSecret("github", "token")];
  // A secret may be a URL with a password inside (a database connection string): scrub that part too.
  const embedded = Object.values(secrets).flatMap((s) => {
    try {
      const u = new URL(s.replace(/^postgresql:/, "postgres:"));
      return u.password ? [u.password, decodeURIComponent(u.password)] : [];
    } catch {
      return [];
    }
  });
  return { ctx, secretValues: [...Object.values(secrets), ...embedded, ...sib].filter((s): s is string => Boolean(s)) };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`The test did not finish within ${ms / 1000} seconds.`)), ms))]);
}

/** Run a definition's read-only test. Exported for the contract tests. */
export async function runDefinitionTest(
  def: ConnectorDefinition,
  ctx: ConnectorContext,
  target: "live" | "pending" = "live",
  options: { checkTarget?: (t: { url?: string; host?: string }, allowInternal: boolean) => Promise<TargetCheck> } = {},
): Promise<CheckResult> {
  const started = Date.now();
  const testedAt = nowIso();
  const done = (r: Omit<CheckResult, "testedAt" | "durationMs" | "target">): CheckResult => ({ ...r, target, testedAt, durationMs: Date.now() - started });
  if (def.status !== "available" || !def.test) {
    return done({ ok: false, supported: false, reached: [], problems: [`${def.displayName} is coming soon. It can be recorded for this company but not tested or activated yet.`], warnings: [], readOnlyProof: [] });
  }
  const allowInternal = Boolean(ctx.config.allowInternal);
  const checkTarget = options.checkTarget ?? ((t, allow) => (t.url ? checkUrlTarget(t.url, allow) : checkHostTarget(t.host ?? "", allow)));
  for (const t of def.targets?.(ctx) ?? []) {
    const check = await checkTarget(t, allowInternal);
    if (!check.ok) return done({ ok: false, supported: true, reached: [], problems: [check.message], warnings: [], readOnlyProof: [] });
  }
  let result: Awaited<ReturnType<NonNullable<ConnectorDefinition["test"]>>>;
  try {
    result = await withTimeout(def.test(ctx), 30_000);
  } catch (error) {
    result = { ok: false, reached: [], problems: [error instanceof Error ? error.message : "The test failed."], warnings: [] };
  }
  const proof = [...(result.readOnlyProof ?? [])];
  if (def.capabilities.transport === "http") {
    try {
      assertReadOnlyRequest({ method: "POST" });
      result.problems.push("The HTTP client accepted a POST. This should never happen.");
    } catch {
      proof.push("Write attempt blocked: the shared HTTP client refused a POST before sending it. Only GET requests are sent.");
    }
  } else if (def.capabilities.transport === "files") {
    proof.push("Files are opened for reading only. The connector has no write path.");
  } else if (def.capabilities.transport === "database" && proof.length === 0 && result.ok) {
    result.problems.push("The database connector did not prove that writes are refused.");
  }
  return done({
    ok: Boolean(result.ok) && result.problems.length === 0,
    supported: true,
    reached: result.reached,
    problems: result.problems,
    warnings: result.warnings,
    readOnlyProof: proof,
  });
}

/**
 * Test a connector. When a change is pending, the pending values are tested and,
 * on a pass, replace the live values. Otherwise the live values are tested.
 */
export async function testConnector(input: { companyId: number; connectorId: number; trigger: "manual" | "schedule" | "onboarding" | "rotation"; actor: Actor; ip: string }) {
  const row = mustRow(input.companyId, input.connectorId);
  const def = definition(row.registry_id);
  const target: "live" | "pending" = row.pending_since ? "pending" : "live";
  let secretValues: string[] = [];
  let result: CheckResult;
  if (target === "live" && row.needs_secret) {
    result = { ok: false, supported: true, target, reached: [], problems: ["Re-enter this connector's secret, then test again."], warnings: [], readOnlyProof: [], testedAt: nowIso(), durationMs: 0 };
  } else {
    const built = contextOf(row, target);
    secretValues = built.secretValues;
    result = await runDefinitionTest(def, built.ctx, target);
  }
  const clean = redactValue(result, secretValues) as CheckResult;
  const db = getDb();
  const now = clean.testedAt;
  const before = row.status;
  let after: Row["status"] = row.status;
  let applied = false;
  const secretsChanged =
    target === "pending" && JSON.stringify(decryptSecrets(row, "pending")) !== JSON.stringify(row.needs_secret ? {} : decryptSecrets(row, "live"));
  db.transaction(() => {
    if (target === "pending") {
      if (clean.ok) {
        applied = true;
        after = "healthy";
        db.prepare(
          `UPDATE company_connectors SET deployment = pending_deployment, config_json = pending_config_json, scope_json = pending_scope_json,
             secrets_enc = pending_secrets_enc, secrets_saved_at = CASE WHEN ? THEN ? ELSE secrets_saved_at END, needs_secret = 0,
             pending_deployment = NULL, pending_config_json = NULL, pending_scope_json = NULL, pending_secrets_enc = NULL, pending_since = NULL,
             status = 'healthy', last_tested_at = ?, last_ok_at = ?, last_error = NULL, last_result_json = ?, activated_at = COALESCE(activated_at, ?), updated_at = ?
           WHERE id = ?`,
        ).run(secretsChanged ? 1 : 0, now, now, now, JSON.stringify(clean), now, now, row.id);
      }
      // A failing pending change leaves the live values and status untouched.
    } else {
      after = !clean.supported ? row.status : clean.ok ? "healthy" : "failing";
      db.prepare(
        `UPDATE company_connectors SET status = ?, last_tested_at = ?, last_ok_at = CASE WHEN ? THEN ? ELSE last_ok_at END,
           last_error = ?, last_result_json = ?, activated_at = CASE WHEN ? THEN COALESCE(activated_at, ?) ELSE activated_at END, updated_at = ? WHERE id = ?`,
      ).run(after, now, clean.ok ? 1 : 0, now, clean.ok ? null : clean.problems.join(" "), JSON.stringify(clean), clean.ok ? 1 : 0, now, now, row.id);
    }
    db.prepare(
      `INSERT INTO connector_checks (connector_id, company_id, at, trigger, target, ok, status_before, status_after, duration_ms, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.company_id, now, input.trigger, target, clean.ok ? 1 : 0, before, after, clean.durationMs, JSON.stringify(clean));
  })();
  audit({
    actor: input.actor,
    action: "connector.tested",
    result: clean.ok ? "ok" : "fail",
    companyId: row.company_id,
    target: `${def.id}#${row.id}`,
    ip: input.ip,
    detail: { trigger: input.trigger, target, reached: clean.reached, problems: clean.problems, statusBefore: before, statusAfter: after, changeApplied: applied },
    scrub: secretValues,
  });
  if (applied) {
    audit({ actor: input.actor, action: "connector.change_applied", result: "ok", companyId: row.company_id, target: `${def.id}#${row.id}`, ip: input.ip });
  }
  refreshStatus(row.company_id);
  return { result: clean, applied, connector: toPublic(mustRow(row.company_id, row.id)) };
}

export async function testAllConnectors(companyId: number, actor: Actor, ip: string, trigger: "manual" | "schedule" | "onboarding" = "manual") {
  const rows = getDb().prepare("SELECT id FROM company_connectors WHERE company_id = ? ORDER BY id").all(companyId) as { id: number }[];
  const out = [];
  for (const r of rows) out.push(await testConnector({ companyId, connectorId: r.id, trigger, actor, ip }));
  return out;
}

/** Replace one secret and test it at once. The old secret stays in use unless the new one passes. */
export async function rotateSecret(input: { companyId: number; connectorId: number; field: string; value: string; actor: Actor; ip: string }) {
  const row = mustRow(input.companyId, input.connectorId);
  const def = definition(row.registry_id);
  const field = secretFieldsOf(def).find((f) => f.name === input.field);
  if (!field) throw new Error("That connector has no such secret.");
  const value = input.value.trim();
  if (!value) throw new Error(`Enter the new ${field.label}.`);
  if (value.length > 8000) throw new Error(`${field.label} is too long.`);
  const secrets = { ...(row.needs_secret ? {} : decryptSecrets(row, "live")), [field.name]: value };
  const enc = encryptSecrets(row.company_id, row.id, secrets);
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE company_connectors SET pending_deployment = deployment, pending_config_json = config_json, pending_scope_json = scope_json,
         pending_secrets_enc = ?, pending_since = ?, key_version = ?, needs_secret = 0, updated_at = ? WHERE id = ?`,
    )
    .run(enc.blob, now, enc.keyVersion, now, row.id);
  const tested = await testConnector({ companyId: row.company_id, connectorId: row.id, trigger: "rotation", actor: input.actor, ip: input.ip });
  if (!tested.applied) discardPending(row.company_id, row.id, input.actor, input.ip);
  audit({
    actor: input.actor,
    action: "connector.secret_rotated",
    result: tested.applied ? "ok" : "fail",
    companyId: row.company_id,
    target: `${def.id}#${row.id}`,
    ip: input.ip,
    detail: { field: field.name, applied: tested.applied, problems: tested.result.problems },
    scrub: [value],
  });
  return { ...tested, connector: toPublic(mustRow(row.company_id, row.id)) };
}

export function listChecks(companyId: number, connectorId: number, limit = 50): CheckRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM connector_checks WHERE company_id = ? AND connector_id = ? ORDER BY id DESC LIMIT ?")
    .all(companyId, connectorId, Math.min(limit, 500)) as {
    id: number;
    at: string;
    trigger: string;
    target: string;
    ok: number;
    status_before: string | null;
    status_after: string | null;
    duration_ms: number | null;
    result_json: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    trigger: r.trigger,
    target: r.target,
    ok: r.ok === 1,
    statusBefore: r.status_before,
    statusAfter: r.status_after,
    durationMs: r.duration_ms,
    result: JSON.parse(r.result_json) as CheckResult,
  }));
}

/** Active, healthy connectors built for the engine. Server-only; never send to a browser. */
export function engineConnectors(companyId: number): { registryId: string; category: string; connector: Connector }[] {
  const rows = getDb()
    .prepare("SELECT * FROM company_connectors WHERE company_id = ? AND activated_at IS NOT NULL AND needs_secret = 0")
    .all(companyId) as Row[];
  const out = [];
  for (const row of rows) {
    const def = registry().get(row.registry_id);
    if (!def?.build) continue;
    out.push({ registryId: row.registry_id, category: row.category, connector: def.build(contextOf(row, "live").ctx) });
  }
  return out;
}

/** For key rotation: re-encrypt every stored connector secret with the current key. */
export function reencryptConnectorSecrets() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM company_connectors WHERE secrets_enc IS NOT NULL OR pending_secrets_enc IS NOT NULL").all() as Row[];
  let n = 0;
  db.transaction(() => {
    for (const row of rows) {
      const live = row.secrets_enc ? encryptSecrets(row.company_id, row.id, decryptSecrets(row, "live")) : { blob: null, keyVersion: null };
      const pending = row.pending_secrets_enc ? encryptSecrets(row.company_id, row.id, decryptSecrets(row, "pending")) : { blob: null, keyVersion: null };
      db.prepare("UPDATE company_connectors SET secrets_enc = ?, pending_secrets_enc = ?, key_version = ? WHERE id = ?").run(
        live.blob,
        pending.blob,
        live.keyVersion ?? pending.keyVersion,
        row.id,
      );
      n += 1;
    }
  })();
  return n;
}

/**
 * Active connectors of a company with their decrypted read-only contexts, for
 * the investigation pipeline. Server-only: contexts hold secrets and must never
 * be returned to a browser, logged or stored. secretValues lists what to scrub.
 */
export function companySources(companyId: number) {
  const rows = getDb()
    .prepare("SELECT * FROM company_connectors WHERE company_id = ? AND activated_at IS NOT NULL AND needs_secret = 0 ORDER BY id")
    .all(companyId) as Row[];
  const out: {
    connectorId: number;
    registryId: string;
    category: string;
    name: string;
    status: Row["status"];
    ctx: ConnectorContext;
    secretValues: string[];
    connector: Connector | null;
  }[] = [];
  for (const row of rows) {
    const def = registry().get(row.registry_id);
    if (!def || def.status !== "available") continue;
    const { ctx, secretValues } = contextOf(row, "live");
    let connector: Connector | null = null;
    try {
      connector = def.build ? def.build(ctx) : null;
    } catch {
      connector = null;
    }
    out.push({ connectorId: row.id, registryId: row.registry_id, category: row.category, name: row.label || def.displayName, status: row.status, ctx, secretValues, connector });
  }
  return out;
}
