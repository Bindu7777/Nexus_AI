// Catalog of the systems a company can connect. Shared by the onboarding UI
// (to render fields) and the server (to validate them). No secrets here.

export type ConnectionKind = "code" | "tickets" | "database" | "docs" | "logs" | "service";

export type FieldDef = {
  name: string;
  label: string;
  type: "text" | "url" | "textarea" | "number" | "select" | "checkbox" | "email";
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
};

export type ProviderDef = {
  id: string;
  kind: ConnectionKind;
  label: string;
  /** False for providers Nexus cannot test yet. They can be saved as pending. */
  implemented: boolean;
  fields: FieldDef[];
  secret?: { label: string; required: boolean; help: string };
};

const allowInternal: FieldDef = {
  name: "allowInternal",
  label: "This target is inside the customer's network (allow a private address)",
  type: "checkbox",
  defaultValue: false,
  help: "Connection tests refuse private, loopback and cloud-metadata addresses unless you tick this for this connection.",
};

export const KINDS: { kind: ConnectionKind; step: string; title: string; blurb: string }[] = [
  { kind: "code", step: "code", title: "Code host", blurb: "Where the company's code lives. Nexus reads files, commits, diffs and issues." },
  { kind: "tickets", step: "tickets", title: "Ticket tool", blurb: "Where defects are reported. Nexus reads tickets only." },
  { kind: "database", step: "database", title: "Database", blurb: "Schema and migration metadata, through a read-only role." },
  { kind: "docs", step: "docs", title: "Documentation", blurb: "The material that explains the application." },
  { kind: "logs", step: "logs", title: "Servers and logs", blurb: "Where logs are written, read-only." },
  { kind: "service", step: "logs", title: "Service under test", blurb: "Optional. A sandbox or staging URL with hard load limits." },
];

export const PROVIDERS: ProviderDef[] = [
  // ---- code host ----
  {
    id: "github",
    kind: "code",
    label: "GitHub",
    implemented: true,
    fields: [
      { name: "serverUrl", label: "Server URL (GitHub Enterprise Server only)", type: "url", placeholder: "https://github.example.com" },
      { name: "repos", label: "Repositories", type: "textarea", required: true, placeholder: "acme/web\nacme/api", help: "One owner/name per line." },
      { name: "defaultBranch", label: "Default branch", type: "text", defaultValue: "main" },
      { name: "allowSandboxTests", label: "Allow Nexus to run tests in an isolated sandbox", type: "checkbox", defaultValue: false },
      allowInternal,
    ],
    secret: { label: "Read-only access token", required: true, help: "Fine-grained token with Contents, Issues and Pull requests set to Read-only." },
  },
  {
    id: "gitlab",
    kind: "code",
    label: "GitLab",
    implemented: false,
    fields: [
      { name: "serverUrl", label: "Server URL", type: "url", placeholder: "https://gitlab.com" },
      { name: "repos", label: "Projects or group pattern", type: "textarea", required: true, placeholder: "acme/web" },
      { name: "defaultBranch", label: "Default branch", type: "text", defaultValue: "main" },
      { name: "allowSandboxTests", label: "Allow Nexus to run tests in an isolated sandbox", type: "checkbox", defaultValue: false },
      allowInternal,
    ],
    secret: { label: "Read-only access token", required: true, help: "A token with read_api and read_repository scopes only." },
  },
  {
    id: "bitbucket",
    kind: "code",
    label: "Bitbucket",
    implemented: false,
    fields: [
      { name: "serverUrl", label: "Server URL (Data Center only)", type: "url" },
      { name: "repos", label: "Repositories", type: "textarea", required: true, placeholder: "workspace/repo" },
      { name: "defaultBranch", label: "Default branch", type: "text", defaultValue: "main" },
      { name: "allowSandboxTests", label: "Allow Nexus to run tests in an isolated sandbox", type: "checkbox", defaultValue: false },
      allowInternal,
    ],
    secret: { label: "Read-only access token", required: true, help: "An access token with repository read permission only." },
  },
  // ---- tickets ----
  {
    id: "jira-cloud",
    kind: "tickets",
    label: "Jira Cloud",
    implemented: true,
    fields: [
      { name: "siteUrl", label: "Site URL", type: "url", required: true, placeholder: "https://acme.atlassian.net" },
      { name: "email", label: "Account email", type: "email", required: true },
      { name: "projectKeys", label: "Project keys", type: "text", required: true, placeholder: "PAY, CHK", help: "Comma-separated." },
      allowInternal,
    ],
    secret: { label: "API token", required: true, help: "Create it for a user that can only browse the listed projects." },
  },
  {
    id: "jira-dc",
    kind: "tickets",
    label: "Jira Data Center",
    implemented: false,
    fields: [
      { name: "siteUrl", label: "Site URL", type: "url", required: true },
      { name: "projectKeys", label: "Project keys", type: "text", required: true },
      allowInternal,
    ],
    secret: { label: "Personal access token", required: true, help: "A token for a browse-only user." },
  },
  {
    id: "github-issues",
    kind: "tickets",
    label: "GitHub Issues",
    implemented: true,
    fields: [
      { name: "repo", label: "Repository for issues", type: "text", required: true, placeholder: "acme/web" },
      { name: "serverUrl", label: "Server URL (GitHub Enterprise Server only)", type: "url" },
      allowInternal,
    ],
    secret: { label: "Read-only access token (leave blank to reuse the code host token)", required: false, help: "Issues: Read-only." },
  },
  // ---- database ----
  ...(["supabase", "postgres", "mysql", "sqlserver", "oracle"] as const).map(
    (id): ProviderDef => ({
      id,
      kind: "database",
      label: { supabase: "Supabase", postgres: "PostgreSQL", mysql: "MySQL", sqlserver: "SQL Server", oracle: "Oracle" }[id],
      implemented: id === "supabase" || id === "postgres",
      fields: [
        { name: "host", label: "Host", type: "text", placeholder: id === "supabase" ? "db.<project>.supabase.co" : "db.internal" },
        { name: "port", label: "Port", type: "number", defaultValue: { supabase: 5432, postgres: 5432, mysql: 3306, sqlserver: 1433, oracle: 1521 }[id], min: 1, max: 65535 },
        { name: "database", label: "Database name", type: "text", defaultValue: id === "supabase" ? "postgres" : "" },
        { name: "schemas", label: "Schemas", type: "text", defaultValue: "public", help: "Comma-separated." },
        { name: "username", label: "Read-only username", type: "text", defaultValue: "nexus_readonly" },
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
        { name: "useConnectionString", label: "I will paste a full connection string instead", type: "checkbox", defaultValue: false },
        { name: "sampling", label: "Allow sampled rows (off: schema and migration metadata only)", type: "checkbox", defaultValue: false },
        allowInternal,
      ],
      secret: { label: "Password, or the full connection string", required: true, help: "For the read-only role. Use the helper below to create one." },
    }),
  ),
  // ---- docs ----
  {
    id: "confluence-cloud",
    kind: "docs",
    label: "Confluence Cloud",
    implemented: false,
    fields: [
      { name: "siteUrl", label: "Site URL", type: "url", required: true },
      { name: "email", label: "Account email", type: "email" },
      { name: "spaceKeys", label: "Space keys", type: "text", required: true },
      allowInternal,
    ],
    secret: { label: "API token", required: true, help: "For a user that can only read the listed spaces." },
  },
  {
    id: "confluence-dc",
    kind: "docs",
    label: "Confluence Data Center",
    implemented: false,
    fields: [
      { name: "siteUrl", label: "Site URL", type: "url", required: true },
      { name: "spaceKeys", label: "Space keys", type: "text", required: true },
      allowInternal,
    ],
    secret: { label: "Personal access token", required: true, help: "Read-only." },
  },
  {
    id: "docs-repo",
    kind: "docs",
    label: "Docs in a repository",
    implemented: true,
    fields: [
      { name: "repo", label: "Repository", type: "text", required: true, placeholder: "acme/web" },
      { name: "pathPrefix", label: "Path inside the repository", type: "text", defaultValue: "docs/" },
    ],
    secret: { label: "Token (leave blank to reuse the code host token)", required: false, help: "Contents: Read-only." },
  },
  {
    id: "docs-folder",
    kind: "docs",
    label: "Docs folder on the Nexus server",
    implemented: true,
    fields: [{ name: "path", label: "Absolute folder path", type: "text", required: true, placeholder: "/srv/acme/docs" }],
  },
  // ---- logs ----
  {
    id: "log-files",
    kind: "logs",
    label: "Log files",
    implemented: true,
    fields: [{ name: "path", label: "Absolute file or folder path", type: "text", required: true, placeholder: "/var/log/acme" }],
  },
  {
    id: "supabase-logs",
    kind: "logs",
    label: "Supabase logs",
    implemented: true,
    fields: [
      { name: "projectRef", label: "Project ref", type: "text", required: true },
      { name: "sources", label: "Log sources", type: "text", defaultValue: "edge_logs, postgres_logs" },
    ],
    secret: { label: "Personal access token", required: true, help: "Read access to the project is enough." },
  },
  ...(["datadog", "cloudwatch", "loki", "sentry", "other-logs"] as const).map(
    (id): ProviderDef => ({
      id,
      kind: "logs",
      label: { datadog: "Datadog", cloudwatch: "CloudWatch", loki: "Loki", sentry: "Sentry", "other-logs": "Other" }[id],
      implemented: false,
      fields: [
        { name: "endpoint", label: "Endpoint or site URL", type: "url" },
        { name: "scope", label: "Index, log group, org or project", type: "text" },
        allowInternal,
      ],
      secret: { label: "Read-only API key", required: false, help: "Use a key with read scope only." },
    }),
  ),
  // ---- service under test ----
  {
    id: "http-service",
    kind: "service",
    label: "HTTP service (sandbox or staging)",
    implemented: true,
    fields: [
      { name: "baseUrl", label: "Base URL", type: "url", required: true, placeholder: "https://staging.acme.internal" },
      { name: "environments", label: "Allowed environments", type: "text", required: true, defaultValue: "sandbox, staging", help: "Comma-separated. Production is never allowed." },
      { name: "maxRps", label: "Max requests per second", type: "number", defaultValue: 5, min: 1, max: 20 },
      { name: "maxTotal", label: "Max total requests per run", type: "number", defaultValue: 100, min: 1, max: 1000 },
      allowInternal,
    ],
  },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);
export const providersFor = (kind: ConnectionKind) => PROVIDERS.filter((p) => p.kind === kind);

export const ONBOARDING_STEPS = [
  { id: "details", title: "Company details" },
  { id: "code", title: "Code host" },
  { id: "tickets", title: "Ticket tool" },
  { id: "database", title: "Database" },
  { id: "docs", title: "Documentation" },
  { id: "logs", title: "Servers and logs" },
  { id: "review", title: "Review" },
  { id: "logins", title: "Company login" },
] as const;
export type StepId = (typeof ONBOARDING_STEPS)[number]["id"];

/** SQL that creates a read-only role, per database type. */
export function readOnlyRoleSql(provider: string, database = "your_db", schemas = "public") {
  const schemaList = schemas.split(",").map((s) => s.trim()).filter(Boolean);
  switch (provider) {
    case "supabase":
    case "postgres":
      return [
        "-- Run as an owner. Replace the password with a strong one.",
        "CREATE ROLE nexus_readonly LOGIN PASSWORD 'choose-a-strong-password';",
        "ALTER ROLE nexus_readonly SET default_transaction_read_only = on;",
        `GRANT CONNECT ON DATABASE ${database} TO nexus_readonly;`,
        ...schemaList.map((s) => `GRANT USAGE ON SCHEMA ${s} TO nexus_readonly;`),
        "-- Schema metadata is visible through the system catalogs; no table access is needed.",
        ...(provider === "supabase"
          ? ["GRANT USAGE ON SCHEMA supabase_migrations TO nexus_readonly;", "GRANT SELECT ON supabase_migrations.schema_migrations TO nexus_readonly;"]
          : []),
        "-- Only if you turn on sampled rows:",
        ...schemaList.map((s) => `-- GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO nexus_readonly;`),
      ].join("\n");
    case "mysql":
      return [
        "-- Run as an administrator. Replace the password.",
        "CREATE USER 'nexus_readonly'@'%' IDENTIFIED BY 'choose-a-strong-password';",
        `GRANT SHOW VIEW ON \`${database}\`.* TO 'nexus_readonly'@'%';`,
        "-- MySQL only lists tables a user has some privilege on. For metadata, SHOW VIEW is the narrowest grant.",
        "-- Only if you turn on sampled rows:",
        `-- GRANT SELECT ON \`${database}\`.* TO 'nexus_readonly'@'%';`,
      ].join("\n");
    case "sqlserver":
      return [
        "-- Run as an administrator. Replace the password.",
        "CREATE LOGIN nexus_readonly WITH PASSWORD = 'choose-a-strong-password';",
        `USE [${database}];`,
        "CREATE USER nexus_readonly FOR LOGIN nexus_readonly;",
        "GRANT VIEW DEFINITION TO nexus_readonly;",
        "-- Only if you turn on sampled rows:",
        "-- ALTER ROLE db_datareader ADD MEMBER nexus_readonly;",
      ].join("\n");
    case "oracle":
      return [
        "-- Run as an administrator. Replace the password.",
        'CREATE USER nexus_readonly IDENTIFIED BY "choose-a-strong-password";',
        "GRANT CREATE SESSION TO nexus_readonly;",
        "GRANT SELECT_CATALOG_ROLE TO nexus_readonly;",
        "-- Only if you turn on sampled rows, per table:",
        "-- GRANT READ ON app_schema.some_table TO nexus_readonly;",
      ].join("\n");
    default:
      return "";
  }
}
