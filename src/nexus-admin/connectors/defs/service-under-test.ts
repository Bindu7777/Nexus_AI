// The staging or sandbox service Nexus may send limited load to. The test
// sends ONE GET and no load. Anything that looks like production is refused.
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
  displayName: "Service under test (staging or sandbox)",
  description: "A non-production HTTP service Nexus may send limited load to, to reproduce a defect.",
  status: "available",
  tier: "now",
  deployments: ["self-hosted"],
  selfHosted: { baseUrl: false, caCert: true },
  fields: [
    { name: "serviceUrl", label: "Service URL", type: "url", required: true, placeholder: "https://staging.acme.internal" },
    { name: "environmentName", label: "This service's environment", type: "text", required: true, placeholder: "staging" },
    { name: "maxRps", label: "Hard cap: requests per second", type: "number", required: true, defaultValue: 5, min: 1, max: 20 },
    { name: "maxTotal", label: "Hard cap: total requests per run", type: "number", required: true, defaultValue: 100, min: 1, max: 1000 },
    allowInternalField,
  ],
  scopeFields: [
    {
      name: "allowedEnvironments",
      label: "Environment allowlist",
      type: "list",
      required: true,
      defaultValue: ["staging", "sandbox"],
      help: "Nexus sends load only to these environments. Production is never allowed.",
    },
  ],
  capabilities: { readOnly: true, reads: ["HTTP responses from the service under test"], transport: "http" },
  validate: ({ config, scope }) => {
    const errors: Record<string, string> = {};
    const allow = asList(scope.allowedEnvironments).map((e) => e.toLowerCase());
    const env = String(config.environmentName ?? "").toLowerCase();
    const prod = productionLookalike(String(config.serviceUrl ?? ""), env, allow);
    if (prod) errors.serviceUrl = prod;
    if (env && !allow.includes(env)) errors.environmentName = `${env} is not in the environment allowlist.`;
    return errors;
  },
  targets: (ctx) => [{ url: String(ctx.config.serviceUrl) }],
  test: async (ctx) => {
    const prod = productionLookalike(String(ctx.config.serviceUrl), String(ctx.config.environmentName), asList(ctx.scope.allowedEnvironments));
    if (prod) return { ok: false, reached: [], problems: [prod], warnings: [] };
    const http = createReadOnlyHttp({ fetchImpl: ctx.fetchImpl, timeoutMs: 8000 });
    const response = await http.get(String(ctx.config.serviceUrl));
    return {
      ok: response.status < 500,
      reached: [
        `${ctx.config.serviceUrl} answered HTTP ${response.status} to one GET. No load was sent.`,
        `Limits: at most ${ctx.config.maxRps} requests per second and ${ctx.config.maxTotal} per run, environment ${ctx.config.environmentName}.`,
      ],
      problems: response.status >= 500 ? [`The service answered HTTP ${response.status}.`] : [],
      warnings: [],
    };
  },
});
