// A stand-in for the IDE agent: fulfils Nexus's evidence requests from a
// local JSON fixture instead of real Jira, GitHub or database tools, so the
// whole protocol can be run and tested offline.
//
// Like a real agent, it only calls nexus_start_investigation and
// nexus_submit_evidence. It never calls nexus_approve.
import fs from "node:fs";
import type { EvidenceRequest } from "./requests";

export type FixtureEntry = { tool?: string; output: unknown } | { unavailable: string };

export type Fixture = {
  ticketRef: string;
  capabilities?: string[];
  repos?: string[];
  /**
   * Keyed by request kind ("ticket", "commits", "code_search", "docs", ...),
   * or "file:<path>" for a file. A list is consumed one entry per request of
   * that kind, so a fixture can send a bad result first and a good one after.
   */
  results: Record<string, FixtureEntry | FixtureEntry[]>;
};

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function loadFixture(file: string): Fixture {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Fixture;
}

type Step = { status: string; investigationId?: string; requests?: EvidenceRequest[]; rejected?: { id: string; error: string }[]; [k: string]: unknown };

export async function runFixtureAgent(call: CallTool, fixture: Fixture, options: { maxCalls?: number; log?: (line: string) => void } = {}) {
  const log = options.log ?? (() => undefined);
  const used = new Map<string, number>();
  const take = (key: string): FixtureEntry | null => {
    const v = fixture.results[key];
    if (!v) return null;
    if (!Array.isArray(v)) return v;
    const i = used.get(key) ?? 0;
    used.set(key, i + 1);
    return v[Math.min(i, v.length - 1)] ?? null;
  };
  const transcript: { tool: string; args: Record<string, unknown>; result: Step }[] = [];
  const invoke = async (tool: string, args: Record<string, unknown>) => {
    const result = (await call(tool, args)) as Step;
    transcript.push({ tool, args, result });
    return result;
  };
  let step = await invoke("nexus_start_investigation", { ticketRef: fixture.ticketRef, capabilities: fixture.capabilities, repos: fixture.repos });
  const id = step.investigationId;
  let calls = 1;
  while (step.status === "needs_evidence" && id && calls < (options.maxCalls ?? 12)) {
    const results = (step.requests ?? []).map((req) => {
      const entry = (req.kind === "file" ? take(`file:${req.path}`) : null) ?? take(req.kind);
      if (!entry) return { id: req.id, status: "unavailable", reason: `The fixture has no ${req.kind} result.` };
      if ("unavailable" in entry) return { id: req.id, status: "unavailable", reason: entry.unavailable };
      return { id: req.id, status: "ok", tool: entry.tool ?? "fixture", output: entry.output };
    });
    for (const r of results) log(`  ${r.id}: ${r.status}`);
    step = await invoke("nexus_submit_evidence", { investigationId: id, results });
    for (const r of step.rejected ?? []) log(`  rejected ${r.id}: ${r.error}`);
    calls += 1;
  }
  return { final: step, transcript, investigationId: id };
}
