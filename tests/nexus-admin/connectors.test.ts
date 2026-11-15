import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTempAdminEnv } from "./helpers.ts";

import { discover, render } from "../../scripts/build-connector-registry.mjs";
import { asList, connectionFields, formModel, validateValues } from "../../src/nexus-admin/connectors/form.ts";
import { DEFINITIONS } from "../../src/nexus-admin/connectors/index.generated.ts";
import { ALLOWED_DEFINITION_FUNCTIONS, checkDefinition, createRegistry, registry, setRegistryForTests } from "../../src/nexus-admin/connectors/registry.ts";
import { CATEGORIES, type ConnectorContext, type ConnectorDefinition, defineConnector } from "../../src/nexus-admin/connectors/types.ts";
import { productionLookalike } from "../../src/nexus-admin/connectors/defs/service-under-test.ts";
import { createCompany } from "../../src/nexus-admin/server/companies.ts";
import {
  addConnector,
  getCompanyConnector,
  listChecks,
  listCompanyConnectors,
  rotateSecret,
  runDefinitionTest,
  testConnector,
  updateConnector,
} from "../../src/nexus-admin/server/connectors.ts";
import { getDb, resetDbForTests } from "../../src/nexus-admin/server/db.ts";
import { checkUrlTarget } from "../../src/nexus-admin/server/ssrf.ts";

const env = setupTempAdminEnv("connectors");
const actor = { type: "nexus_admin" as const, id: 1, label: "Hima Bindu" };
const ip = "127.0.0.1";
test.after(() => {
  setRegistryForTests(null);
  resetDbForTests();
});

// ---------- a recording fetch that answers like GitHub, Jira, Supabase and a staging service ----------
function recordingFetch() {
  const calls: { method: string; url: string; hasBody: boolean }[] = [];
  const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url: url.href, hasBody: init?.body != null });
    const p = url.pathname.replace(/^\/api\/v3/, "");
    if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) {
      return json({ full_name: p.slice(7), default_branch: "main", private: true, pushed_at: "2026-11-10T00:00:00Z", html_url: "", permissions: { push: false } });
    }
    if (/\/issues$/.test(p)) return json([{ number: 5, title: "Feed duplicates", state: "open", html_url: "", body: "x", updated_at: "", created_at: "" }]);
    if (/\/git\/trees\//.test(p)) return json({ sha: "t", truncated: false, tree: [{ path: "docs/setup.md", type: "blob" }] });
    if (/\/rest\/api\/[23]\/myself$/.test(p)) return json({ displayName: "Reader" });
    const proj = p.match(/\/rest\/api\/[23]\/project\/([A-Z0-9_]+)$/);
    if (proj) return json({ key: proj[1], name: `Project ${proj[1]}` });
    if (p.includes("/analytics/endpoints/logs.all")) return json({ result: [{ timestamp: 1 }] });
    if (p === "/v2/user") return json({ user: { username: "bindu" } });
    if (/^\/v9\/projects\/[^/]+$/.test(p)) return json({ id: "prj_1", name: "happy-moments", framework: "nextjs" });
    if (p === "/v6/deployments") return json({ deployments: [{ uid: "dpl_1", url: "happy-moments.vercel.app", readyState: "READY", target: "production" }] });
    if (p.endsWith("/runtime-logs")) {
      return new Response('{"rowId":"r1","level":"error","message":"insert into moments failed","timestampInMs":1731400000000,"requestPath":"/api/moments","responseStatusCode":500}\n');
    }
    if (p === "/" || p === "") return new Response("ok", { status: 200 });
    return json({ message: "Not Found" }, 404);
  };
  return { calls, fetchImpl };
}

const allowAllTargets = async () => ({ ok: true as const, host: "test" });

function ctxFor(def: ConnectorDefinition, fetchImpl: ConnectorContext["fetchImpl"], dirs: { logs: string; docs: string }): ConnectorContext {
  const base: Record<string, ConnectorContext> = {
    github: { deployment: "cloud", config: {}, scope: { repositories: ["acme/web", "acme/api"] }, secrets: { token: "ghp_contracttoken1234567890" } } as unknown as ConnectorContext,
    "github-issues": { deployment: "cloud", config: {}, scope: { repository: "acme/web" }, secrets: { token: "ghp_contracttoken1234567890" } } as unknown as ConnectorContext,
    "docs-repo": { deployment: "cloud", config: {}, scope: { repository: "acme/web", pathPrefix: "docs/" }, secrets: { token: "ghp_contracttoken1234567890" } } as unknown as ConnectorContext,
    jira: { deployment: "self-hosted", baseUrl: "https://203.0.113.11", config: {}, scope: { projectKeys: ["PAY", "CHK"] }, secrets: { token: "jira-pat-123456" } } as unknown as ConnectorContext,
    "supabase-logs": { deployment: "cloud", config: { projectRef: "abcdefghijklmnopqrst" }, scope: { sources: ["edge_logs"] }, secrets: { token: "sbp_contracttoken" } } as unknown as ConnectorContext,
    "service-under-test": {
      deployment: "self-hosted",
      config: { serviceUrl: "https://staging.acme.example", environmentName: "staging", maxRps: 5, maxTotal: 100 },
      scope: { allowedEnvironments: ["staging"] },
      secrets: {},
    } as unknown as ConnectorContext,
    "logs-file": { deployment: "self-hosted", config: {}, scope: { paths: [dirs.logs] }, secrets: {} } as unknown as ConnectorContext,
    "docs-folder": { deployment: "self-hosted", config: {}, scope: { paths: [dirs.docs] }, secrets: {} } as unknown as ConnectorContext,
    "vercel-logs": { deployment: "cloud", config: { teamId: "team_abcdefgh", deployments: 2 }, scope: { projects: ["happy-moments"] }, secrets: { token: "vercel_contract_token" } } as unknown as ConnectorContext,
  };
  const c = base[def.id];
  if (!c) throw new Error(`No contract context for ${def.id}`);
  return { ...c, fetchImpl, siblingSecret: () => undefined };
}

function tempDirs() {
  const logs = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-logs-"));
  fs.writeFileSync(path.join(logs, "app.log"), "2026-11-10T09:00:00Z INFO start\n");
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-docs-"));
  fs.writeFileSync(path.join(docs, "README.md"), "# App\n");
  return { logs, docs };
}

// ---------- registry contract ----------

test("every registered connector passes the definition contract", () => {
  assert.ok(DEFINITIONS.length >= 30);
  for (const def of DEFINITIONS) {
    assert.doesNotThrow(() => checkDefinition(def), def.id);
    assert.equal(def.capabilities.readOnly, true, def.id);
    assert.ok(def.scopeFields.some((f) => f.required), `${def.id} requires a scope`);
    for (const [k, v] of Object.entries(def)) {
      if (typeof v === "function") assert.ok(ALLOWED_DEFINITION_FUNCTIONS.has(k), `${def.id}.${k}`);
    }
  }
  for (const c of CATEGORIES) assert.ok(registry().byCategory(c.id).length > 0, `category ${c.id} has connectors`);
});

test("build-now connectors are available; the roadmap is planned and cannot be tested", () => {
  const available = new Set(registry().all().filter((d) => d.status === "available").map((d) => d.id));
  for (const id of ["github", "jira", "github-issues", "postgres", "logs-file"]) assert.ok(available.has(id), id);
  for (const def of registry().all().filter((d) => d.status === "planned")) {
    assert.equal(def.test, undefined, `${def.id} is planned and has no test`);
  }
  for (const id of ["gitlab", "bitbucket", "azure-devops-boards", "testrail", "figma", "servicenow", "splunk"]) {
    assert.equal(registry().get(id)?.status, "planned", id);
  }
});

test("the definition contract rejects write-shaped definitions and missing scope", () => {
  const good = registry().get("github")!;
  assert.throws(() => checkDefinition({ ...good, id: "bad-one", capabilities: { ...good.capabilities, readOnly: false as unknown as true } }), /readOnly must be true/);
  assert.throws(() => checkDefinition({ ...good, id: "bad-two", scopeFields: [] }), /scope field/);
  assert.throws(() => checkDefinition({ ...good, id: "bad-three", writeIssue: async () => undefined } as unknown as ConnectorDefinition), /unexpected function "writeIssue"/);
  assert.throws(() => checkDefinition({ ...good, id: "bad-four", test: undefined }), /needs test/);
});

test("every available connector's test sends only GET requests with no body", async () => {
  const dirs = tempDirs();
  const { calls, fetchImpl } = recordingFetch();
  for (const def of registry().all().filter((d) => d.status === "available" && d.capabilities.transport !== "database")) {
    const result = await runDefinitionTest(def, ctxFor(def, fetchImpl, dirs), "live", { checkTarget: allowAllTargets });
    assert.equal(result.ok, true, `${def.id}: ${result.problems.join(" ")}`);
    assert.ok(result.reached.length > 0, `${def.id} reports what it reached`);
    assert.ok(result.readOnlyProof.length > 0, `${def.id} reports a read-only proof`);
  }
  assert.ok(calls.length >= 8);
  for (const c of calls) {
    assert.equal(c.method, "GET", c.url);
    assert.equal(c.hasBody, false, c.url);
  }
});

test("the database connector refuses to report healthy without proof that writes are refused", async () => {
  const pg = registry().get("postgres")!;
  assert.equal(pg.capabilities.transport, "database");
  const fake = defineConnector({ ...pg, id: "pg-without-proof", test: async () => ({ ok: true, reached: ["db"], problems: [], warnings: [] }), targets: undefined });
  const result = await runDefinitionTest(fake, { deployment: "cloud", config: {}, scope: {}, secrets: {}, fetchImpl: fetch, siblingSecret: () => undefined });
  assert.equal(result.ok, false);
  assert.match(result.problems.join(" "), /did not prove that writes are refused/);
});

test("the target check blocks metadata and private addresses unless allowed", async () => {
  assert.equal((await checkUrlTarget("http://169.254.169.254/latest", true)).ok, false);
  assert.equal((await checkUrlTarget("http://10.0.0.5", false)).ok, false);
  assert.equal((await checkUrlTarget("http://10.0.0.5", true)).ok, true);
});

test("the service under test refuses anything that looks like production", () => {
  assert.match(productionLookalike("https://api.acme.com", "staging", ["staging"]) ?? "", /does not name a non-production/);
  assert.match(productionLookalike("https://prod-api.acme.com", "staging", ["staging"]) ?? "", /production/);
  assert.match(productionLookalike("https://staging.acme.com", "production", ["production"]) ?? "", /production/);
  assert.equal(productionLookalike("https://staging.acme.com", "staging", ["staging"]), null);
  assert.equal(productionLookalike("http://10.1.2.3:8080", "sandbox", ["sandbox"]), null);
  const def = registry().get("service-under-test")!;
  const v = validateValues(def, {
    deployment: "self-hosted",
    config: { serviceUrl: "https://www.acme.com", environmentName: "staging", maxRps: 5, maxTotal: 100 },
    scope: { allowedEnvironments: ["staging"] },
  });
  assert.ok(v.errors.serviceUrl);
  const capped = validateValues(def, {
    deployment: "self-hosted",
    config: { serviceUrl: "https://staging.acme.com", environmentName: "staging", maxRps: 500, maxTotal: 100 },
    scope: { allowedEnvironments: ["staging"] },
  });
  assert.match(capped.errors.maxRps ?? "", /between 1 and 20/);
});

test("forms come from the definition: self-hosted adds base URL and CA, secrets carry the read-only reminder", () => {
  const github = registry().get("github")!;
  assert.deepEqual(connectionFields(github, "cloud").map((f) => f.name), ["token", "allowInternal"]);
  assert.deepEqual(connectionFields(github, "self-hosted").map((f) => f.name), ["baseUrl", "caCert", "token", "allowInternal"]);
  const model = formModel(github);
  assert.equal(model.fieldsByDeployment.cloud.find((f) => f.name === "token")?.reminder, "Use a read-only account or token.");
  assert.equal(JSON.parse(JSON.stringify(model)).fieldsByDeployment.cloud.length, 2, "model is serializable");
  const noScope = validateValues(github, { deployment: "cloud", config: { token: "x" }, scope: {} });
  assert.match(noScope.errors["scope.repositories"] ?? "", /required/);
  assert.match(noScope.errors.scope ?? "", /Scope is required/);
});

test("the generated index matches the defs folder, and a new file is picked up", () => {
  const dir = path.join(process.cwd(), "src/nexus-admin/connectors");
  assert.equal(fs.readFileSync(path.join(dir, "index.generated.ts"), "utf8"), render(discover(path.join(dir, "defs"))));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-defs-"));
  fs.writeFileSync(path.join(tmp, "github.ts"), "");
  fs.writeFileSync(path.join(tmp, "made-up-tracker.ts"), "");
  fs.writeFileSync(path.join(tmp, "notes.md"), "");
  const text = render(discover(tmp));
  assert.match(text, /import def_made_up_tracker from "\.\/defs\/made-up-tracker";/);
  assert.match(text, /^\s+def_made_up_tracker,$/m);
  assert.doesNotMatch(text, /notes/);
});

// ---------- the service, end to end, with a made-up connector added as one definition ----------

const madeUpCalls: string[] = [];
const madeUp = defineConnector({
  id: "made-up-tracker",
  category: "defects",
  displayName: "Made-up Tracker",
  description: "A connector that exists only in this test, added as a single definition.",
  status: "available",
  tier: "next",
  deployments: ["cloud"],
  fields: [{ name: "apiKey", label: "API key", type: "secret", required: true }],
  scopeFields: [{ name: "boards", label: "Boards", type: "list", required: true }],
  capabilities: { readOnly: true, reads: ["tickets"], transport: "http" },
  test: async (ctx) => {
    madeUpCalls.push(ctx.secrets.apiKey);
    const good = ctx.secrets.apiKey.startsWith("good-");
    return {
      ok: good,
      reached: good ? [`${asList(ctx.scope.boards).length} boards reachable`] : [],
      problems: good ? [] : [`Key ${ctx.secrets.apiKey} was refused.`],
      warnings: [],
    };
  },
});

test("a made-up connector added as one definition works through the API service with no other changes", async () => {
  setRegistryForTests(createRegistry([...DEFINITIONS, madeUp]));
  const companyId = createCompany(
    { name: "Happy Moments", short_code: "HM", contact_name: "Owner", contact_email: "owner@example.invalid", country: "IN", region: "Hyderabad", deployment_mode: "customer", notes: "" },
    actor,
    ip,
  );
  const bad = addConnector({ companyId, registryId: "made-up-tracker", values: { deployment: "cloud", config: {}, scope: {} }, actor, ip });
  assert.equal(bad.ok, false);

  const secret1 = "good-first-key-AAAA1111";
  const added = addConnector({ companyId, registryId: "made-up-tracker", label: "Main", values: { deployment: "cloud", config: { apiKey: secret1 }, scope: { boards: "B1\nB2" } }, actor, ip });
  assert.ok(added.ok);
  const id = added.connector.id;
  assert.equal(added.connector.active, false);
  assert.equal(added.connector.status, "never_tested");

  const first = await testConnector({ companyId, connectorId: id, trigger: "onboarding", actor, ip });
  assert.equal(first.result.ok, true);
  assert.equal(first.connector.active, true);
  assert.equal(first.connector.status, "healthy");
  assert.deepEqual(first.result.reached, ["2 boards reachable"]);

  // A failing change to an active connector is held; the old key stays in use.
  const secret2 = "bad-second-key-BBBB2222";
  const changed = updateConnector({ companyId, connectorId: id, values: { deployment: "cloud", config: { apiKey: secret2 }, scope: { boards: ["B1"] } }, actor, ip });
  assert.ok(changed.ok);
  assert.ok(changed.connector.pending);
  assert.deepEqual(changed.connector.pending!.secretFieldsChanged, ["apiKey"]);
  assert.deepEqual(changed.connector.scope.boards, ["B1", "B2"], "live scope unchanged while pending");
  const failed = await testConnector({ companyId, connectorId: id, trigger: "manual", actor, ip });
  assert.equal(failed.applied, false);
  assert.equal(failed.connector.status, "healthy", "live status untouched by a failing pending change");
  assert.doesNotMatch(JSON.stringify(failed.result), /BBBB2222/, "secret redacted from the test result");

  // Fix the pending change: blank secret keeps the pending value, so supply a good one.
  const secret3 = "good-third-key-CCCC3333";
  updateConnector({ companyId, connectorId: id, values: { deployment: "cloud", config: { apiKey: secret3 }, scope: { boards: ["B1"] } }, actor, ip });
  const applied = await testConnector({ companyId, connectorId: id, trigger: "manual", actor, ip });
  assert.equal(applied.applied, true);
  assert.equal(applied.connector.pending, null);
  assert.deepEqual(applied.connector.scope.boards, ["B1"]);

  // One-click rotation: a refused key is not applied; a good one is.
  const refused = await rotateSecret({ companyId, connectorId: id, field: "apiKey", value: "bad-rotate-DDDD4444", actor, ip });
  assert.equal(refused.applied, false);
  assert.equal(refused.connector.pending, null);
  const rotated = await rotateSecret({ companyId, connectorId: id, field: "apiKey", value: "good-rotate-EEEE5555", actor, ip });
  assert.equal(rotated.applied, true);
  assert.equal(madeUpCalls.at(-1), "good-rotate-EEEE5555");

  // History: one row per test, with status changes.
  const checks = listChecks(companyId, id);
  assert.equal(checks.length, 5);
  assert.equal(checks.at(-1)!.statusBefore, "never_tested");
  assert.equal(checks.at(-1)!.statusAfter, "healthy");

  // Secrets never appear in what the API returns, in the audit log or in check history.
  const everything = JSON.stringify({
    list: listCompanyConnectors(companyId),
    one: getCompanyConnector(companyId, id),
    checks,
    audit: getDb().prepare("SELECT * FROM audit_log").all(),
    checkRows: getDb().prepare("SELECT result_json FROM connector_checks").all(),
  });
  for (const s of [secret1, secret2, secret3, "bad-rotate-DDDD4444", "good-rotate-EEEE5555", "AAAA1111", "EEEE5555"]) {
    assert.doesNotMatch(everything, new RegExp(s), `${s} leaked`);
  }
  const pub = getCompanyConnector(companyId, id)!;
  assert.deepEqual(Object.keys(pub.secrets[0]).sort(), ["field", "label", "saved", "savedAt"]);
  assert.equal(pub.secrets[0].saved, true);

  // Audit trail covers add, test, change and rotation.
  const actions = (getDb().prepare("SELECT action FROM audit_log WHERE company_id = ?").all(companyId) as { action: string }[]).map((r) => r.action);
  for (const a of ["connector.added", "connector.tested", "connector.changed", "connector.change_applied", "connector.secret_rotated"]) {
    assert.ok(actions.includes(a), a);
  }
  // Another company cannot reach this connector through the service.
  const otherId = createCompany(
    { name: "Other Co", short_code: "OTH", contact_name: "O", contact_email: "o@example.invalid", country: "IN", region: "", deployment_mode: "customer", notes: "" },
    actor,
    ip,
  );
  assert.equal(getCompanyConnector(otherId, id), null);
  await assert.rejects(testConnector({ companyId: otherId, connectorId: id, trigger: "manual", actor, ip }), /not found for this company/);
  assert.ok(env.dbFile);
});

test("a planned connector can be recorded but never becomes active", async () => {
  setRegistryForTests(null);
  const companyId = createCompany(
    { name: "Planned Co", short_code: "PLN", contact_name: "P", contact_email: "p@example.invalid", country: "IN", region: "", deployment_mode: "customer", notes: "" },
    actor,
    ip,
  );
  const added = addConnector({ companyId, registryId: "gitlab", values: { deployment: "cloud", config: { token: "glpat-xxxxxxxxxxxxxxxxxxxx" }, scope: { projects: ["g/p"] } }, actor, ip });
  assert.ok(added.ok);
  assert.equal(added.connector.planned, true);
  const tested = await testConnector({ companyId, connectorId: added.connector.id, trigger: "manual", actor, ip });
  assert.equal(tested.result.supported, false);
  assert.match(tested.result.problems[0], /coming soon/);
  assert.equal(tested.connector.active, false);
  assert.equal(tested.connector.status, "never_tested");
});

test("Vercel logs: search reads runtime logs over GET and cites the deployment", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const def = registry().get("vercel-logs")!;
  const dirs = tempDirs();
  const c = def.build!(ctxFor(def, fetchImpl, dirs));
  const found = await c.search({ text: "moments failed" });
  assert.equal(found.length, 1);
  assert.equal(found[0].ref, "log:vercel:happy-moments:dpl_1:r1");
  assert.equal(found[0].timestamp, new Date(1731400000000).toISOString());
  assert.match(found[0].title, /error GET? ?\/api\/moments → 500|error +\/api\/moments → 500/);
  assert.ok(calls.every((x) => x.method === "GET" && !x.hasBody));
  assert.ok(calls.some((x) => x.url.includes("teamId=team_abcdefgh")), "team id is passed");
});

test("Supabase database: the connection string is checked before connecting", async () => {
  const def = registry().get("supabase-db")!;
  const base = { deployment: "cloud" as const, config: {}, scope: { schemas: ["public"] }, fetchImpl: fetch, siblingSecret: () => undefined };
  const run = (cs: string) => def.test!({ ...base, secrets: { connectionString: cs } });
  assert.match((await run("postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres")).problems[0], /Replace \[YOUR-PASSWORD\]/);
  assert.match((await run("mysql://u:p@h/db")).problems[0], /must start with postgresql/);
  assert.match((await run("not a url")).problems[0], /not a Postgres connection string/);
  assert.deepEqual(def.targets!({ ...base, secrets: { connectionString: "postgresql://nexus_readonly.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" } }), [
    { host: "aws-0-ap-south-1.pooler.supabase.com" },
  ]);
  assert.ok(def.setupHelp!({}).includes("nexus_readonly.<project-ref>"));
});
