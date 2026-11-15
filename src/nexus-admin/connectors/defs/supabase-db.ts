// Supabase database, connected by pasting the connection string from the
// Supabase dashboard (Connect → Session pooler). Same read-only behaviour as
// PostgreSQL: READ ONLY transactions, schema metadata only, and a test that
// proves the database refuses a write.
import { createPostgresConnector } from "../../../../connectors/database/postgres";
import { probePostgresWrite, type ProbeClient } from "../../server/probe";
import { asList } from "../form";
import { type ConnectorContext, defineConnector, type Values } from "../types";
import { readOnlyRoleSql } from "./postgres";

function parsed(ctx: ConnectorContext) {
  const raw = (ctx.secrets.connectionString ?? "").trim();
  if (!raw) throw new Error("Paste the connection string from Supabase.");
  if (/\[YOUR-PASSWORD\]/i.test(raw)) throw new Error("Replace [YOUR-PASSWORD] in the connection string with the database password.");
  let url: URL;
  try {
    url = new URL(raw.replace(/^postgresql:/, "postgres:"));
  } catch {
    throw new Error("That is not a Postgres connection string. Copy it from Supabase → Connect.");
  }
  if (url.protocol !== "postgres:") throw new Error("The connection string must start with postgresql:// or postgres://.");
  return { raw, url };
}

const ssl = { rejectUnauthorized: false };

async function probeClient(cs: string): Promise<ProbeClient> {
  const pg = await import("pg");
  const Client = (pg.default?.Client ?? (pg as unknown as { Client: typeof pg.Client }).Client) as typeof pg.Client;
  return new Client({ connectionString: cs, ssl, application_name: "nexus-readonly-probe", connectionTimeoutMillis: 10_000 }) as unknown as ProbeClient;
}

const connector = (ctx: ConnectorContext) =>
  createPostgresConnector({
    id: "supabase-db",
    flavor: "supabase",
    connectionString: parsed(ctx).raw,
    schemas: asList(ctx.scope.schemas),
    ssl: "require",
    sampling: { enabled: Boolean(ctx.config.sampling), reportable: false },
  });

function setupHelp(values: Values) {
  return [
    "Recommended: a read-only role instead of the postgres user.",
    "",
    readOnlyRoleSql({ ...values, flavor: "supabase", database: "postgres" }),
    "",
    "-- Then in Supabase → Connect → Session pooler, copy the URI and change the user part",
    "-- from postgres.<project-ref> to nexus_readonly.<project-ref>, with that role's password.",
  ].join("\n");
}

export default defineConnector({
  id: "supabase-db",
  category: "database",
  displayName: "Supabase database",
  description: "Paste the connection string from Supabase. Schema, RLS policies and migrations, read-only. No row data unless sampling is turned on.",
  status: "available",
  tier: "now",
  deployments: ["cloud"],
  fields: [
    {
      name: "connectionString",
      label: "Connection string",
      type: "secret",
      required: true,
      placeholder: "postgresql://nexus_readonly.abcdefghijklmnop:password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
      help: "Supabase dashboard → Connect → Session pooler → URI, with the password filled in. Prefer a read-only role (see Setup help).",
    },
    { name: "sampling", label: "Allow sampled rows (off: schema and migration metadata only)", type: "checkbox", defaultValue: false },
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
  setupHelp,
  targets: (ctx) => {
    try {
      return [{ host: parsed(ctx).url.hostname }];
    } catch {
      return [];
    }
  },
  test: async (ctx) => {
    let info: ReturnType<typeof parsed>;
    try {
      info = parsed(ctx);
    } catch (error) {
      return { ok: false, reached: [], problems: [error instanceof Error ? error.message : String(error)], warnings: [] };
    }
    const warnings: string[] = [];
    const user = decodeURIComponent(info.url.username);
    if (/^postgres(\.|$)/.test(user)) {
      warnings.push("This uses the postgres user, which can change data. Nexus only runs read-only transactions, but a read-only role is recommended (see Setup help).");
    }
    if (/^db\.[a-z0-9]+\.supabase\.co$/.test(info.url.hostname)) {
      warnings.push("This is the direct connection, which many Supabase projects serve over IPv6 only. If the test cannot connect, use the Session pooler string instead.");
    }
    const result = await connector(ctx).test();
    result.warnings.push(...warnings);
    const proof: string[] = [];
    const probe = await probePostgresWrite(() => probeClient(info.raw), asList(ctx.scope.schemas));
    if (probe.error) result.problems.push(`The write-safety check could not run: ${probe.error}`);
    else if (probe.writeBlocked) proof.push("Write attempt blocked: CREATE TEMP TABLE inside a read-only transaction was refused by the database (rolled back).");
    else result.problems.push("The write-safety check did not see the database refuse a write. Do not use this connection.");
    result.warnings.push(...probe.warnings);
    result.ok = result.ok && result.problems.length === 0;
    return { ...result, readOnlyProof: proof };
  },
  build: connector,
});
