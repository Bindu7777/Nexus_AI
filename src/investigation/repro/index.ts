// Reproduce a defect on the service under test: check the target, build the
// plan from the DefectSpec, run it three times, and summarise. Code decides.
import { asList } from "../../nexus-admin/connectors/form";
import type { ConnectorContext } from "../../nexus-admin/connectors/types";
import type { DefectSpec } from "../ticket";
import { runOnce, type LoginConfig, type RunResult } from "./browser";
import { buildReproduction, type Reproduction } from "./plan";
import { makePolicy, targetRefusal } from "./policy";

export type ReproOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "ran";
      target: string;
      mode: "production-read-only" | "staging-read-only";
      loggedIn: boolean;
      reproduction: Reproduction;
      runs: Omit<RunResult, "pages">[];
      reproducedRuns: number;
      totalRuns: number;
      reproduced: boolean;
      flaky: boolean;
      blockedWrites: { method: string; url: string }[];
      blockedHosts: string[];
      summary: string;
    };

export type Runner = typeof runOnce;

export async function reproduceDefect(input: {
  spec: DefectSpec;
  service: ConnectorContext;
  workDir: string;
  runs?: number;
  runner?: Runner;
}): Promise<ReproOutcome> {
  const c = input.service.config;
  const serviceUrl = String(c.serviceUrl ?? "");
  const refusal = targetRefusal(
    { serviceUrl, environmentName: String(c.environmentName ?? ""), productionReadOnly: Boolean(c.productionReadOnly) },
    asList(input.service.scope.allowedEnvironments),
  );
  if (refusal) return { status: "skipped", reason: `Not reproduced: ${refusal}` };
  const login: LoginConfig | null =
    c.testUsername && c.loginPath && input.service.secrets.testPassword
      ? {
          path: String(c.loginPath),
          username: String(c.testUsername),
          password: input.service.secrets.testPassword,
          usernameSelector: String(c.usernameSelector ?? "") || undefined,
          passwordSelector: String(c.passwordSelector ?? "") || undefined,
          submitSelector: String(c.submitSelector ?? "") || undefined,
        }
      : null;
  const plan = buildReproduction(input.spec, serviceUrl, { login: Boolean(login) });
  if (!plan.ok) return { status: "skipped", reason: `Not reproduced: ${plan.reason}` };
  const policy = makePolicy({
    serviceUrl,
    extraHosts: asList(c.extraHosts),
    loginAuthPaths: asList(c.loginAuthPaths),
    maxTotal: Number(c.maxTotal || 300),
    maxRps: Number(c.maxRps || 5),
    productionReadOnly: Boolean(c.productionReadOnly),
  });
  const runner = input.runner ?? runOnce;
  const total = Math.max(1, Math.min(input.runs ?? 3, 5));
  const runs: RunResult[] = [];
  for (let i = 1; i <= total; i += 1) {
    runs.push(await runner({ reproduction: plan.reproduction, policy, login, timeoutMs: Number(c.maxRunSeconds || 60) * 1000, workDir: input.workDir, index: i }));
  }
  const reproducedRuns = runs.filter((r) => r.reproduced).length;
  const blockedWrites = runs.flatMap((r) => r.blocked.filter((b) => b.kind === "write")).map((b) => ({ method: b.method, url: b.url }));
  const blockedHosts = [...new Set(runs.flatMap((r) => r.blocked.filter((b) => b.kind === "host")).map((b) => { try { return new URL(b.url).hostname; } catch { return b.url; } }))];
  const errors = runs.filter((r) => r.error).length;
  const summary =
    reproducedRuns > 0
      ? `Reproduced in ${reproducedRuns} of ${total} runs${reproducedRuns < total ? " (flaky)" : ""}.`
      : errors === total
        ? `Every run failed to complete: ${runs[0].error}`
        : `Not reproduced in ${total} runs.`;
  return {
    status: "ran",
    target: serviceUrl,
    mode: c.productionReadOnly ? "production-read-only" : "staging-read-only",
    loggedIn: runs.some((r) => r.login?.ok),
    reproduction: plan.reproduction,
    runs: runs.map(({ pages: _pages, ...rest }) => {
      void _pages;
      return rest;
    }),
    reproducedRuns,
    totalRuns: total,
    reproduced: reproducedRuns > 0,
    flaky: reproducedRuns > 0 && reproducedRuns < total,
    blockedWrites: blockedWrites.slice(0, 20),
    blockedHosts,
    summary,
  };
}
