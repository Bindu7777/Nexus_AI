// The investigation pipeline. Stages run in a fixed order chosen by this code,
// never by ticket text or a model. Every stage writes a record; a stage that
// cannot run is skipped with a reason and the pipeline continues. Verdicts are
// computed from stage results, never stronger than they support.
import { clip, type Connector, type EvidenceItem } from "../../connectors/types";
import type { GitHubConnector } from "../../connectors/github";
import { redactText, redactValue } from "../nexus-admin/server/redact";
import { rankFindings, runDetectors, type DetectorRun, type RankedFinding } from "./detectors/registry";
import { extractDefectSpec, type DefectSpec, type TicketFull, type TicketRead } from "./ticket";
import type { ReproOutcome } from "./repro";
import { VERDICTS, type DetectorContext, type Verdict } from "./types";

export const STAGES = [
  { id: "understand", title: "Read the defect" },
  { id: "reproduce", title: "Reproduce" },
  { id: "gather", title: "Gather evidence" },
  { id: "locate", title: "Locate the code" },
  { id: "detect", title: "Check the rules" },
  { id: "propose", title: "Propose a fix" },
  { id: "prove", title: "Prove the fix" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

export type SourceHandle = {
  connectorId: number;
  registryId: string;
  category: string;
  name: string;
  status: string;
  connector: Connector | null;
  secretValues: string[];
};

export type LiveLogSource = {
  name: string;
  secretValues: string[];
  tail(options: { maxMs: number; signal?: AbortSignal; since?: number }): Promise<EvidenceItem[]>;
};

/** What the live server logs showed while the reproduction ran. */
export type LiveLogLine = { source: string; status: "ok" | "failed"; lines: number; serverErrors: number; message: string };

export type SourceLine = { name: string; category: string; status: "ok" | "empty" | "failed" | "skipped"; count: number; message: string };

export type Recorder = {
  start(stage: StageId): void;
  finish(stage: StageId, status: Exclude<StageStatus, "pending" | "running">, summary: string, detail?: Record<string, unknown>): void;
  evidence(stage: StageId, items: EvidenceItem[]): void;
};

export type PipelineDeps = {
  readTicket(): Promise<TicketRead>;
  sources: SourceHandle[];
  recorder: Recorder;
  isCancelled(): boolean;
  /** Reproduces the defect on the service under test; absent when none is configured. */
  reproduce?: (spec: DefectSpec) => Promise<ReproOutcome>;
  /** Live server log streams watched while the reproduction runs (for example, Vercel). */
  liveLogs?: LiveLogSource[];
  /** How long to keep watching after the reproduction ends, so late lines arrive. */
  liveLogGraceMs?: number;
  /** Per-source and per-stage time limits, ms. */
  sourceTimeoutMs?: number;
  stageTimeoutMs?: number;
};

export type PipelineResult = {
  verdict: Verdict;
  reason: string;
  spec: DefectSpec | null;
  report: InvestigationReport;
  cancelled: boolean;
};

export type InvestigationReport = {
  verdict: Verdict;
  verdictLabel: string;
  verdictDescription: string;
  reason: string;
  ticket: Pick<TicketFull, "key" | "title" | "url" | "status" | "priority" | "createdAt" | "components" | "labels" | "environment" | "versions"> & {
    links: TicketFull["links"];
    commentCount: number;
    attachments: string[];
  } | null;
  spec: DefectSpec | null;
  missingInformation: string[];
  sources: SourceLine[];
  located: { path: string; startLine: number | null; endLine: number | null; reason: string; ref: string }[];
  findings: RankedFinding[];
  detectors: Pick<DetectorRun, "detectorId" | "name" | "status" | "reason">[];
  couldNotVerify: string[];
  reproduction: ReproOutcome | null;
  liveLogs: LiveLogLine[];
  suggestedFix: null;
  validation: string;
  notDrafted: string[];
};

class Cancelled extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)} seconds.`)), ms);
  });
  // Clear the timer once the work settles, so no stray timer outlives the run.
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/** Short, redacted copy of an evidence item, safe to store and show. */
export function sanitizeEvidence(item: EvidenceItem, secrets: string[]): EvidenceItem {
  return {
    ...item,
    title: redactText(clip(item.title, 300), secrets),
    excerpt: redactText(clip(item.excerpt ?? "", 1500), secrets),
    meta: item.meta ? (redactValue(item.meta, secrets) as Record<string, unknown>) : undefined,
  };
}

/**
 * Words to search the code for, from the requests that failed while
 * reproducing: "/api/liked-vendors/get-liked-vendors/28" →
 * ["get-liked-vendors", "liked-vendors"]. IDs and generic words are dropped.
 */
export function requestSearchTerms(urls: string[]): string[] {
  const generic = new Set(["api", "v1", "v2", "v3", "rest", "graphql", "index", "public", "static"]);
  const out: string[] = [];
  for (const raw of urls) {
    let segments: string[];
    try {
      segments = new URL(raw).pathname.split("/").filter(Boolean);
    } catch {
      continue;
    }
    const named = segments.filter((seg) => /^[a-z][a-z0-9_-]{3,}$/i.test(seg) && !generic.has(seg.toLowerCase()) && !/^[0-9a-f-]{16,}$/i.test(seg));
    // The most specific (last) name first, then its parents.
    for (const seg of named.reverse()) if (!out.includes(seg)) out.push(seg);
  }
  return out.slice(0, 4);
}

/** Page paths named in the steps: URL paths and bare paths such as /liked-vendors. */
export function stepPaths(steps: string[]): string[] {
  const out = new Set<string>();
  for (const step of steps) {
    for (const m of step.matchAll(/https?:\/\/[^\s)"']+/g)) {
      try {
        const p = new URL(m[0].replace(/[.,;]+$/, "")).pathname;
        if (p && p !== "/") out.add(p);
      } catch {
        // not a URL
      }
    }
    for (const m of step.matchAll(/(?:^|[\s(])(\/[a-z][\w\-/]*)/gi)) out.add(m[1].replace(/\/+$/, ""));
  }
  return [...out];
}

const CATEGORY_TITLE: Record<string, string> = { code: "Code", database: "Database", logs: "Logs", docs: "Documentation", tests: "Tests", design: "Design", services: "Service under test", defects: "Defects" };

export async function runPipeline(deps: PipelineDeps): Promise<PipelineResult> {
  // Per-run record of finished stages, so an error lands on the right stage.
  const finished = new Set<StageId>();
  const r: Recorder = {
    start: (s) => deps.recorder.start(s),
    finish: (s, st, sum, d) => {
      if (finished.has(s)) return;
      finished.add(s);
      deps.recorder.finish(s, st, sum, d);
    },
    evidence: (s, items) => deps.recorder.evidence(s, items),
  };
  const sourceMs = deps.sourceTimeoutMs ?? 20_000;
  const stageMs = deps.stageTimeoutMs ?? 90_000;
  const evidence: EvidenceItem[] = [];
  const sourceLines: SourceLine[] = [];
  const couldNotVerify: string[] = [];
  const notDrafted: string[] = [];
  let ticket: TicketFull | null = null;
  let spec: DefectSpec | null = null;
  let missing: string[] = [];
  const located: InvestigationReport["located"] = [];
  let ranked: RankedFinding[] = [];
  let detectorRuns: DetectorRun[] = [];
  let repro: ReproOutcome | null = null;
  const liveLogLines: LiveLogLine[] = [];
  const checkCancel = () => {
    if (deps.isCancelled()) throw new Cancelled();
  };
  const skipRest = (from: StageId, why: string) => {
    const at = STAGES.findIndex((s) => s.id === from);
    for (const s of STAGES.slice(at)) r.finish(s.id, "skipped", why);
  };
  const build = (verdict: Verdict, reason: string): PipelineResult => ({
    verdict,
    reason,
    spec,
    cancelled: false,
    report: {
      verdict,
      verdictLabel: VERDICTS[verdict].label,
      verdictDescription: VERDICTS[verdict].description,
      reason,
      ticket: ticket
        ? {
            key: ticket.key,
            title: ticket.title,
            url: ticket.url,
            status: ticket.status,
            priority: ticket.priority,
            createdAt: ticket.createdAt,
            components: ticket.components,
            labels: ticket.labels,
            environment: ticket.environment,
            versions: ticket.versions,
            links: ticket.links,
            commentCount: ticket.comments.length,
            attachments: ticket.attachments,
          }
        : null,
      spec,
      missingInformation: missing,
      sources: sourceLines,
      located,
      findings: ranked,
      detectors: detectorRuns.map(({ detectorId, name, status, reason: why }) => ({ detectorId, name, status, reason: why })),
      couldNotVerify,
      reproduction: repro,
      liveLogs: liveLogLines,
      suggestedFix: null,
      validation: "Not validated yet.",
      notDrafted,
    },
  });

  try {
    // 1. Understand
    r.start("understand");
    const read = await withTimeout(deps.readTicket(), stageMs, "Reading the ticket");
    if (!read.ok) {
      r.finish("understand", "failed", read.message);
      skipRest("reproduce", "Stopped: the ticket could not be read.");
      return build("failed", `The ticket could not be read: ${read.message}`);
    }
    ticket = read.ticket;
    const ticketItem: EvidenceItem = {
      source: ticket.source === "jira" ? "Jira" : "GitHub Issues",
      kind: "tickets",
      ref: `ticket:${ticket.source}:${ticket.key}`,
      timestamp: ticket.updatedAt ?? ticket.createdAt,
      retrievedAt: new Date().toISOString(),
      title: `${ticket.key} ${ticket.title}`,
      excerpt: clip(ticket.description, 1500),
      observation: "observed",
      location: ticket.url ? { url: ticket.url } : undefined,
      meta: { status: ticket.status, comments: ticket.comments.length, trust: "untrusted-input" },
    };
    evidence.push(ticketItem);
    r.evidence("understand", [ticketItem]);
    const specResult = extractDefectSpec(ticket);
    spec = specResult.ok ? specResult.spec : specResult.partial;
    if (!specResult.ok) {
      missing = specResult.missing;
      r.finish("understand", "done", `Read ${ticket.key}. The ticket is missing ${missing.length} thing${missing.length === 1 ? "" : "s"} needed to investigate.`, { missing, spec });
      skipRest("reproduce", "Stopped: the ticket needs more information first.");
      return build("needs_more_information", `${ticket.key} does not say enough to investigate yet. Add the items listed and run it again.`);
    }
    notDrafted.push("Defect summary was built by fixed rules from the ticket text; no model was used.");
    r.finish("understand", "done", `Read ${ticket.key}: ${spec.steps.length} step${spec.steps.length === 1 ? "" : "s"}, expected and actual behaviour found.`, { spec });
    checkCancel();

    // 2. Reproduce
    r.start("reproduce");
    if (!deps.reproduce) {
      const why = "Not reproduced: no service under test is configured for this company. An admin can add the website under Connection health.";
      r.finish("reproduce", "skipped", why);
      couldNotVerify.push(why);
    } else {
      // Watch the live server logs for the whole reproduction, then a little longer.
      const watchers = (deps.liveLogs ?? []).map((src) => {
        const stopper = new AbortController();
        const lines = src.tail({ maxMs: 15 * 60_000, signal: stopper.signal, since: Date.now() });
        lines.catch(() => undefined);
        return { src, stopper, lines };
      });
      const stopWatching = async (): Promise<EvidenceItem[]> => {
        if (!watchers.length) return [];
        await new Promise((res) => setTimeout(res, deps.liveLogGraceMs ?? 3000));
        const out: EvidenceItem[] = [];
        for (const w of watchers) {
          w.stopper.abort();
          try {
            const got = (await withTimeout(w.lines, 15_000, `${w.src.name} live logs`)).map((e) => sanitizeEvidence({ ...e, source: w.src.name }, w.src.secretValues));
            const serverErrors = got.filter((e) => Number(e.meta?.status) >= 500 || e.meta?.level === "error").length;
            liveLogLines.push({
              source: w.src.name,
              status: "ok",
              lines: got.length,
              serverErrors,
              message: got.length
                ? `${got.length} server log line${got.length === 1 ? "" : "s"} while the reproduction ran${serverErrors ? `, ${serverErrors} of them errors` : ", no server errors"}.`
                : "No server log lines arrived while the reproduction ran. The pages may be served as static files that write no runtime logs.",
            });
            out.push(...got);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            liveLogLines.push({ source: w.src.name, status: "failed", lines: 0, serverErrors: 0, message: redactText(message, w.src.secretValues) });
            couldNotVerify.push(`${w.src.name}: live server logs could not be read during the reproduction.`);
          }
        }
        return out;
      };
      try {
        repro = await withTimeout(deps.reproduce(spec), Math.max(stageMs, 600_000), "Reproduction");
      } finally {
        const live = repro?.status === "ran" ? await stopWatching() : (watchers.forEach((w) => w.stopper.abort()), []);
        if (live.length) {
          evidence.push(...live);
          r.evidence("reproduce", live);
        }
      }
      if (repro.status === "skipped") {
        r.finish("reproduce", "skipped", repro.reason, { reproduction: repro });
        couldNotVerify.push(repro.reason);
      } else {
        const ran = repro;
        const items: EvidenceItem[] = ran.runs.map((run) => ({
          source: "Reproduction",
          kind: "sandbox",
          ref: `repro:run:${run.index}`,
          timestamp: new Date().toISOString(),
          retrievedAt: new Date().toISOString(),
          title: `Run ${run.index} on ${new URL(ran.target).hostname}: ${run.error ? `did not complete (${run.error})` : run.reproduced ? "the defect showed up" : "the defect did not show up"}`,
          excerpt: clip(
            run.assertions.map((a) => `${a.showsDefect ? "✗" : a.passed ? "✓" : "·"} ${a.page} · ${a.name}: expected ${a.expected}, actual ${a.actual}`).join("\n"),
            1500,
          ),
          observation: "observed",
          location: run.screenshot ? { path: run.screenshot } : undefined,
          meta: { requestsSent: run.requestsSent, blocked: run.blocked.length, durationMs: run.durationMs },
        }));
        evidence.push(...items);
        r.evidence("reproduce", items);
        // The full reproduction goes in the report; the stage keeps a short summary.
        r.finish("reproduce", "done", repro.summary, {
          reproduced: repro.reproduced,
          reproducedRuns: repro.reproducedRuns,
          totalRuns: repro.totalRuns,
          inconclusive: repro.inconclusive,
          needsSignIn: repro.needsSignIn,
          liveLogs: liveLogLines,
        });
        if (repro.inconclusive) couldNotVerify.push(`${repro.needsSignIn.join(", ")} need${repro.needsSignIn.length === 1 ? "s" : ""} a signed-in customer and could not be checked. An admin can save the test account's password under the service under test.`);
        if (!repro.loggedIn && repro.reproduction.steps.some((s) => s.kind === "login")) couldNotVerify.push("The test account could not sign in, so pages that need a signed-in customer were seen as a visitor.");
        if (!repro.reproduction.steps.some((s) => s.kind === "login")) couldNotVerify.push("No test account is configured, so the reproduction ran as an anonymous visitor.");
        if (repro.blockedHosts.length) couldNotVerify.push(`Requests to ${repro.blockedHosts.join(", ")} were blocked because those hosts are not allowed. An admin can add them under the service under test.`);
        if (repro.blockedWrites.length) couldNotVerify.push(`${repro.blockedWrites.length} request${repro.blockedWrites.length === 1 ? "" : "s"} that would have saved data were blocked (read-only). Steps that save data cannot be reproduced here.`);
      }
    }
    checkCancel();

    // 3. Gather
    r.start("gather");
    const fromIso = spec.window?.from;
    const terms = spec.searchTerms.slice(0, 4);
    // The requests that actually failed while reproducing are the best lead into the code.
    const reproTerms = repro?.status === "ran" && repro.reproduced ? requestSearchTerms((repro.failingRequests ?? []).map((f) => f.url)) : [];
    const gatherOne = async (s: SourceHandle): Promise<EvidenceItem[]> => {
      const c = s.connector;
      if (!c) throw new Error("This connector could not be prepared.");
      const found: EvidenceItem[] = [];
      if (s.category === "code") {
        const gh = c as Partial<GitHubConnector>;
        if (typeof gh.listCommits === "function" && Array.isArray(gh.repos)) {
          for (const repo of gh.repos.slice(0, 3)) {
            found.push(...(await gh.listCommits(`${repo.owner}/${repo.repo}`, { since: fromIso, limit: 10 })));
          }
        }
        for (const t of reproTerms.slice(0, 3)) {
          try {
            found.push(...(await c.search({ text: t, limit: 5 })).map((e) => ({ ...e, meta: { ...e.meta, matchedTerm: t, matchedFrom: "reproduction" } })));
          } catch (error) {
            if (!found.length) throw error;
          }
        }
        for (const t of terms.slice(0, 3)) {
          try {
            found.push(...(await c.search({ text: t, limit: 5 })).map((e) => ({ ...e, meta: { ...e.meta, matchedTerm: t } })));
          } catch (error) {
            if (!found.length) throw error;
          }
        }
      } else if (s.category === "logs") {
        // Server logs record request paths, not the browser's error text, so also
        // look for the pages the ticket's steps name.
        for (const t of [...spec!.errorMessages.slice(0, 2), ...stepPaths(spec!.steps).slice(0, 3), ...terms.slice(0, 2)]) {
          found.push(...(await c.search({ text: t, since: fromIso, limit: 10 })));
        }
      } else {
        for (const t of terms.slice(0, 3)) found.push(...(await c.search({ text: t, limit: 5 })));
      }
      const seen = new Set<string>();
      return found.filter((e) => (seen.has(e.ref) ? false : (seen.add(e.ref), true))).slice(0, 25);
    };
    const gatherable = deps.sources.filter((s) => s.category !== "defects");
    for (const cat of ["code", "database", "logs", "docs"]) {
      if (!deps.sources.some((s) => s.category === cat)) {
        sourceLines.push({ name: CATEGORY_TITLE[cat], category: cat, status: "skipped", count: 0, message: "Not connected for this company." });
        couldNotVerify.push(`${CATEGORY_TITLE[cat]}: not connected, so nothing was read from it.`);
      }
    }
    for (const s of gatherable) {
      checkCancel();
      if (s.category === "services" || s.category === "tests" || s.category === "design") {
        const message =
          s.category === "services"
            ? deps.reproduce
              ? "Used by the Reproduce step (see above), not searched for evidence."
              : "Not used: reproduction is not available for this company."
            : "Not read in this build.";
        sourceLines.push({ name: s.name, category: s.category, status: "skipped", count: 0, message });
        continue;
      }
      try {
        const items = (await withTimeout(gatherOne(s), sourceMs, s.name)).map((e) => sanitizeEvidence({ ...e, source: s.name }, s.secretValues));
        evidence.push(...items);
        r.evidence("gather", items);
        sourceLines.push({
          name: s.name,
          category: s.category,
          status: items.length ? "ok" : "empty",
          count: items.length,
          message: items.length ? `${items.length} item${items.length === 1 ? "" : "s"} read.` : "Nothing matched this ticket.",
        });
        if (s.status === "failing") couldNotVerify.push(`${s.name} was failing its health check before this run; its evidence may be incomplete.`);
      } catch (error) {
        const msg = redactText(error instanceof Error ? error.message : String(error), s.secretValues).slice(0, 300);
        sourceLines.push({ name: s.name, category: s.category, status: "failed", count: 0, message: msg });
        couldNotVerify.push(`${s.name} could not be read: ${msg}`);
      }
    }
    const got = sourceLines.filter((l) => l.status === "ok").reduce((n, l) => n + l.count, 0);
    r.finish("gather", "done", `${got} evidence item${got === 1 ? "" : "s"} from ${sourceLines.filter((l) => l.status === "ok").length} source${sourceLines.filter((l) => l.status === "ok").length === 1 ? "" : "s"}.`, { sources: sourceLines });
    checkCancel();

    // 4. Locate
    r.start("locate");
    for (const e of evidence) {
      const p = e.location?.path;
      if (!p || e.kind !== "code" || located.some((l) => l.path === p)) continue;
      const term = typeof e.meta?.matchedTerm === "string" ? e.meta.matchedTerm : null;
      located.push({
        path: p,
        startLine: e.location?.startLine ?? null,
        endLine: e.location?.endLine ?? null,
        reason: term
          ? e.meta?.matchedFrom === "reproduction"
            ? `Code search matched "${term}", from the request that failed while reproducing.`
            : `Code search matched "${term}" from the ticket.`
          : "Named in the ticket.",
        ref: e.ref,
      });
      if (located.length >= 10) break;
    }
    if (located.length) {
      r.finish("locate", "done", `${located.length} code location${located.length === 1 ? "" : "s"} tied to the defect by search.`, { located });
    } else {
      const msg = "No code location could be tied to the ticket from the evidence read.";
      r.finish("locate", "skipped", msg);
      couldNotVerify.push(msg);
    }
    checkCancel();

    // 5. Detect
    r.start("detect");
    const ctx: DetectorContext = {
      investigationId: ticket.key,
      evidence,
      reproduction:
        repro?.status === "ran"
          ? {
              runs: repro.totalRuns,
              passes: repro.reproducedRuns,
              reproduced: repro.reproduced,
              assertions: repro.runs.flatMap((x) => x.assertions.filter((a) => a.showsDefect).map((a) => ({ name: `${a.page} · ${a.name}`, expected: a.expected, actual: a.actual, passed: a.passed }))),
              scriptRef: "repro:plan",
            }
          : undefined,
      firstReportedAt: spec.firstReportedAt ?? undefined,
      located: located.filter((l) => l.startLine != null).map((l) => ({ path: l.path, startLine: l.startLine!, endLine: l.endLine ?? l.startLine!, reason: l.reason })),
    };
    detectorRuns = runDetectors(ctx);
    ranked = rankFindings(detectorRuns);
    const ran = detectorRuns.filter((d) => d.status === "ran");
    const causes = ranked.filter((f) => f.kind === "cause");
    r.finish(
      "detect",
      "done",
      causes.length
        ? `${causes.length} cause${causes.length === 1 ? "" : "s"} found by ${[...new Set(causes.map((c) => c.detectorId))].join(", ")}.`
        : `${ran.length} of ${detectorRuns.filter((d) => d.status !== "placeholder").length} detectors had the evidence they need; none found a cause.`,
      { detectors: detectorRuns.map(({ detectorId, status, reason: why }) => ({ detectorId, status, reason: why })) },
    );
    for (const d of detectorRuns.filter((x) => x.status === "skipped")) couldNotVerify.push(`${d.name} did not run. ${d.reason ?? ""}`.trim());
    checkCancel();

    // 6. Propose and 7. Prove
    if (causes.length) {
      r.finish("propose", "skipped", "No model endpoint is configured to draft a patch for this company.");
      notDrafted.push("Suggested fix: not drafted, because no model endpoint is configured.");
    } else {
      r.finish("propose", "skipped", "No cause was found, so no fix is suggested.");
    }
    r.finish("prove", "skipped", "Runs only after a suggested fix is approved.");

    if (causes.length) {
      const top = causes[0];
      const tie = top.tiedWith.length ? ` It is tied with ${top.tiedWith.join(", ")}.` : "";
      return build("diagnosed", `${top.cause}.${tie} No fix has been proven yet.`);
    }
    if (repro?.status === "ran" && repro.inconclusive) {
      return build("not_enough_evidence", `${repro.summary} Static evidence is shown, with what could not be verified.`);
    }
    if (repro?.status === "ran" && !repro.reproduced) {
      return build("not_reproduced", `${repro.summary} Static evidence is shown, with what could not be verified.`);
    }
    const pieces = evidence.length;
    const runnable = detectorRuns.filter((d) => d.status === "ran").length;
    return build(
      "not_enough_evidence",
      repro?.status === "ran" && repro.reproduced
        ? `${repro.summary} The defect is real, but no detector names its cause yet.`
        : runnable
        ? `Read ${pieces} piece${pieces === 1 ? "" : "s"} of evidence, but none of the ${runnable} detector${runnable === 1 ? "" : "s"} that could run found a cause.`
        : `Read ${pieces} piece${pieces === 1 ? "" : "s"} of evidence, but none of Nexus's detectors had the inputs they need for this defect, so no cause is claimed.`,
    );
  } catch (error) {
    if (error instanceof Cancelled) {
      const at = STAGES.find((s) => !finished.has(s.id));
      if (at) skipRest(at.id, "Cancelled.");
      const res = build("failed", "Cancelled by the user.");
      return { ...res, cancelled: true };
    }
    const msg = error instanceof Error ? error.message : String(error);
    const at = STAGES.find((s) => !finished.has(s.id));
    if (at) {
      r.finish(at.id, "failed", msg.slice(0, 300));
      const next = STAGES[STAGES.findIndex((s) => s.id === at.id) + 1];
      if (next) skipRest(next.id, "Stopped after an earlier stage failed.");
    }
    return build("failed", `The ${at?.title.toLowerCase() ?? "investigation"} stage failed: ${msg.slice(0, 300)}`);
  }
}
