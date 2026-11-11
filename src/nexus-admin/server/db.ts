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

type G = typeof globalThis & { __nexusAdminDb?: { file: string; db: Db } };

/** Process-wide connection. Tests can point NEXUS_ADMIN_DB at a temp file and call resetDbForTests(). */
export function getDb(): Db {
  const g = globalThis as G;
  const file = dbPath();
  if (!g.__nexusAdminDb || g.__nexusAdminDb.file !== file) {
    g.__nexusAdminDb?.db.close();
    g.__nexusAdminDb = { file, db: openDb(file) };
  }
  return g.__nexusAdminDb.db;
}

export function resetDbForTests() {
  const g = globalThis as G;
  g.__nexusAdminDb?.db.close();
  delete g.__nexusAdminDb;
}

export const nowIso = () => new Date().toISOString();
