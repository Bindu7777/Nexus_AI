// Browser runner. Runs a declarative Reproduction in a fresh headless Chromium
// (its own sandboxed process). Every request passes the policy; the whole run
// is killed at its time limit. No script from a ticket or model is executed:
// only the fixed steps in the Reproduction.
import fs from "node:fs";
import path from "node:path";
import { judgeRun, type Assertion, type PageObservation } from "./judge";
import type { Reproduction } from "./plan";
import { decideRequest, type ReproPolicy } from "./policy";

export type LoginConfig = { path: string; username: string; password: string; usernameSelector?: string; passwordSelector?: string; submitSelector?: string };

export type RunResult = {
  index: number;
  reproduced: boolean;
  assertions: Assertion[];
  /** Pages that showed a sign-in prompt instead of their content (run not signed in). */
  needsSignIn?: string[];
  pages: PageObservation[];
  blocked: { method: string; url: string; reason: string; kind: string }[];
  requestsSent: number;
  login: { attempted: boolean; ok: boolean; message: string } | null;
  screenshot: string | null;
  timedOut: boolean;
  error: string | null;
  durationMs: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runOnce(input: {
  reproduction: Reproduction;
  policy: ReproPolicy;
  login: LoginConfig | null;
  timeoutMs: number;
  workDir: string;
  index: number;
}): Promise<RunResult> {
  const started = Date.now();
  const { chromium } = await import("playwright");
  const blocked: RunResult["blocked"] = [];
  const pages: PageObservation[] = [];
  let sent = 0;
  let phase: "login" | "run" = "run";
  const stamps: number[] = [];
  let loginResult: RunResult["login"] = null;
  let screenshot: string | null = null;
  let timedOut = false;
  let error: string | null = null;

  // A browser server exposes its OS process, so a run that overruns can be killed outright.
  const server = await chromium.launchServer({ headless: true });
  const browser = await chromium.connect(server.wsEndpoint());
  const killer = setTimeout(() => {
    timedOut = true;
    try {
      server.process().kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, input.timeoutMs);

  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1280, height: 800 } });
    await context.route("**/*", async (route) => {
      const req = route.request();
      const decision = decideRequest(input.policy, { method: req.method(), url: req.url(), phase }, sent);
      if (!decision.allow) {
        if (blocked.length < 200) blocked.push({ method: req.method(), url: req.url().slice(0, 300), reason: decision.reason, kind: decision.kind });
        return route.abort("blockedbyclient").catch(() => undefined);
      }
      // Rate cap: at most maxRps requests in any one-second window.
      for (;;) {
        const now = Date.now();
        while (stamps.length && now - stamps[0] > 1000) stamps.shift();
        if (stamps.length < input.policy.maxRps) break;
        await sleep(1000 - (now - stamps[0]) + 5);
      }
      stamps.push(Date.now());
      sent += 1;
      return route.continue().catch(() => undefined);
    });
    const page = await context.newPage();
    let current: PageObservation | null = null;
    page.on("pageerror", (e) => current?.pageErrors.push(String(e.message).slice(0, 500)));
    page.on("console", (m) => {
      if (m.type() === "error") current?.consoleErrors.push(m.text().slice(0, 500));
    });
    page.on("response", (r) => {
      const type = r.request().resourceType();
      if (!current || (type !== "fetch" && type !== "xhr")) return;
      const ct = (r.headers()["content-type"] ?? "").toLowerCase();
      if (ct.includes("text/html")) current.htmlForData.push({ url: r.url().slice(0, 300), status: r.status(), contentType: ct.split(";")[0] });
      if (r.status() >= 400) current.failedData.push({ url: r.url().slice(0, 300), status: r.status() });
    });
    const navTimeout = Math.min(30_000, input.timeoutMs);

    for (const step of input.reproduction.steps) {
      if (timedOut) break;
      if (step.kind === "login") {
        if (!input.login) continue;
        phase = "login";
        try {
          await page.goto(new URL(input.login.path, input.policy.origin).toString(), { waitUntil: "domcontentloaded", timeout: navTimeout });
          await page.fill(input.login.usernameSelector || "input[type=email], input[name=email], input[name=username]", input.login.username, { timeout: 10_000 });
          await page.fill(input.login.passwordSelector || "input[type=password]", input.login.password, { timeout: 10_000 });
          await page.click(input.login.submitSelector || "button[type=submit]", { timeout: 10_000 });
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
          await sleep(1500);
          const stillThere = new URL(page.url()).pathname === input.login.path;
          loginResult = { attempted: true, ok: !stillThere, message: stillThere ? "Still on the sign-in page after submitting: the test account could not sign in." : "Signed in with the test account." };
        } catch (e) {
          loginResult = { attempted: true, ok: false, message: `Sign-in step failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` };
        }
        phase = "run";
        continue;
      }
      const obs: PageObservation = { url: step.url, finalUrl: step.url, status: null, pageErrors: [], consoleErrors: [], htmlForData: [], failedData: [], text: "", error: null };
      current = obs;
      pages.push(obs);
      try {
        const resp = await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: navTimeout });
        obs.status = resp?.status() ?? null;
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
        await sleep(1500);
        obs.finalUrl = page.url();
        obs.text = (await page.innerText("body", { timeout: 5000 }).catch(() => "")).replace(/\s+\n/g, "\n").slice(0, 20_000);
        const shape = await page
          .evaluate(() => {
            const body = document.body.cloneNode(true) as HTMLElement;
            body.querySelectorAll("header, nav, footer, [role=banner], [role=navigation], [role=contentinfo], script, style").forEach((n) => n.remove());
            return { mainText: (body.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 2000), hasPasswordField: !!document.querySelector("input[type=password]") };
          })
          .catch(() => null);
        if (shape) Object.assign(obs, shape);
      } catch (e) {
        obs.error = timedOut ? "The run reached its time limit." : (e instanceof Error ? e.message.split("\n")[0] : String(e)).slice(0, 300);
      }
    }
    if (!timedOut) {
      fs.mkdirSync(input.workDir, { recursive: true, mode: 0o700 });
      const file = path.join(input.workDir, `run-${input.index}.png`);
      await page.screenshot({ path: file, timeout: 8000 }).then(() => (screenshot = path.basename(file))).catch(() => undefined);
    }
  } catch (e) {
    error = timedOut ? "The run reached its time limit and was stopped." : (e instanceof Error ? e.message.split("\n")[0] : String(e)).slice(0, 300);
  } finally {
    clearTimeout(killer);
    await browser.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
  if (timedOut && !error) error = "The run reached its time limit and was stopped.";
  const verdict = judgeRun(input.reproduction, pages, { loggedIn: !!loginResult?.ok });
  return {
    index: input.index,
    reproduced: !timedOut && !error && verdict.reproduced,
    assertions: verdict.assertions,
    needsSignIn: verdict.needsSignIn,
    pages,
    blocked,
    requestsSent: sent,
    login: loginResult,
    screenshot,
    timedOut,
    error,
    durationMs: Date.now() - started,
  };
}
