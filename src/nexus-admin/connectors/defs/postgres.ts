// PostgreSQL, including Supabase. Schema, constraints, indexes, RLS policies
// and migrations, inside READ ONLY transactions. The test also proves the
// database refuses a write from this account.
import { createPostgresConnector } from "../../../../connectors/database/postgres";
import { probePostgresWrite, type ProbeClient } from "../../server/probe";
import { asList } from "../form";
import { allowInternalField, type ConnectorContext, defineConnector, type Values } from "../types";

function connectionString(ctx: ConnectorContext) {
  const user = encodeURIComponent(String(ctx.config.username || "nexus_readonly"));
  const pass = encodeURIComponent(ctx.secrets.password ?? "");
  return `postgres://${user}:${pass}@${ctx.config.host}:${ctx.config.port || 5432}/${encodeURIComponent(String(ctx.config.database || "postgres"))}`;
}

function sslOption(ctx: ConnectorContext) {
  if (ctx.config.ssl === "disable") return false;
  if (ctx.caCert) return { rejectUnauthorized: true, ca: ctx.caCert };
  return { rejectUnauthorized: ctx.config.ssl === "verify" };
}

async function probeClient(ctx: ConnectorContext): Promise<ProbeClient> {
  const pg = await import("pg");
  const Client = (pg.default?.Client ?? (pg as unknown as { Client: typeof pg.Client }).Client) as typeof pg.Client;
  return new Client({
    connectionString: connectionString(ctx),
    ssl: sslOption(ctx),
    application_name: "nexus-readonly-probe",
    connectionTimeoutMillis: 10_000,
  }) as unknown as ProbeClient;
}

const connector = (ctx: ConnectorContext) =>
  createPostgresConnector({
    flavor: ctx.config.flavor === "supabase" ? "supabase" : "postgres",
    connectionString: connectionString(ctx),
    schemas: asList(ctx.scope.schemas),
    ssl: (ctx.config.ssl as "require" | "verify" | "disable") || "require",
    caCert: ctx.caCert,
    sampling: { enabled: Boolean(ctx.config.sampling), reportable: false },
  });

export function readOnlyRoleSql(values: Values) {
  const database = String(values.database || "your_db");
  const schemas = asList(values.schemas).length ? asList(values.schemas) : ["public"];
  return [
    "-- Run as an owner. Replace the password with a strong one.",
    "CREATE ROLE nexus_readonly LOGIN PASSWORD 'choose-a-strong-password';",
    "ALTER ROLE nexus_readonly SET default_transaction_read_only = on;",
    `GRANT CONNECT ON DATABASE ${database} TO nexus_readonly;`,
    ...schemas.map((s) => `GRANT USAGE ON SCHEMA ${s} TO nexus_readonly;`),
    "-- Schema metadata is visible through the system catalogs; no table access is needed.",
    ...(values.flavor === "supabase"
      ? ["GRANT USAGE ON SCHEMA supabase_migrations TO nexus_readonly;", "GRANT SELECT ON supabase_migrations.schema_migrations TO nexus_readonly;"]
      : []),
    "-- Only if you turn on sampled rows:",
    ...schemas.map((s) => `-- GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO nexus_readonly;`),
  ].join("\n");
}

export default defineConnector({
  id: "postgres",
  category: "database",
  displayName: "PostgreSQL (including Supabase)",
  description: "Schema, constraints, indexes, row-level-security policies and migration history. No row data unless sampling is turned on.",
  status: "available",
  tier: "now",
  deployments: ["cloud", "self-hosted"],
  selfHosted: { baseUrl: false, caCert: true },
  fields: [
    {
      name: "flavor",
      label: "Kind",
      type: "select",
      defaultValue: "postgres",
      options: [
        { value: "supabase", label: "Supabase" },
        { value: "postgres", label: "PostgreSQL" },
      ],
    },
    { name: "host", label: "Host", type: "text", required: true, placeholder: "db.<project>.supabase.co" },
    { name: "port", label: "Port", type: "number", defaultValue: 5432, min: 1, max: 65535 },
    { name: "database", label: "Database name", type: "text", defaultValue: "postgres" },
    { name: "username", label: "Read-only username", type: "text", defaultValue: "nexus_readonly", help: "A role without write grants. Use the SQL helper." },
    { name: "password", label: "Password for the read-only role", type: "secret", required: true },
    {
      name: "ssl",
      label: "TLS",
      type: "select",
      defaultValue: "require",
      options: [
        { value: "require", label: "Require" },
        { value: "verify", label: "Require and verify certificate" },
        { value: "disable", label: "Disable (local only)" },
      ],
    },
    { name: "sampling", label: "Allow sampled rows (off: schema and migration metadata only)", type: "checkbox", defaultValue: false },
    allowInternalField,
  ],
  scopeFields: [
    {
      name: "schemas",
      label: "Schemas",
      type: "list",
      required: true,
      defaultValue: ["public"],
      help: "Nexus reads metadata for these schemas only.",
      validate: (v) => (asList(v).every((s) => /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(s)) ? null : "Use plain schema names such as public."),
    },
  ],
  capabilities: { readOnly: true, reads: ["schema", "constraints", "indexes", "RLS policies", "migrations"], transport: "database" },
  setupHelp: readOnlyRoleSql,
  targets: (ctx) => [{ host: String(ctx.config.host) }],
  test: async (ctx) => {
    const result = await connector(ctx).test();
    const proof: string[] = [];
    const probe = await probePostgresWrite(() => probeClient(ctx), asList(ctx.scope.schemas));
    if (probe.error) result.problems.push(`The write-safety check could not run: ${probe.error}`);
    else if (probe.writeBlocked) proof.push("Write attempt blocked: CREATE TEMP TABLE inside a read-only transaction was refused by the database (rolled back).");
    else result.problems.push("The write-safety check did not see the database refuse a write. Do not use this account.");
    result.warnings.push(...probe.warnings);
    result.ok = result.ok && result.problems.length === 0;
    return { ...result, readOnlyProof: proof };
  },
  build: connector,
});
