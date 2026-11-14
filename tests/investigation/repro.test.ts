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
    { kind: "click", targets: ["Heart", "Like"], fromStep: spec.steps[1] },
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

// ---------- live server logs ----------

test("live logs: a log stream that sends nothing is empty, not a failure", async () => {
  const { createReadOnlyHttp } = await import("../../connectors/http.ts");
  // A fetch that never answers until aborted, like Vercel's runtime-logs stream with no traffic.
  const hang = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("This operation was aborted"))));
  const httpc = createReadOnlyHttp({ fetchImpl: hang });
  const capped = await httpc.getTextCapped("https://api.vercel.com/x", {}, { maxMs: 50 });
  assert.equal(capped.noResponse, true);
  assert.equal(capped.text, "");
  const stopper = new AbortController();
  const pending = httpc.getTextCapped("https://api.vercel.com/x", {}, { maxMs: 60_000, signal: stopper.signal });
  stopper.abort();
  assert.equal((await pending).noResponse, true);
  // A real network failure still fails.
  const broken = createReadOnlyHttp({ fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(broken.getTextCapped("https://api.vercel.com/x", {}, { maxMs: 1000 }), /ECONNREFUSED/);
});

function fakeVercel(stream: (signal: AbortSignal) => Response) {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    assert.equal((init?.method ?? "GET").toUpperCase(), "GET");
    calls.push(new URL(url).pathname);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/v9/projects/")) return json({ id: "prj_1", name: "happy-moments" });
    if (url.includes("/v6/deployments"))
      return json({ deployments: [{ uid: "dpl_old", readyState: "READY", target: null }, { uid: "dpl_prod", readyState: "READY", target: "production" }] });
    if (url.includes("/runtime-logs")) return stream(init!.signal!);
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}

test("live logs: Vercel tail watches the production deployment until stopped and keeps the lines", async () => {
  const { createVercelLogsConnector } = await import("../../connectors/logs/vercel.ts");
  const now = Date.now();
  const { calls, fetchImpl } = fakeVercel((signal) => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(enc.encode(JSON.stringify({ rowId: "old", timestampInMs: now - 60_000, message: "before the run" }) + "\n"));
        ctrl.enqueue(enc.encode(JSON.stringify({ rowId: "a", timestampInMs: now + 10, level: "info", requestMethod: "GET", requestPath: "/liked-vendors", responseStatusCode: 200, message: "<!doctype html>" }) + "\n"));
        ctrl.enqueue(enc.encode(JSON.stringify({ rowId: "b", timestampInMs: now + 20, level: "error", requestMethod: "GET", requestPath: "/api/wishlist", responseStatusCode: 500, message: "boom" }) + "\n"));
        signal.addEventListener("abort", () => ctrl.error(new Error("aborted")));
      },
    });
    return new Response(body, { status: 200 });
  });
  const c = createVercelLogsConnector({ token: "tok_secret_1234", projects: ["happy-moments"], fetchImpl });
  const stopper = new AbortController();
  const pending = c.tail({ maxMs: 60_000, signal: stopper.signal, since: now });
  await new Promise((r) => setTimeout(r, 50));
  stopper.abort();
  const lines = await pending;
  assert.deepEqual(lines.map((l) => l.meta?.path), ["/liked-vendors", "/api/wishlist"]);
  assert.equal(lines[1].meta?.status, 500);
  assert.equal(lines[0].meta?.live, true);
  assert.ok(calls.some((p) => p.includes("/deployments/dpl_prod/runtime-logs")), "tails the production deployment");
});

test("live logs: Vercel search reads each deployment's stream once, however many terms", async () => {
  const { createVercelLogsConnector } = await import("../../connectors/logs/vercel.ts");
  const { calls, fetchImpl } = fakeVercel(() => new Response(JSON.stringify({ rowId: "x", message: "GET /liked-vendors" }) + "\n", { status: 200 }));
  const c = createVercelLogsConnector({ token: "tok_secret_1234", projects: ["happy-moments"], deploymentsPerProject: 2, fetchImpl });
  assert.equal((await c.search({ text: "/liked-vendors" })).length, 2);
  assert.equal((await c.search({ text: "nothing" })).length, 0);
  assert.equal(calls.filter((p) => p.includes("runtime-logs")).length, 2);
});

test("pipeline: live server logs are watched during the reproduction and land in the report", async () => {
  let watching = false;
  let stoppedAfterRepro = false;
  const steps: Record<string, string> = {};
  const evidence: string[] = [];
  const res = await runPipeline({
    readTicket: async () => ({ ok: true, ticket: { ...TICKET, description: "Steps to reproduce:\n1. Open /liked-vendors\nExpected: the list shows.\nActual: \"Network error: Unexpected token\" is shown." } }),
    sources: [],
    liveLogGraceMs: 10,
    liveLogs: [
      {
        name: "Happy Moments Vercel",
        secretValues: ["tok_secret_1234"],
        tail: ({ signal }) =>
          new Promise((resolve) => {
            watching = true;
            signal?.addEventListener("abort", () => resolve([
              { source: "vercel-logs", kind: "logs", ref: "log:vercel:hm:dpl:1", timestamp: null, retrievedAt: "", title: "GET /api/wishlist → 500", excerpt: "failed with tok_secret_1234", observation: "observed", meta: { status: 500, live: true } },
            ]));
          }),
      },
    ],
    reproduce: async () => {
      assert.equal(watching, true, "logs are watched before the browser starts");
      stoppedAfterRepro = true;
      return {
        status: "ran" as const, target: "https://happymomentsindia.com", mode: "production-read-only" as const, loggedIn: false,
        reproduction: { target: "https://happymomentsindia.com", steps: [{ kind: "visit" as const, url: "https://happymomentsindia.com/liked-vendors", fromStep: "x" }], symptomTexts: [], checkHtmlForData: true, basis: [] },
        runs: [], reproducedRuns: 3, totalRuns: 3, reproduced: true, flaky: false, blockedWrites: [], blockedHosts: [], summary: "Reproduced in 3 of 3 runs.",
      };
    },
    isCancelled: () => false,
    recorder: { start: () => undefined, finish: (s, st) => void (steps[s] = st), evidence: (_s, items) => void evidence.push(...items.map((i) => `${i.title} ${i.excerpt}`)) },
  });
  assert.equal(stoppedAfterRepro, true);
  assert.deepEqual(res.report.liveLogs, [{ source: "Happy Moments Vercel", status: "ok", lines: 1, serverErrors: 1, message: "1 server log line while the reproduction ran, 1 of them errors." }]);
  const line = evidence.find((e) => e.includes("/api/wishlist"));
  assert.ok(line);
  assert.ok(!line.includes("tok_secret_1234"), "secrets are redacted");
});

test("pipeline: step paths are pulled from URLs and bare paths", async () => {
  const { stepPaths } = await import("../../src/investigation/pipeline.ts");
  assert.deepEqual(stepPaths(spec.steps), ["/category/venues", "/liked-vendors", "/page"]);
});

// ---------- sign-in walls ----------

test("judge: a page that only shows a sign-in prompt is inconclusive, not a pass", async () => {
  const { judgeRun, looksLikeSignInWall } = await import("../../src/investigation/repro/judge.ts");
  const plan = buildReproduction(spec, "https://happymomentsindia.com", {});
  assert.ok(plan.ok);
  if (!plan.ok) return;
  const base = { status: 200, pageErrors: [], consoleErrors: [], htmlForData: [], failedData: [], error: null };
  const wall = { ...base, url: "https://happymomentsindia.com/liked-vendors", finalUrl: "https://happymomentsindia.com/liked-vendors", text: "HappyMoments Categories Login Sign Up\nLogin", mainText: "Login" };
  const venues = { ...base, url: "https://happymomentsindia.com/category/venues", finalUrl: "https://happymomentsindia.com/category/venues", text: "Venues ...", mainText: "Venues in Hyderabad. ".repeat(30) };
  assert.equal(looksLikeSignInWall(wall), true);
  assert.equal(looksLikeSignInWall(venues), false);
  assert.equal(looksLikeSignInWall({ ...venues, finalUrl: "https://happymomentsindia.com/customer-login" }), true);
  assert.equal(looksLikeSignInWall({ ...venues, hasPasswordField: true }), true);
  const visitor = judgeRun(plan.reproduction, [venues, wall]);
  assert.equal(visitor.reproduced, false);
  assert.deepEqual(visitor.needsSignIn, ["/liked-vendors"]);
  assert.ok(visitor.assertions.some((a) => a.name === "Page shows its content" && !a.passed && !a.showsDefect));
  // Signed in, the same short page is judged on its own merits.
  assert.deepEqual(judgeRun(plan.reproduction, [wall], { loggedIn: true }).needsSignIn, []);
});

test("reproduceDefect: sign-in walls make the result inconclusive, and the pipeline does not say Not reproduced", async () => {
  const service = {
    config: { serviceUrl: "https://happymomentsindia.com", environmentName: "production", productionReadOnly: true, testUsername: "tester@example.com", loginPath: "/customer-login" },
    scope: { allowedEnvironments: ["production"] },
    secrets: {},
    deployment: "cloud" as const,
  };
  const out = await reproduceDefect({
    spec,
    service: service as never,
    workDir: fs.mkdtempSync(path.join(os.tmpdir(), "nexus-repro-")),
    runner: async (input) => ({ index: input.index, reproduced: false, assertions: [], needsSignIn: ["/liked-vendors"], pages: [], blocked: [], requestsSent: 3, login: null, screenshot: null, timedOut: false, error: null, durationMs: 5 }),
  });
  assert.equal(out.status, "ran");
  if (out.status !== "ran") return;
  assert.equal(out.inconclusive, true);
  assert.match(out.summary, /^Inconclusive: \/liked-vendors showed a sign-in prompt .* no password is saved for the test account tester@example\.com/);
  const { res } = await runWith(async () => out);
  assert.equal(res.verdict, "not_enough_evidence");
  assert.ok(res.report.couldNotVerify.some((c) => c.includes("/liked-vendors needs a signed-in customer")));
});

// ---------- allowed saves and click steps ----------

test("plan: click targets come from the step's wording by fixed rules", async () => {
  const { clickTargets } = await import("../../src/investigation/repro/plan.ts");
  assert.deepEqual(clickTargets("Click on the Heart / Like icon on the top-right corner of the vendor card."), ["Heart", "Like"]);
  assert.deepEqual(clickTargets('Click the "Save" button.'), ["Save"]);
  assert.deepEqual(clickTargets("Tap Add to cart or Buy now"), ["Add"]);
  assert.deepEqual(clickTargets("Observe the heart icon state."), []);
});

test("policy: an allowed save passes only exactly, only signed in, only up to its cap", async () => {
  const { parseAllowedWrites } = await import("../../src/investigation/repro/policy.ts");
  const parsed = parseAllowedWrites(["POST happy-moments-l7fm.vercel.app/api/liked-vendors/save-like", "post https://api.example.com/a/", "GET x.com/y", "POST api.example.com/likes/*"]);
  assert.deepEqual(parsed.writes, [
    { method: "POST", host: "happy-moments-l7fm.vercel.app", path: "/api/liked-vendors/save-like" },
    { method: "POST", host: "api.example.com", path: "/a" },
  ]);
  assert.deepEqual(parsed.invalid, ["GET x.com/y", "POST api.example.com/likes/*"]);
  const p = makePolicy({
    serviceUrl: "https://happymomentsindia.com",
    extraHosts: ["happy-moments-l7fm.vercel.app"],
    loginAuthPaths: [],
    maxTotal: 100,
    maxRps: 5,
    productionReadOnly: true,
    allowedWrites: parsed.writes.slice(0, 1),
    maxAllowedWrites: 2,
  });
  const save = "https://happy-moments-l7fm.vercel.app/api/liked-vendors/save-like";
  const d = (method: string, url: string, signedIn: boolean, done = 0) => decideRequest(p, { method, url, phase: "run", signedIn }, 0, done);
  assert.equal(d("POST", save, true).allow, true);
  assert.match((d("POST", save, false) as { reason: string }).reason, /only sent while the test account is signed in/);
  assert.match((d("POST", save, true, 2) as { reason: string }).reason, /cap of 2 allowed saves/);
  assert.equal(d("PUT", save, true).allow, false, "method must match");
  assert.equal(d("POST", `${save}-all`, true).allow, false, "path must match exactly");
  assert.equal(d("POST", "https://happy-moments-l7fm.vercel.app/api/liked-vendors/remove-like", true).allow, false);
  assert.equal(d("POST", "https://happymomentsindia.com/api/liked-vendors/save-like", true).allow, false, "host must match");
  assert.equal(d("POST", `${save}?customer=1`, true).allow, true, "query string does not change the path");
});

test("connector: listed saves need a test account and the explicit confirmation", async () => {
  const def = (await import("../../src/nexus-admin/connectors/defs/service-under-test.ts")).default;
  const base = { serviceUrl: "https://happymomentsindia.com", environmentName: "production", productionReadOnly: true, loginPath: "/customer-login", testUsername: "t@example.com" };
  const scope = { allowedEnvironments: ["production"] };
  const v = (config: Record<string, unknown>) => def.validate!({ config: { ...base, ...config } as never, scope: scope as never, deployment: "cloud" });
  assert.match(v({ allowedWrites: ["POST happy-moments-l7fm.vercel.app/api/liked-vendors/save-like"] }).allowWritesConfirm ?? "", /Tick this/);
  assert.deepEqual(v({ allowedWrites: ["POST happy-moments-l7fm.vercel.app/api/liked-vendors/save-like"], allowWritesConfirm: true }), {});
  assert.match(v({ allowedWrites: ["DELETE *"], allowWritesConfirm: true }).allowedWrites ?? "", /Not valid/);
  assert.match(v({ testUsername: "", loginPath: "", allowedWrites: ["POST a.example.com/x"], allowWritesConfirm: true }).allowedWrites ?? "", /need a test account/);
});

function wishlistSite() {
  const writes: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const html = (body: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body>${body}</body></html>`);
    };
    if (req.method !== "GET") writes.push(`${req.method} ${url.pathname}`);
    const crash = () => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("A server error has occurred\n\nFUNCTION_INVOCATION_FAILED");
    };
    if (url.pathname === "/login") {
      return html(`<form id="f"><input type="email"><input type="password"><button type="submit">Sign in</button></form><script>
        document.getElementById('f').addEventListener('submit', async (e) => { e.preventDefault();
          await fetch('/auth/v1/token', { method: 'POST', body: 'x' }); localStorage.setItem('in', '1'); location.href = '/category/venues'; });
      </script>`);
    }
    if (url.pathname === "/auth/v1/token") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{}");
    }
    if (url.pathname === "/category/venues") {
      return html(`<header><nav>Login</nav></header><main><h1>Venues</h1><div class="card">Sri Sai Events
        <button id="h"><svg class="lucide lucide-heart" width="10" height="10"></svg></button></div><p id="msg"></p></main><script>
        document.getElementById('h').addEventListener('click', async () => {
          try { const r = await fetch('/api/liked-vendors/save-like', { method: 'POST', headers: {'content-type': 'application/json'}, body: '{"customer_id":1,"vendor_id":2}' }); await r.json(); }
          catch (e) { document.getElementById('msg').textContent = 'Network error: ' + e.message; }
          fetch('/api/liked-vendors/remove-like', { method: 'POST', body: '{}' }).catch(() => {});
        });
      </script>`);
    }
    if (url.pathname === "/liked-vendors") {
      return html(`<main><h1>Liked vendors</h1><div id="out"></div></main><script>
        fetch('/api/liked-vendors/get-liked-vendors/1').then(r => r.json()).catch(e => { document.getElementById('out').textContent = 'Network error: ' + e.message; });
      </script>`);
    }
    if (url.pathname.startsWith("/api/")) return crash();
    res.writeHead(404);
    res.end();
  });
  return new Promise<{ base: string; host: string; writes: string[]; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ base: `http://127.0.0.1:${port}`, host: "127.0.0.1", writes, close: () => { server.closeAllConnections(); server.close(); } });
    }),
  );
}

test("browser: signs in, clicks the heart, sends only the one allowed save, and sees the server error", { timeout: 120_000 }, async () => {
  const site = await wishlistSite();
  try {
    const steps = [`Open ${site.base}/category/venues`, "Click on the Heart / Like icon on the vendor card.", "Open /liked-vendors"];
    const plan = buildReproduction({ ...spec, steps }, site.base, { login: true });
    assert.ok(plan.ok);
    const policy = makePolicy({
      serviceUrl: site.base,
      extraHosts: [],
      loginAuthPaths: ["/auth/v1/token"],
      maxTotal: 100,
      maxRps: 20,
      productionReadOnly: true,
      allowedWrites: [{ method: "POST", host: site.host, path: "/api/liked-vendors/save-like" }],
      maxAllowedWrites: 1,
    });
    const run = await runOnce({ reproduction: plan.ok ? plan.reproduction : null!, policy, login: { path: "/login", username: "t@example.invalid", password: "pw-for-test" }, timeoutMs: 60_000, workDir: workDir(), index: 1 });
    assert.equal(run.login?.ok, true, run.login?.message);
    assert.equal(run.error, null);
    assert.deepEqual(site.writes, ["POST /auth/v1/token", "POST /api/liked-vendors/save-like"], "only sign-in and the one allowed save reached the site");
    assert.deepEqual(run.allowedWrites?.map((w) => [w.method, new URL(w.url).pathname, w.status, w.contentType]), [["POST", "/api/liked-vendors/save-like", 500, "text/plain"]]);
    assert.ok(run.blocked.some((b) => b.kind === "write" && b.url.endsWith("/api/liked-vendors/remove-like")), "an unlisted save stays blocked");
    assert.equal(run.reproduced, true);
    const click = run.assertions.filter((a) => a.page.includes('After clicking "Heart"'));
    assert.ok(click.some((a) => a.showsDefect && a.name === "Data requests complete without a server or network error" && a.actual.includes("/api/liked-vendors/save-like → 500")));
    assert.ok(click.some((a) => a.showsDefect && a.actual.includes("Network error: Unexpected token")));
    assert.ok(run.assertions.some((a) => a.page === "/liked-vendors" && a.showsDefect && a.actual.includes("get-liked-vendors/1 → 500")));
  } finally {
    site.close();
  }
});

test("plan: a 'Label: detail' error also matches its label, so a different detail on the page still counts", () => {
  const out = buildReproduction(spec, "https://happymomentsindia.com", { login: false });
  assert.ok(out.ok);
  if (!out.ok) return;
  assert.ok(out.reproduction.symptomTexts.includes("Network error"));
  const r = judgeRun(out.reproduction, [{ url: "https://happymomentsindia.com/liked-vendors", finalUrl: "", status: 200, pageErrors: [], consoleErrors: [], htmlForData: [], failedData: [], text: "Liked Vendors\nNetwork error - please check your connection", error: null }], { loggedIn: true });
  assert.equal(r.reproduced, true);
});

test("browser: a cross-origin API whose CORS pre-check crashes is caught as a failed data request", { timeout: 90_000 }, async () => {
  // The API on another origin answers every request, including the preflight, with a bare 500.
  const api = http.createServer((_req, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("A server error has occurred\n\nFUNCTION_INVOCATION_FAILED");
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", () => r()));
  const apiBase = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const site = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><body><main><h1>Liked Vendors</h1><p id="out"></p></main><script>
      fetch('${apiBase}/api/liked-vendors/get-liked-vendors/1', { headers: { 'Content-Type': 'application/json' } })
        .then(r => r.json()).catch(() => { document.getElementById('out').textContent = 'Network error - please check your connection'; });
    </script></body></html>`);
  });
  await new Promise<void>((r) => site.listen(0, "localhost", () => r()));
  const base = `http://localhost:${(site.address() as { port: number }).port}`;
  try {
    const plan = buildReproduction({ ...spec, steps: [`Open ${base}/liked-vendors`] }, base, { login: false });
    assert.ok(plan.ok);
    const policy = makePolicy({ serviceUrl: base, extraHosts: ["127.0.0.1"], loginAuthPaths: [], maxTotal: 50, maxRps: 20, productionReadOnly: true });
    const run = await runOnce({ reproduction: plan.ok ? plan.reproduction : null!, policy, login: null, timeoutMs: 45_000, workDir: workDir(), index: 1 });
    assert.equal(run.error, null);
    assert.equal(run.reproduced, true);
    const failed = run.assertions.find((a) => a.name === "Data requests complete without a server or network error");
    assert.ok(failed?.showsDefect, JSON.stringify(run.assertions));
    assert.match(failed!.actual, /get-liked-vendors\/1 → failed in the network/);
    assert.ok(run.assertions.some((a) => a.showsDefect && a.actual === '"Network error" shown'));
  } finally {
    api.closeAllConnections();
    api.close();
    site.closeAllConnections();
    site.close();
  }
});
