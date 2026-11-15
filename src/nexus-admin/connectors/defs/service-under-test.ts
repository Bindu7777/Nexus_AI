// The website Nexus may use to reproduce a defect. Normally a staging or
// sandbox site. Anything that looks like production is refused unless the
// admin ticks the explicit read-only override: then Nexus may only load pages
// and read responses, and every request that would save data is blocked
// (sign-in excepted, to the configured auth paths only).
import { parseAllowedWrites } from "../../../investigation/repro/policy";
import { createReadOnlyHttp } from "../../../../connectors/http";
import { asList } from "../form";
import { allowInternalField, defineConnector } from "../types";

const PROD = /(^|[^a-z])(prod|production|prd|live)([^a-z]|$)/i;
const NON_PROD = /(^|[.-])(staging|stage|stg|sandbox|sbx|dev|develop|test|testing|qa|uat|preview|demo|perf|load)([.-]|\d|$)/i;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?)$/i;

/** Plain reason when a URL or environment looks like production, otherwise null. */
export function productionLookalike(url: string, envName: string, allowlist: string[]): string | null {
  for (const e of [envName, ...allowlist]) {
    if (PROD.test(e)) return `"${e}" looks like production. Nexus never sends load to production.`;
  }
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "Enter a full service URL.";
  }
  if (PROD.test(host)) return `${host} looks like a production host. Nexus never sends load to production.`;
  if (!LOCAL.test(host) && !NON_PROD.test(host)) {
    return `${host} does not name a non-production environment (for example staging, sandbox, dev, qa, uat). Nexus refuses hosts that could be production.`;
  }
  return null;
}

export default defineConnector({
  id: "service-under-test",
  category: "services",
  displayName: "Service under test (website to reproduce on)",
  description: "The website Nexus opens in a browser to reproduce a defect. Staging by default; production only with an explicit read-only override.",
  status: "available",
  tier: "now",
  deployments: ["self-hosted"],
  selfHosted: { baseUrl: false, caCert: true },
  fields: [
    { name: "serviceUrl", label: "Service URL", type: "url", required: true, placeholder: "https://staging.acme.internal" },
    { name: "environmentName", label: "This service's environment", type: "text", required: true, placeholder: "staging" },
    { name: "maxRps", label: "Hard cap: requests per second", type: "number", required: true, defaultValue: 5, min: 1, max: 20 },
    { name: "maxTotal", label: "Hard cap: total requests per run", type: "number", required: true, defaultValue: 300, min: 1, max: 1000 },
    { name: "maxRunSeconds", label: "Hard cap: seconds per reproduction run", type: "number", defaultValue: 60, min: 10, max: 180 },
    {
      name: "productionReadOnly",
      label: "This is production. I allow Nexus to reproduce here READ-ONLY: it may only load pages and read responses, and every request that would save data is blocked.",
      type: "checkbox",
      defaultValue: false,
      help: "Leave off for staging or sandbox sites. Required for any URL that looks like production.",
    },
    {
      name: "extraHosts",
      label: "Other hosts the site needs (API, images, scripts)",
      type: "list",
      placeholder: "api.example.com\nxyz.supabase.co\ncdn.example.com",
      help: "Nexus blocks every other host. The first reproduction run lists any host it blocked, so you can add it here.",
    },
    { name: "loginPath", label: "Sign-in page path (optional)", type: "text", placeholder: "/login", help: "Leave blank to reproduce as an anonymous visitor." },
    { name: "testUsername", label: "Test account email or username (optional)", type: "text", help: "A dedicated test customer. Never a real customer's account." },
    { name: "testPassword", label: "Test account password", type: "secret", help: "Only used to sign in the test account during reproduction." },
    {
      name: "loginAuthPaths",
      label: "Sign-in request paths allowed to send data",
      type: "list",
      defaultValue: ["/auth/v1/token"],
      help: "During sign-in only, requests to these paths may POST (for Supabase: /auth/v1/token). Every other write stays blocked.",
    },
    {
      name: "allowedWrites",
      label: "Saves allowed for the test account (exact requests)",
      type: "list",
      placeholder: "POST api.example.com/api/likes/save-like",
      help: "One per line: METHOD host/path, exact, no wildcards. Only these requests may save data, only after the test account has signed in, and only up to the cap below. Every other write stays blocked. Leave empty to stay fully read-only.",
    },
    {
      name: "allowWritesConfirm",
      label: "I allow exactly these saves on this site for the test account. Each one changes real data (for example, a wishlist row for the test customer).",
      type: "checkbox",
      defaultValue: false,
      help: "Required when any save is listed above.",
    },
    { name: "maxAllowedWrites", label: "Hard cap: allowed saves per run", type: "number", defaultValue: 3, min: 1, max: 10 },
    { name: "usernameSelector", label: "Username field selector (optional)", type: "text", placeholder: "input[type=email]" },
    { name: "passwordSelector", label: "Password field selector (optional)", type: "text", placeholder: "input[type=password]" },
    { name: "submitSelector", label: "Sign-in button selector (optional)", type: "text", placeholder: "button[type=submit]" },
    allowInternalField,
  ],
  scopeFields: [
    {
      name: "allowedEnvironments",
      label: "Environment allowlist",
      type: "list",
      required: true,
      defaultValue: ["staging", "sandbox"],
      help: "Nexus reproduces only in these environments. Production needs the read-only override above.",
    },
  ],
  capabilities: { readOnly: true, reads: ["HTTP responses from the service under test"], transport: "http" },
  validate: ({ config, scope }) => {
    const errors: Record<string, string> = {};
    const allow = asList(scope.allowedEnvironments).map((e) => e.toLowerCase());
    const env = String(config.environmentName ?? "").toLowerCase();
    const prod = productionLookalike(String(config.serviceUrl ?? ""), env, allow);
    if (prod && !config.productionReadOnly) errors.serviceUrl = `${prod} To reproduce on production anyway, tick the read-only override.`;
    if (config.testUsername && !config.loginPath) errors.loginPath = "Enter the sign-in page path for the test account.";
    if (env && !allow.includes(env)) errors.environmentName = `${env} is not in the environment allowlist.`;
    const writes = parseAllowedWrites(asList(config.allowedWrites));
    if (writes.invalid.length) errors.allowedWrites = `Use METHOD host/path, for example POST api.example.com/api/likes. Not valid: ${writes.invalid.slice(0, 2).join(", ")}`;
    else if (writes.writes.length > 5) errors.allowedWrites = "List at most 5 saves.";
    else if (writes.writes.length && !config.testUsername) errors.allowedWrites = "Allowed saves need a test account: they are only sent while it is signed in.";
    else if (writes.writes.length && !config.allowWritesConfirm) errors.allowWritesConfirm = "Tick this to allow the listed saves.";
    return errors;
  },
  targets: (ctx) => [{ url: String(ctx.config.serviceUrl) }],
  test: async (ctx) => {
    const prod = productionLookalike(String(ctx.config.serviceUrl), String(ctx.config.environmentName), asList(ctx.scope.allowedEnvironments));
    if (prod && !ctx.config.productionReadOnly) return { ok: false, reached: [], problems: [prod], warnings: [] };
    const http = createReadOnlyHttp({ fetchImpl: ctx.fetchImpl, timeoutMs: 8000 });
    const response = await http.get(String(ctx.config.serviceUrl));
    return {
      ok: response.status < 500,
      reached: [
        `${ctx.config.serviceUrl} answered HTTP ${response.status} to one GET. No load was sent.`,
        `Limits: at most ${ctx.config.maxRps} requests per second and ${ctx.config.maxTotal} per run, environment ${ctx.config.environmentName}.`,
        ...(ctx.config.productionReadOnly ? ["Production, read-only: pages are loaded and read; every request that would save data is blocked."] : []),
        ...(() => {
          const w = ctx.config.allowWritesConfirm ? parseAllowedWrites(asList(ctx.config.allowedWrites)).writes : [];
          return w.length
            ? [`Allowed saves for the signed-in test account, at most ${ctx.config.maxAllowedWrites || 3} per run: ${w.map((x) => `${x.method} ${x.host}${x.path}`).join("; ")}. Every other write is blocked.`]
            : [];
        })(),
        ...(ctx.config.testUsername ? [`Test account configured: ${ctx.config.testUsername} (sign-in at ${ctx.config.loginPath}).`] : ["No test account: Nexus reproduces as an anonymous visitor."]),
      ],
      problems: response.status >= 500 ? [`The service answered HTTP ${response.status}.`] : [],
      warnings: ctx.config.testUsername && !ctx.secrets.testPassword ? ["A test username is set but no password is saved."] : [],
    };
  },
});
