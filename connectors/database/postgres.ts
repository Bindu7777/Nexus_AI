// Supabase / Postgres connector. Read-only by construction:
//
// - Every operation runs inside BEGIN TRANSACTION READ ONLY ... ROLLBACK, so
//   the server itself rejects any write even if a statement slipped through.
// - There is no public raw-query method. Only the fixed catalog queries in this
//   file run, and each passes assertReadOnlySql() first.
// - Row data is never read unless config.sampling.enabled is true. Sampled
//   items are marked containsSampledData and are reportable only when
//   config.sampling.reportable is also true.
// - Connect with a dedicated read-only role (see onboarding for the SQL).
import { clip, type Connector, type EvidenceItem, emptyTestResult, nowIso, ReadOnlyViolationError, type SearchQuery } from "../types";
import { redact } from "../http";

export type QueryResult = { rows: Record<string, unknown>[] };
export type DbClient = {
  connect(): Promise<unknown>;
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  end(): Promise<unknown>;
};
export type DbClientFactory = () => Promise<DbClient> | DbClient;

export type PostgresConfig = {
  id?: string;
  /** "supabase" or "postgres"; only changes labels and the migrations it looks for. */
  flavor?: "supabase" | "postgres";
  connectionString?: string;
  schemas?: string[];
  ssl?: "require" | "verify" | "disable";
  sampling?: { enabled: boolean; reportable?: boolean; maxRows?: number };
  statementTimeoutMs?: number;
  /** Injected in tests. Defaults to node-postgres, loaded on first use. */
  clientFactory?: DbClientFactory;
};

const READ_ONLY_START = /^\s*(select|with|show)\b/i;
const FORBIDDEN = /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|comment|copy|vacuum|analyze|refresh|lock|call|do|execute|prepare|set\s+(?!local\s+statement_timeout)|reset|discard|listen|notify|security\s+label|reindex|cluster)\b/i;

/** Only SELECT / WITH / SHOW, one statement, no DML/DDL keywords outside quoted literals. */
export function assertReadOnlySql(sql: string) {
  const withoutLiterals = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
  const trimmed = withoutLiterals.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) throw new ReadOnlyViolationError("Refused SQL with more than one statement.");
  if (!READ_ONLY_START.test(trimmed)) throw new ReadOnlyViolationError("Refused SQL that is not SELECT, WITH or SHOW.");
  if (FORBIDDEN.test(trimmed)) throw new ReadOnlyViolationError("Refused SQL containing a write or DDL keyword.");
}

/** Quote an identifier that was read from the catalog. */
function ident(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

export type SchemaSnapshot = {
  readAt: string;
  database: string | null;
  user: string | null;
  serverVersion: string | null;
  schemas: string[];
  tables: {
    schema: string;
    name: string;
    kind: "table" | "partitioned table" | "view" | "materialized view";
    rlsEnabled: boolean;
    rlsForced: boolean;
    comment: string | null;
    estimatedRows: number | null;
    columns: { name: string; type: string; nullable: boolean; default: string | null; position: number }[];
  }[];
  constraints: { schema: string; table: string; name: string; type: string; definition: string }[];
  foreignKeys: { schema: string; table: string; name: string; columns: string; references: string }[];
  indexes: { schema: string; table: string; name: string; definition: string }[];
  policies: {
    schema: string;
    table: string;
    name: string;
    permissive: string;
    roles: string[];
    command: string;
    using: string | null;
    withCheck: string | null;
  }[];
  migrations: { source: string; version: string; name: string | null; appliedAt: string | null }[];
  notes: string[];
};

const KIND: Record<string, SchemaSnapshot["tables"][number]["kind"]> = {
  r: "table",
  p: "partitioned table",
  v: "view",
  m: "materialized view",
};

async function defaultFactory(config: PostgresConfig): Promise<DbClient> {
  const pg = await import("pg");
  const Client = (pg.default?.Client ?? (pg as unknown as { Client: typeof pg.Client }).Client) as typeof pg.Client;
  const ssl = config.ssl === "disable" ? false : { rejectUnauthorized: config.ssl === "verify" };
  return new Client({
    connectionString: config.connectionString,
    ssl,
    application_name: "nexus-readonly",
    connectionTimeoutMillis: 10_000,
  }) as unknown as DbClient;
}

export type PostgresConnector = Connector & {
  readSchema(options?: { refresh?: boolean }): Promise<SchemaSnapshot>;
  /** Only when sampling is enabled in config. */
  sampleRows(table: string, limit?: number): Promise<EvidenceItem>;
};

export function createPostgresConnector(config: PostgresConfig): PostgresConnector {
  const id = config.id ?? (config.flavor === "supabase" ? "supabase" : "postgres");
  const label = config.flavor === "supabase" ? "Supabase Postgres" : "Postgres";
  const schemas = config.schemas?.length ? config.schemas : ["public"];
  const timeout = Math.max(1000, Math.min(config.statementTimeoutMs ?? 10_000, 60_000));
  const factory: DbClientFactory = config.clientFactory ?? (() => defaultFactory(config));
  const clean = (m: string) => redact(m, [config.connectionString, passwordOf(config.connectionString)]);

  /** Run fixed read-only queries inside one READ ONLY transaction that is always rolled back. */
  async function readOnly<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>): Promise<T> {
    if (!config.clientFactory && !config.connectionString) {
      throw new Error(`${label} connection string is not set.`);
    }
    const client = await factory();
    try {
      await client.connect();
    } catch (error) {
      throw new Error(clean(`Could not connect to ${label}: ${error instanceof Error ? error.message : String(error)}`));
    }
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
      const q = async (sql: string, params?: unknown[]) => {
        assertReadOnlySql(sql);
        return client.query(sql, params);
      };
      return await fn(q);
    } catch (error) {
      if (error instanceof ReadOnlyViolationError) throw error;
      throw new Error(clean(error instanceof Error ? error.message : String(error)));
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }

  let cache: { at: number; snapshot: SchemaSnapshot } | null = null;

  async function readSchema(options: { refresh?: boolean } = {}): Promise<SchemaSnapshot> {
    if (!options.refresh && cache && Date.now() - cache.at < 60_000) return cache.snapshot;
    const snapshot = await readOnly(async (q) => {
      const notes: string[] = [];
      const who = (await q("select current_database() as db, current_user as usr, current_setting('server_version') as version")).rows[0] ?? {};
      const tables = (
        await q(
          `select n.nspname as schema, c.relname as name, c.relkind as kind, c.relrowsecurity as rls,
                  c.relforcerowsecurity as rls_forced, obj_description(c.oid, 'pg_class') as description,
                  c.reltuples::bigint as estimated_rows
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r','p','v','m') and n.nspname = any($1)
            order by 1, 2`,
          [schemas],
        )
      ).rows;
      const columns = (
        await q(
          `select table_schema as schema, table_name as table, column_name as name,
                  case when data_type = 'USER-DEFINED' then udt_name else data_type end as type,
                  is_nullable = 'YES' as nullable, column_default as "default", ordinal_position as position
             from information_schema.columns
            where table_schema = any($1)
            order by 1, 2, ordinal_position`,
          [schemas],
        )
      ).rows;
      const constraints = (
        await q(
          `select n.nspname as schema, cl.relname as table, co.conname as name, co.contype as type,
                  pg_get_constraintdef(co.oid) as definition
             from pg_constraint co
             join pg_class cl on cl.oid = co.conrelid
             join pg_namespace n on n.oid = cl.relnamespace
            where n.nspname = any($1)
            order by 1, 2, 3`,
          [schemas],
        )
      ).rows;
      const indexes = (
        await q(
          `select schemaname as schema, tablename as table, indexname as name, indexdef as definition
             from pg_indexes where schemaname = any($1) order by 1, 2, 3`,
          [schemas],
        )
      ).rows;
      const policies = (
        await q(
          `select schemaname as schema, tablename as table, policyname as name, permissive, roles, cmd as command,
                  qual as using, with_check
             from pg_policies where schemaname = any($1) order by 1, 2, 3`,
          [schemas],
        )
      ).rows;

      const migrations: SchemaSnapshot["migrations"] = [];
      const present = (
        await q(
          `select to_regclass('supabase_migrations.schema_migrations') is not null as supabase,
                  to_regclass('public._prisma_migrations') is not null as prisma`,
        )
      ).rows[0] ?? {};
      if (present.supabase) {
        const cols = (
          await q(
            `select column_name from information_schema.columns
              where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`,
          )
        ).rows.map((r) => String(r.column_name));
        const rows = (
          await q(
            `select version${cols.includes("name") ? ", name" : ", null as name"}
               from supabase_migrations.schema_migrations order by version`,
          )
        ).rows;
        for (const r of rows) migrations.push({ source: "supabase_migrations.schema_migrations", version: String(r.version), name: (r.name as string) ?? null, appliedAt: null });
      }
      if (present.prisma) {
        const rows = (
          await q(`select migration_name, finished_at from public._prisma_migrations order by started_at`)
        ).rows;
        for (const r of rows) migrations.push({ source: "public._prisma_migrations", version: String(r.migration_name), name: String(r.migration_name), appliedAt: r.finished_at ? String(r.finished_at) : null });
      }
      if (!present.supabase && !present.prisma) notes.push("No supabase_migrations.schema_migrations or _prisma_migrations table was visible to this role.");
      if (tables.length === 0) notes.push(`No tables were visible in schemas ${schemas.join(", ")}. Check the role's USAGE and SELECT grants.`);

      const snap: SchemaSnapshot = {
        readAt: nowIso(),
        database: (who.db as string) ?? null,
        user: (who.usr as string) ?? null,
        serverVersion: (who.version as string) ?? null,
        schemas,
        tables: tables.map((t) => ({
          schema: String(t.schema),
          name: String(t.name),
          kind: KIND[String(t.kind)] ?? "table",
          rlsEnabled: Boolean(t.rls),
          rlsForced: Boolean(t.rls_forced),
          comment: (t.description as string) ?? null,
          estimatedRows: t.estimated_rows == null ? null : Number(t.estimated_rows),
          columns: columns
            .filter((c) => c.schema === t.schema && c.table === t.name)
            .map((c) => ({
              name: String(c.name),
              type: String(c.type),
              nullable: Boolean(c.nullable),
              default: (c.default as string) ?? null,
              position: Number(c.position),
            })),
        })),
        constraints: constraints.map((c) => ({
          schema: String(c.schema),
          table: String(c.table),
          name: String(c.name),
          type: { p: "primary key", f: "foreign key", u: "unique", c: "check", x: "exclusion", t: "trigger" }[String(c.type)] ?? String(c.type),
          definition: String(c.definition),
        })),
        foreignKeys: [],
        indexes: indexes.map((i) => ({ schema: String(i.schema), table: String(i.table), name: String(i.name), definition: String(i.definition) })),
        policies: policies.map((p) => ({
          schema: String(p.schema),
          table: String(p.table),
          name: String(p.name),
          permissive: String(p.permissive),
          roles: Array.isArray(p.roles) ? p.roles.map(String) : String(p.roles ?? "").replace(/[{}]/g, "").split(",").filter(Boolean),
          command: String(p.command),
          using: (p.using as string) ?? null,
          withCheck: (p.with_check as string) ?? null,
        })),
        migrations,
        notes,
      };
      snap.foreignKeys = snap.constraints
        .filter((c) => c.type === "foreign key")
        .map((c) => {
          const m = c.definition.match(/^FOREIGN KEY \(([^)]+)\) REFERENCES ([^\s(]+)\s*\(([^)]+)\)/i);
          return {
            schema: c.schema,
            table: c.table,
            name: c.name,
            columns: m ? m[1] : "",
            references: m ? `${m[2]}(${m[3]})` : c.definition,
          };
        });
      return snap;
    });
    cache = { at: Date.now(), snapshot };
    return snapshot;
  }

  function tableItem(snap: SchemaSnapshot, t: SchemaSnapshot["tables"][number]): EvidenceItem {
    const key = `${t.schema}.${t.name}`;
    const lines = [
      `${t.kind} ${key}${t.comment ? ` -- ${t.comment}` : ""}`,
      `row level security: ${t.rlsEnabled ? "enabled" : "disabled"}${t.rlsForced ? " (forced)" : ""}`,
      "columns:",
      ...t.columns.map((c) => `  ${c.name} ${c.type}${c.nullable ? "" : " not null"}${c.default ? ` default ${c.default}` : ""}`),
    ];
    const cons = snap.constraints.filter((c) => c.schema === t.schema && c.table === t.name);
    if (cons.length) lines.push("constraints:", ...cons.map((c) => `  ${c.name}: ${c.definition}`));
    const idx = snap.indexes.filter((i) => i.schema === t.schema && i.table === t.name);
    if (idx.length) lines.push("indexes:", ...idx.map((i) => `  ${i.definition}`));
    const pol = snap.policies.filter((p) => p.schema === t.schema && p.table === t.name);
    if (pol.length) {
      lines.push(
        "policies:",
        ...pol.map((p) => `  ${p.name} ${p.permissive} for ${p.command} to ${p.roles.join(",")}${p.using ? ` using (${p.using})` : ""}${p.withCheck ? ` with check (${p.withCheck})` : ""}`),
      );
    }
    return {
      source: id,
      kind: "database",
      ref: `db:table:${key}`,
      timestamp: null,
      retrievedAt: snap.readAt,
      title: `${label} ${t.kind} ${key}`,
      excerpt: clip(lines.join("\n"), 12_000),
      observation: "observed",
      meta: { database: snap.database, rlsEnabled: t.rlsEnabled, columns: t.columns.map((c) => c.name) },
    };
  }

  function policyItem(snap: SchemaSnapshot, p: SchemaSnapshot["policies"][number]): EvidenceItem {
    return {
      source: id,
      kind: "database",
      ref: `db:policy:${p.schema}.${p.table}:${p.name}`,
      timestamp: null,
      retrievedAt: snap.readAt,
      title: `${label} RLS policy ${p.name} on ${p.schema}.${p.table}`,
      excerpt: `policy ${p.name} on ${p.schema}.${p.table} ${p.permissive} for ${p.command} to ${p.roles.join(",")}\nusing: ${p.using ?? "(none)"}\nwith check: ${p.withCheck ?? "(none)"}`,
      observation: "observed",
    };
  }

  function migrationItem(snap: SchemaSnapshot, m: SchemaSnapshot["migrations"][number]): EvidenceItem {
    return {
      source: id,
      kind: "database",
      ref: `db:migration:${m.version}`,
      timestamp: m.appliedAt,
      retrievedAt: snap.readAt,
      title: `${label} migration ${m.version}${m.name && m.name !== m.version ? ` ${m.name}` : ""}`,
      excerpt: `${m.source}: version ${m.version}${m.name ? `, name ${m.name}` : ""}${m.appliedAt ? `, applied ${m.appliedAt}` : ""}`,
      observation: "observed",
    };
  }

  const connector: PostgresConnector = {
    id,
    kind: "database",
    readOnly: true,
    implemented: true,
    description: `${label} schema, constraints, indexes, RLS policies and migration history. Read-only transactions; no row data unless sampling is enabled.`,
    readSchema,

    async test() {
      const result = emptyTestResult();
      try {
        await readOnly(async (q) => {
          const who = (
            await q(
              `select current_user as usr, current_database() as db, current_setting('server_version') as version,
                      current_setting('transaction_read_only') as ro,
                      coalesce((select rolsuper from pg_roles where rolname = current_user), false) as superuser`,
            )
          ).rows[0] ?? {};
          result.reached.push(`${label} database ${who.db} as role ${who.usr} (server ${who.version})`);
          if (who.ro !== "on") result.problems.push("The session did not report transaction_read_only = on. Nexus will not read from it.");
          if (who.superuser) result.warnings.push(`Role ${who.usr} is a superuser. Use a dedicated read-only role instead.`);
          const writable = (
            await q(
              `select n.nspname as schema, c.relname as table
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where c.relkind in ('r','p') and n.nspname = any($1)
                  and (has_table_privilege(c.oid, 'INSERT') or has_table_privilege(c.oid, 'UPDATE') or has_table_privilege(c.oid, 'DELETE'))
                limit 10`,
              [schemas],
            )
          ).rows;
          if (writable.length) {
            result.warnings.push(
              `Role ${who.usr} has INSERT, UPDATE or DELETE on ${writable.map((r) => `${r.schema}.${r.table}`).join(", ")}. Nexus only runs read-only transactions, but a role without write grants is recommended.`,
            );
          }
          const count = (
            await q(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p','v','m') and n.nspname = any($1)`, [schemas])
          ).rows[0];
          result.reached.push(`${count?.n ?? 0} tables and views visible in ${schemas.join(", ")}`);
        });
        if (config.sampling?.enabled) result.warnings.push("Row sampling is enabled. Sampled values stay out of reports unless sampling.reportable is also on.");
        result.ok = result.problems.length === 0;
      } catch (error) {
        result.problems.push(error instanceof Error ? error.message : String(error));
      }
      return result;
    },

    async search(query: SearchQuery) {
      const snap = await readSchema();
      const needle = query.text.toLowerCase();
      const items: EvidenceItem[] = [];
      for (const t of snap.tables) {
        if (query.scope && `${t.schema}.${t.name}` !== query.scope) continue;
        const hay = [t.name, t.comment ?? "", ...t.columns.map((c) => c.name)].join(" ").toLowerCase();
        if (hay.includes(needle)) items.push(tableItem(snap, t));
      }
      for (const p of snap.policies) {
        const hay = `${p.name} ${p.table} ${p.using ?? ""} ${p.withCheck ?? ""}`.toLowerCase();
        if (hay.includes(needle)) items.push(policyItem(snap, p));
      }
      for (const m of snap.migrations) {
        if (`${m.version} ${m.name ?? ""}`.toLowerCase().includes(needle)) items.push(migrationItem(snap, m));
      }
      return items.slice(0, query.limit ?? 50);
    },

    async fetch(ref: string) {
      const snap = await readSchema();
      let m = ref.match(/^db:table:([^.]+)\.(.+)$/);
      if (m) {
        const t = snap.tables.find((x) => x.schema === m![1] && x.name === m![2]);
        return t ? tableItem(snap, t) : null;
      }
      m = ref.match(/^db:policy:([^.]+)\.([^:]+):(.+)$/);
      if (m) {
        const p = snap.policies.find((x) => x.schema === m![1] && x.table === m![2] && x.name === m![3]);
        return p ? policyItem(snap, p) : null;
      }
      m = ref.match(/^db:migration:(.+)$/);
      if (m) {
        const mig = snap.migrations.find((x) => x.version === m![1]);
        return mig ? migrationItem(snap, mig) : null;
      }
      return null;
    },

    async sampleRows(table: string, limit = 5) {
      if (!config.sampling?.enabled) {
        throw new Error("Row sampling is disabled. Set sampling.enabled in the Nexus config to read sample rows.");
      }
      const snap = await readSchema();
      const t = snap.tables.find((x) => `${x.schema}.${x.name}` === table);
      if (!t) throw new Error(`${table} is not a table Nexus read from the schema.`);
      const n = Math.max(1, Math.min(limit, config.sampling.maxRows ?? 5, 20));
      const rows = await readOnly(async (q) => (await q(`select * from ${ident(t.schema)}.${ident(t.name)} limit ${n}`)).rows);
      return {
        source: id,
        kind: "database",
        ref: `db:sample:${table}`,
        timestamp: null,
        retrievedAt: nowIso(),
        title: `${label} sample of ${table} (${rows.length} rows)`,
        excerpt: clip(JSON.stringify(rows, null, 2), 8000),
        observation: "observed",
        containsSampledData: true,
        meta: { reportable: Boolean(config.sampling.reportable) },
      };
    },
  };
  return connector;
}

function passwordOf(connectionString?: string) {
  if (!connectionString) return undefined;
  try {
    return decodeURIComponent(new URL(connectionString).password) || undefined;
  } catch {
    return undefined;
  }
}
