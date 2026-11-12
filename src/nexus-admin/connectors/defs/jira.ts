// Jira Cloud (email + API token, Basic auth) and Jira Data Center (personal
// access token, Bearer auth). Both read with GET only.
import { createReadOnlyHttp, redact } from "../../../../connectors/http";
import { createJiraConnector } from "../../../../connectors/tickets/jira";
import { asList } from "../form";
import { allowInternalField, type ConnectorContext, defineConnector } from "../types";

const site = (ctx: ConnectorContext) => String(ctx.deployment === "cloud" ? ctx.config.siteUrl : ctx.baseUrl).replace(/\/$/, "");

function auth(ctx: ConnectorContext) {
  return ctx.deployment === "cloud"
    ? `Basic ${Buffer.from(`${ctx.config.email}:${ctx.secrets.token}`).toString("base64")}`
    : `Bearer ${ctx.secrets.token}`;
}

export default defineConnector({
  id: "jira",
  category: "defects",
  displayName: "Jira",
  description: "Reads tickets from the listed Jira projects. Cloud and Data Center.",
  status: "available",
  tier: "now",
  deployments: ["cloud", "self-hosted"],
  selfHosted: { baseUrlLabel: "Jira Data Center URL", baseUrlPlaceholder: "https://jira.example.internal" },
  fields: [
    { name: "siteUrl", label: "Site URL", type: "url", required: true, placeholder: "https://acme.atlassian.net", deployments: ["cloud"] },
    { name: "email", label: "Account email", type: "email", required: true, deployments: ["cloud"] },
    {
      name: "token",
      label: "API token (Cloud) or personal access token (Data Center)",
      type: "secret",
      required: true,
      help: "Create it for a user who can only browse the projects listed below.",
    },
    allowInternalField,
  ],
  scopeFields: [
    {
      name: "projectKeys",
      label: "Project keys",
      type: "list",
      required: true,
      placeholder: "PAY\nCHK",
      validate: (v) => (asList(v).every((k) => /^[A-Z][A-Z0-9_]{0,19}$/.test(k)) ? null : "Use Jira project keys such as PAY or CHK."),
    },
  ],
  capabilities: { readOnly: true, reads: ["tickets", "ticket comments"], transport: "http" },
  targets: (ctx) => [{ url: site(ctx) }],
  test: async (ctx) => {
    const token = ctx.secrets.token;
    const header = auth(ctx);
    const http = createReadOnlyHttp({ fetchImpl: ctx.fetchImpl, secrets: [token, header], baseHeaders: { authorization: header } });
    const api = ctx.deployment === "cloud" ? "3" : "2";
    const base = site(ctx);
    const result = { ok: false, reached: [] as string[], problems: [] as string[], warnings: [] as string[] };
    try {
      const me = await http.getJson<{ displayName?: string }>(`${base}/rest/api/${api}/myself`);
      if (me.status !== 200) {
        result.problems.push(`Jira refused the credentials (HTTP ${me.status}). Check the ${ctx.deployment === "cloud" ? "email and API token" : "personal access token"}.`);
        return result;
      }
      result.reached.push(`Jira ${base} as ${me.data?.displayName ?? "the configured account"}`);
      const keys = asList(ctx.scope.projectKeys);
      let found = 0;
      for (const key of keys) {
        const p = await http.getJson<{ key?: string; name?: string }>(`${base}/rest/api/${api}/project/${encodeURIComponent(key)}`);
        if (p.status === 200) {
          found += 1;
          result.reached.push(`Project ${p.data?.key} (${p.data?.name})`);
        } else result.problems.push(`Project ${key} is not visible to this account (HTTP ${p.status}).`);
      }
      result.reached.unshift(`${found} of ${keys.length} ${keys.length === 1 ? "project" : "projects"} reachable`);
      result.ok = result.problems.length === 0;
    } catch (error) {
      result.problems.push(redact(error instanceof Error ? error.message : String(error), [token, header]));
    }
    return result;
  },
  build: (ctx) =>
    createJiraConnector({
      env: {
        JIRA_BASE_URL: site(ctx),
        JIRA_EMAIL: String(ctx.config.email ?? ""),
        JIRA_API_TOKEN: ctx.secrets.token,
        JIRA_PROJECT_KEY: asList(ctx.scope.projectKeys)[0] ?? "",
      },
      fetchImpl: ctx.fetchImpl,
    }),
});
