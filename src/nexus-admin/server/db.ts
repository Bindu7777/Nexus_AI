// Thin data layer over SQLite (better-sqlite3). Everything else talks to the
// database through the functions in this folder, so moving to Postgres later
// means re-implementing this layer, not the portal.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Db = Database.Database;

const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE nexus_admins (
        id INTEGER PRIMARY KEY,
        login_id_norm TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'nexus_admin',
        totp_secret_enc TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        password_changed_at TEXT NOT NULL,
        last_login_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE companies (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        short_code TEXT NOT NULL UNIQUE,
        contact_name TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        country TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','connected','active','paused')),
        status_before_pause TEXT,
        onboarding_step TEXT NOT NULL DEFAULT 'details',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL
      );

      CREATE TABLE company_connections (
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('code','tickets','database','docs','logs','service')),
        provider TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        secret_enc TEXT,
        secret_last4 TEXT,
        key_version TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','failed')),
        last_test_at TEXT,
        last_test_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (company_id, kind)
      );

      CREATE TABLE company_users (
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('company_admin','employee')),
        login_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        disabled_at TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (company_id, login_id)
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('nexus_admin','company_user')),
        subject_id INTEGER NOT NULL,
        company_id INTEGER,
        csrf_token TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        totp_pending INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX sessions_subject ON sessions (subject_type, subject_id);

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id INTEGER,
        actor_label TEXT NOT NULL,
        company_id INTEGER,
        action TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        result TEXT NOT NULL CHECK (result IN ('ok','fail','denied','info')),
        ip TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX audit_at ON audit_log (at);
      CREATE INDEX audit_company ON audit_log (company_id, at);
      CREATE INDEX audit_action ON audit_log (action, at);

      -- Append-only: the database itself refuses edits and deletes.
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
        BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
        BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    `,
  },
  {
    version: 2,
    name: "connector registry, pending changes, check history",
    sql: `
      -- Many connectors per company, one row each, driven by the connector registry.
      CREATE TABLE company_connectors (
        id INTEGER PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        registry_id TEXT NOT NULL,
        category TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        deployment TEXT NOT NULL CHECK (deployment IN ('cloud','self-hosted')),
        config_json TEXT NOT NULL DEFAULT '{}',
        scope_json TEXT NOT NULL DEFAULT '{}',
        secrets_enc TEXT,
        secrets_saved_at TEXT,
        key_version TEXT,
        -- A change to an active connector waits here until it passes a test.
        pending_deployment TEXT,
        pending_config_json TEXT,
        pending_scope_json TEXT,
        pending_secrets_enc TEXT,
        pending_since TEXT,
        status TEXT NOT NULL DEFAULT 'never_tested' CHECK (status IN ('never_tested','healthy','failing')),
        activated_at TEXT,
        last_tested_at TEXT,
        last_ok_at TEXT,
        last_error TEXT,
        last_result_json TEXT,
        needs_secret INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX company_connectors_company ON company_connectors (company_id, category);

      CREATE TABLE connector_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connector_id INTEGER NOT NULL REFERENCES company_connectors(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL,
        at TEXT NOT NULL,
        trigger TEXT NOT NULL,
        target TEXT NOT NULL CHECK (target IN ('live','pending')),
        ok INTEGER NOT NULL,
        status_before TEXT,
        status_after TEXT,
        duration_ms INTEGER,
        result_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX connector_checks_connector ON connector_checks (connector_id, at);

      ALTER TABLE companies ADD COLUMN region TEXT NOT NULL DEFAULT '';
      ALTER TABLE companies ADD COLUMN deployment_mode TEXT NOT NULL DEFAULT 'customer';
      ALTER TABLE companies ADD COLUMN went_live_at TEXT;

      -- Carry over connections saved by the earlier one-per-category screen.
      -- Their secrets were bound to the old row format, so each is marked
      -- needs_secret and must be re-entered and re-tested.
      INSERT INTO company_connectors (company_id, registry_id, category, label, deployment, config_json, scope_json, status, needs_secret, created_at, updated_at)
      SELECT company_id,
             CASE provider
               WHEN 'jira-cloud' THEN 'jira' WHEN 'jira-dc' THEN 'jira'
               WHEN 'supabase' THEN 'postgres'
               WHEN 'log-files' THEN 'logs-file'
               WHEN 'http-service' THEN 'service-under-test'
               WHEN 'confluence-cloud' THEN 'confluence' WHEN 'confluence-dc' THEN 'confluence'
               WHEN 'other-logs' THEN 'logs-http'
               ELSE provider END,
             CASE kind WHEN 'tickets' THEN 'defects' WHEN 'service' THEN 'services' ELSE kind END,
             '',
             CASE WHEN provider IN ('jira-dc','confluence-dc','log-files','docs-folder','http-service') THEN 'self-hosted' ELSE 'cloud' END,
             config_json, '{}', 'never_tested', CASE WHEN secret_enc IS NULL THEN 0 ELSE 1 END, created_at, updated_at
      FROM company_connections;
    `,
  },
];

export function dbPath() {
  return process.env.NEXUS_ADMIN_DB ?? path.join(process.cwd(), ".data", "nexus-admin.sqlite");
}

export function migrate(db: Db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, new Date().toISOString());
    })();
  }
}

export function openDb(file = dbPath()): Db {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  if (file !== ":memory:") {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

type G = typeof globalThis & { __nexusAdminDb?: { file: string; db: Db; migratedTo: number } };

const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));

/**
 * Process-wide connection. Tests can point NEXUS_ADMIN_DB at a temp file and call resetDbForTests().
 * The connection survives dev-server reloads, so newer migrations are applied to it when the code changes.
 */
export function getDb(): Db {
  const g = globalThis as G;
  const file = dbPath();
  if (!g.__nexusAdminDb || g.__nexusAdminDb.file !== file) {
    g.__nexusAdminDb?.db.close();
    g.__nexusAdminDb = { file, db: openDb(file), migratedTo: LATEST };
  } else if (g.__nexusAdminDb.migratedTo < LATEST) {
    migrate(g.__nexusAdminDb.db);
    g.__nexusAdminDb.migratedTo = LATEST;
  }
  return g.__nexusAdminDb.db;
}

export function resetDbForTests() {
  const g = globalThis as G;
  g.__nexusAdminDb?.db.close();
  delete g.__nexusAdminDb;
}

export const nowIso = () => new Date().toISOString();
