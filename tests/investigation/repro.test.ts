import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runOnce } from "../../src/investigation/repro/browser.ts";
import { reproduceDefect } from "../../src/investigation/repro/index.ts";
import { judgeRun, type PageObservation } from "../../src/investigation/repro/judge.ts";
import { buildReproduction } from "../../src/investigation/repro/plan.ts";
import { decideRequest, makePolicy, targetRefusal } from "../../src/investigation/repro/policy.ts";
import { runPipeline, type PipelineDeps } from "../../src/investigation/pipeline.ts";
import type { DefectSpec, TicketFull } from "../../src/investigation/ticket.ts";

// ---------- a KAN-1-like spec ----------
const spec: DefectSpec = {
  area: "wishlist",
  steps: [
    "Navigate to the homepage or search page (https://happymomentsindia.com/category/venues or any category).",
    "Click on the Heart / Like icon on the top-right corner of the vendor card.",
    "Click on the Liked Vendors link / heart icon in the navigation header (navigates to /liked-vendors).",
    "Compare with https://other-site.example/page.",
  ],
  expected: "The heart icon fills red.",
  actual: 'Navigating to /liked-vendors throws an error banner: "Network error: Unexpected token \'<\'..." and displays an empty page.',
  environment: "Production",
  version: null,
  identifiers: [],
  errorMessages: ["Network error: Unexpected token"],
  codeHints: [],
  searchTerms: ["wishlist"],
  firstReportedAt: null,
  window: null,
};

test("policy: production is refused without the explicit read-only override", () => {
  assert.match(targetRefusal({ serviceUrl: "https://happymomentsindia.com", environmentName: "production", productionReadOnly: false }, ["production"]) ?? "", /read-only production override/);
  assert.equal(targetRefusal({ serviceUrl: "https://happymomentsindia.com", environmentName: "production", productionReadOnly: true }, ["production"]), null);
  assert.equal(targetRefusal({ serviceUrl: "https://staging.acme.example", environmentName: "staging", productionReadOnly: false }, ["staging"]), null);
});

test("policy: other hosts, writes and the request cap are refused; sign-in may POST only to its auth path", () => {
  const p = makePolicy({ serviceUrl: "https://happymomentsindia.com", extraHosts: ["https://xyz.supabase.co/"], loginAuthPaths: ["/auth/v1/token"], maxTotal: 3, maxRps: 5, productionReadOnly: true });
  assert.deepEqual(p.allowedHosts, ["happymomentsindia.com", "xyz.supabase.co"]);
  const d = (method: string, url: string, phase: "login" | "run" = "run", sent = 0) => decideRequest(p, { method, url, phase }, sent);
  assert.equal(d("GET", "https://happymomentsindia.com/liked-vendors").allow, true);
  assert.equal(d("GET", "https://xyz.supabase.co/rest/v1/customer_liked_vendors").allow, true);
  assert.deepEqual(d("GET", "https://evil.example/steal"), { allow: false, kind: "host", reason: "evil.example is not an allowed host." });
  assert.equal(d("GET", "https://api.happymomentsindia.com/x").allow, false, "subdomains need their own entry");
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((d(m, "https://xyz.supabase.co/rest/v1/customer_liked_vendors") as { kind: string }).kind, "write", m);
  assert.equal(d("POST", "https://xyz.supabase.co/auth/v1/token?grant_type=password", "login").allow, true);
  assert.equal(d("POST", "https://xyz.supabase.co/auth/v1/token", "run").allow, false, "auth POST only during sign-in");
  assert.equal(d("POST", "https://xyz.supabase.co/rest/v1/likes", "login").allow, false, "other writes stay blocked even during sign-in");
  assert.equal((d("GET", "https://happymomentsindia.com/", "run", 3) as { kind: string }).kind, "cap");
  assert.equal(d("GET", "data:image/png;base64,AAAA").allow, true);
  assert.equal(d("GET", "file:///etc/passwd").allow, false);
});

test("plan: pages come from the ticket's steps on the service host; symptoms from its quoted error", () => {
  const out = buildReproduction(spec, "https://happymomentsindia.com", { login: true });
  assert.ok(out.ok);
  const r = out.ok ? out.reproduction : null!;
  assert.deepEqual(r.steps, [
    { kind: "login" },
    { kind: "visit", url: "https://happymomentsindia.com/category/venues", fromStep: spec.steps[0] },
    { kind: "visit", url: "https://happymomentsindia.com/liked-vendors", fromStep: spec.steps[2] },
  ]);
  assert.ok(r.symptomTexts.includes("Network error: Unexpected token"));
  assert.equal(r.checkHtmlForData, true);
  const none = buildReproduction({ ...spec, steps: ["Open the app", "Click the heart"] }, "https://happymomentsindia.com", { login: false });
  assert.equal(none.ok, false);
});

test("judge: reproduced only by the reported symptoms, with expected and actual recorded", () => {
  const r = buildReproduction(spec, "https://happymomentsindia.com", { login: false });
  assert.ok(r.ok);
  const base: PageObservation = { url: "https://happymomentsindia.com/liked-vendors", finalUrl: "", status: 200, pageErrors: [], consoleErrors: [], htmlForData: [], failedData: [], text: "My wishlist", error: null };
  assert.equal(judgeRun(r.reproduction, [base]).reproduced, false);
  const html = judgeRun(r.reproduction, [{ ...base, htmlForData: [{ url: "https://happymomentsindia.com/api/liked", status: 200, contentType: "text/html" }] }]);
  assert.equal(html.reproduced, true);
  assert.ok(html.assertions.some((a) => a.showsDefect && a.actual.includes("/api/liked → 200 text/html")));
  assert.equal(judgeRun(r.reproduction, [{ ...base, text: "Network error: Unexpected token '<' in JSON" }]).reproduced, true);
  assert.equal(judgeRun(r.reproduction, [{ ...base, pageErrors: ["TypeError: x is undefined"] }]).reproduced, false, "an unrelated script error is not the defect");
});

// ---------- a real browser against a local fake site with the KAN-1 bug ----------

function fakeSite() {
  const writes: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const html = (body: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body>${body}</body></html>`);
    };
    if (req.method !== "GET") writes.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/category/venues") {
      return html(`<h1>Venues</h1><div id="v">Sri Sai Events</div><script>
        fetch('/api/vendors').then(r => r.json()).then(v => { document.getElementById('v').textContent = v[0]; });
        fetch('/api/likes', { method: 'POST', body: '{"vendor":"sri-sai"}' }).catch(() => {});
        fetch('http://evil.invalid/beacon').catch(() => {});
      </script>`);
    }
    if (url.pathname === "/liked-vendors") {
      return html(`<h1>Liked vendors</h1><div id="out"></div><script>
        fetch('/api/liked').then(r => r.json()).catch(e => { document.getElementById('out').textContent = 'Network error: ' + e.message; });
      </script>`);
    }
    if (url.pathname === "/api/vendors") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('["Sri Sai Events"]');
    }
    if (url.pathname === "/api/liked") return html("<p>Not the API</p>");
    if (url.pathname === "/login") {
      return html(`<form id="f"><input type="email" name="email"><input type="password" name="pw"><button type="submit">Sign in</button></form><script>
        document.getElementById('f').addEventListener('submit', async (e) => { e.preventDefault();
          await fetch('/auth/v1/token', { method: 'POST', body: 'x' }); location.href = '/account'; });
      </script>`);
    }
    if (url.pathname === "/auth/v1/token") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"access_token":"t"}');
    }
    if (url.pathname === "/account") return html("<h1>Your account</h1>");
    if (url.pathname === "/hang") return; // never answers
    res.writeHead(404);
    res.end();
  });
  return new Promise<{ base: string; writes: string[]; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ base: `http://127.0.0.1:${port}`, writes, close: () => { server.closeAllConnections(); server.close(); } });
    }),
  );
}
const workDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "nexus-repro-"));

test("browser: reproduces the HTML-for-JSON defect, blocks the write and the outside host", { timeout: 90_000 }, async () => {
  const site = await fakeSite();
  try {
    const localSpec = { ...spec, steps: [`Open ${site.base}/category/venues`, "Open /liked-vendors"] };
    const plan = buildReproduction(localSpec, site.base, { login: false });
    assert.ok(plan.ok);
    const policy = makePolicy({ serviceUrl: site.base, extraHosts: [], loginAuthPaths: [], maxTotal: 100, maxRps: 20, productionReadOnly: true });
    const dir = workDir();
    const run = await runOnce({ reproduction: plan.ok ? plan.reproduction : null!, policy, login: null, timeoutMs: 45_000, workDir: dir, index: 1 });
    assert.equal(run.error, null);
    assert.equal(run.reproduced, true);
    assert.ok(run.assertions.some((a) => a.showsDefect && a.name === "Data requests return data, not a web page"));
    assert.ok(run.assertions.some((a) => a.showsDefect && a.actual.includes("Network error: Unexpected token")));
    assert.ok(run.blocked.some((b) => b.kind === "write" && b.method === "POST" && b.url.endsWith("/api/likes")));
    assert.ok(run.blocked.some((b) => b.kind === "host" && b.url.includes("evil.invalid")));
    assert.deepEqual(site.writes, [], "no write reached the site");
    assert.ok(run.screenshot && fs.existsSync(path.join(dir, run.screenshot)));
  } finally {
    site.close();
  }
});

test("browser: the test account signs in (auth POST allowed) while other writes stay blocked", { timeout: 90_000 }, async () => {
  const site = await fakeSite();
  try {
    const plan = buildReproduction({ ...spec, steps: [`Open ${site.base}/category/venues`] }, site.base, { login: true });
    assert.ok(plan.ok);
    const policy = makePolicy({ serviceUrl: site.base, extraHosts: [], loginAuthPaths: ["/auth/v1/token"], maxTotal: 100, maxRps: 20, productionReadOnly: true });
    const run = await runOnce({ reproduction: plan.ok ? plan.reproduction : null!, policy, login: { path: "/login", username: "test@example.invalid", password: "pw-for-test" }, timeoutMs: 45_000, workDir: workDir(), index: 1 });
    assert.equal(run.login?.ok, true, run.login?.message);
    assert.deepEqual(site.writes, ["POST /auth/v1/token"], "only the sign-in request sent data");
    assert.ok(run.blocked.some((b) => b.kind === "write" && b.url.endsWith("/api/likes")));
  } finally {
    site.close();
  }
});

test("browser: stops at the request cap, and a run past its time limit is killed", { timeout: 90_000 }, async () => {
  const site = await fakeSite();
  try {
    const plan = buildReproduction({ ...spec, steps: [`Open ${site.base}/category/venues`] }, site.base, { login: false });
    const capped = await runOnce({
      reproduction: plan.ok ? plan.reproduction : null!,
      policy: makePolicy({ serviceUrl: site.base, extraHosts: [], loginAuthPaths: [], maxTotal: 1, maxRps: 20, productionReadOnly: true }),
      login: null,
      timeoutMs: 45_000,
      workDir: workDir(),
      index: 1,
    });
    assert.equal(capped.requestsSent, 1);
    assert.ok(capped.blocked.some((b) => b.kind === "cap"));

    const hang = buildReproduction({ ...spec, steps: [`Open ${site.base}/hang`] }, site.base, { login: false });
    const t0 = Date.now();
    const slow = await runOnce({
      reproduction: hang.ok ? hang.reproduction : null!,
      policy: makePolicy({ serviceUrl: site.base, extraHosts: [], loginAuthPaths: [], maxTotal: 100, maxRps: 20, productionReadOnly: true }),
      login: null,
      timeoutMs: 3000,
      workDir: workDir(),
      index: 1,
    });
    assert.equal(slow.timedOut, true);
    assert.equal(slow.reproduced, false);
    assert.match(slow.error ?? "", /time limit/);
    assert.ok(Date.now() - t0 < 20_000, "killed promptly");
  } finally {
    site.close();
  }
});

// ---------- orchestration and pipeline verdicts ----------

const serviceCtx = (config: Record<string, unknown>) => ({
  deployment: "self-hosted" as const,
  config: { serviceUrl: "https://happymomentsindia.com", environmentName: "production", maxRps: 5, maxTotal: 100, maxRunSeconds: 30, ...config } as never,
  scope: { allowedEnvironments: ["production"] },
  secrets: {},
  fetchImpl: fetch,
  siblingSecret: () => undefined,
});

test("reproduceDefect: refuses production without the override, before any browser starts", async () => {
  let called = 0;
  const out = await reproduceDefect({ spec, service: serviceCtx({ productionReadOnly: false }), workDir: workDir(), runner: async () => { called += 1; throw new Error("must not run"); } });
  assert.equal(out.status, "skipped");
  assert.match(out.status === "skipped" ? out.reason : "", /override/);
  assert.equal(called, 0);
});

test("reproduceDefect: three runs, pass rate and flakiness from code", async () => {
  let n = 0;
  const out = await reproduceDefect({
    spec,
    service: serviceCtx({ productionReadOnly: true }),
    workDir: workDir(),
    runner: async (input) => {
      n += 1;
      return { index: input.index, reproduced: n !== 2, assertions: [], pages: [], blocked: [], requestsSent: 4, login: null, screenshot: null, timedOut: false, error: null, durationMs: 10 };
    },
  });
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.totalRuns, 3);
  assert.equal(out.reproducedRuns, 2);
  assert.equal(out.flaky, true);
  assert.equal(out.mode, "production-read-only");
  assert.equal(out.summary, "Reproduced in 2 of 3 runs (flaky).");
});

const TICKET: TicketFull = {
  key: "KAN-1", source: "jira", title: "Wishlist fails", description: "x", status: null, priority: null, labels: [], components: [], environment: null, versions: [],
  createdAt: null, updatedAt: null, comments: [], links: [], attachments: [], url: null,
};
async function runWith(reproduce: PipelineDeps["reproduce"]) {
  const steps: Record<string, string> = {};
  const res = await runPipeline({
    readTicket: async () => ({ ok: true, ticket: { ...TICKET, description: "Steps to reproduce:\n1. Open /liked-vendors\nExpected: the list shows.\nActual: \"Network error: Unexpected token\" is shown." } }),
    sources: [],
    reproduce,
    isCancelled: () => false,
    recorder: { start: () => undefined, finish: (s, st) => void (steps[s] = st), evidence: () => undefined },
  });
  return { res, steps };
}

test("pipeline: not reproduced gives Not reproduced; reproduced says so without claiming a cause", async () => {
  const ran = (reproduced: boolean) => async () => ({
    status: "ran" as const, target: "https://happymomentsindia.com", mode: "production-read-only" as const, loggedIn: false,
    reproduction: { target: "https://happymomentsindia.com", steps: [{ kind: "visit" as const, url: "https://happymomentsindia.com/liked-vendors", fromStep: "x" }], symptomTexts: [], checkHtmlForData: true, basis: [] },
    runs: [], reproducedRuns: reproduced ? 3 : 0, totalRuns: 3, reproduced, flaky: false, blockedWrites: [], blockedHosts: [],
    summary: reproduced ? "Reproduced in 3 of 3 runs." : "Not reproduced in 3 runs.",
  });
  const no = await runWith(ran(false));
  assert.equal(no.res.verdict, "not_reproduced");
  assert.equal(no.steps.reproduce, "done");
  const yes = await runWith(ran(true));
  assert.equal(yes.res.verdict, "not_enough_evidence");
  assert.match(yes.res.reason, /Reproduced in 3 of 3 runs\. The defect is real, but no detector names its cause yet\./);
  const none = await runWith(undefined);
  assert.equal(none.steps.reproduce, "skipped");
});
