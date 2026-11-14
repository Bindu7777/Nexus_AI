// The IDE-mode investigation: a state machine driven by evidence rounds.
//
// Code decides every request and what each result means. The IDE agent only
// fetches with the engineer's own tools and hands back raw output. The next
// request always comes from this file, never from evidence content; parsers
// produce evidence only. Reproduction and proof run in Nexus's own sandbox.
//
// Stages are the reproduce-first pipeline's (understand, reproduce, gather,
// locate, detect, propose, prove) and its detectors, verdicts and DefectSpec
// rules are reused unchanged.
import { randomUUID } from "node:crypto";
import * as z from "zod";
import { provenanceOf, type EvidenceItem, type Provenance } from "../../connectors/types";
import { rankFindings, runDetectors, type DetectorRun, type RankedFinding } from "../investigation/detectors/registry";
import { STAGES, type StageId } from "../investigation/pipeline";
import { extractDefectSpec, type DefectSpec, type TicketFull } from "../investigation/ticket";
import { VERDICTS, type DetectorContext, type LoadMeasurements, type Verdict } from "../investigation/types";
import type { EngineTicket } from "../lib/types";
import { parseResult, type TicketExtra } from "./parsers";
import { EVIDENCE_REQUEST_KINDS, InvalidRequestValue, isRepo, isTicketKey, LIMITS, request, type EvidenceRequest, type EvidenceRequestKind } from "./requests";
import { isDemoKey, SEEDED_TICKET, type Sandbox, type SandboxSnapshot } from "./sandbox-demo";
import type { Caller, IdeStore } from "./store";

// ---------- state ----------

type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type StageRecord = { id: StageId; title: string; status: StageStatus; summary: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null };

export type RequestRecord = {
  request: EvidenceRequest;
  status: "pending" | "ok" | "unavailable" | "rejected" | "dropped";
  attempts: number;
  summary: string;
  tool: string | null;
  rawSha256: string | null;
};

export type Phase = "awaiting_evidence" | "awaiting_approval" | "done" | "cancelled";

export type IdeState = {
  version: 1;
  id: string;
  ticketKey: string;
  createdAt: string;
  phase: Phase;
  round: number;
  /** Evidence kinds the IDE agent said it can supply; null means it did not say. */
  capabilities: EvidenceRequestKind[] | null;
  repos: string[];
  stages: StageRecord[];
  requests: RequestRecord[];
  evidence: EvidenceItem[];
  bytes: number;
  ticket: TicketFull | null;
  ticketExtra: TicketExtra | null;
  spec: DefectSpec | null;
  missing: string[];
  located: { path: string; repo: string | null; startLine: number | null; endLine: number | null; reason: string; ref: string }[];
  findings: RankedFinding[];
  detectors: Pick<DetectorRun, "detectorId" | "name" | "status" | "reason">[];
  couldNotVerify: string[];
  demo: { scenario: string | null; snapshot: SandboxSnapshot | null; engineAsk: string | null } | null;
  verdict: Verdict | null;
  reason: string | null;
  approval: { status: "not_applicable" | "awaiting" | "approved" | "rejected"; at: string | null; reason: string | null };
  validation: { status: "not_validated" | "validated" | "inconclusive" | "failed"; statement: string; before: unknown; after: unknown; checks: unknown[] };
  lastSubmissionAt: number | null;
};

// ---------- views ----------

export type EvidenceView = {
  ref: string;
  kind: string;
  title: string;
  excerpt: string;
  observation: "observed" | "inferred";
  provenance: Provenance;
  timestamp: string | null;
  location: EvidenceItem["location"] | null;
  reportedTool: string | null;
  rawSha256: string | null;
};

export type IdeReport = {
  investigationId: string;
  ticketKey: string;
  generatedAt: string;
  verdict: Verdict;
  verdictLabel: string;
  verdictDescription: string;
  reason: string;
  sourcesUsed: string[];
  ticket: Pick<TicketFull, "key" | "title" | "url" | "status" | "priority" | "createdAt" | "labels"> | null;
  spec: DefectSpec | null;
  missingInformation: string[];
  causes: (Pick<RankedFinding, "rank" | "detectorId" | "cause" | "score" | "threshold" | "kind" | "rule" | "facts"> & { evidence: EvidenceView[]; restsOnlyOnClientEvidence: boolean })[];
  evidence: EvidenceView[];
  located: IdeState["located"];
  detectors: IdeState["detectors"];
  couldNotVerify: string[];
  whatWouldHelp: string[];
  gaps: { requestId: string; kind: string; required: boolean; reason: string }[];
  suggestedFix: { title: string; summary: string; change: string; boundary: string; diff: string | null } | null;
  validation: IdeState["validation"];
  approval: IdeState["approval"];
  provenanceNote: string | null;
  timeline: StageRecord[];
  readOnlyNote: string;
};

export type Progress = {
  investigationId: string;
  ticketKey: string;
  phase: Phase;
  round: number;
  maxRounds: number;
  stages: StageRecord[];
  sources: { requestId: string; kind: string; status: RequestRecord["status"]; line: string }[];
};

export type StepResult =
  | { status: "needs_evidence"; investigationId: string; round: number; requests: EvidenceRequest[]; rejected: { id: string; error: string }[]; progress: Progress; instructions: string }
  | { status: "awaiting_approval" | "done" | "cancelled"; investigationId: string; report: IdeReport; progress: Progress; rejected: { id: string; error: string }[] };

export class IdeError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "invalid" | "conflict" | "too_large" | "denied",
  ) {
    super(message);
  }
}

// ---------- deps ----------

export type IdeDeps = {
  store: IdeStore;
  /** Nexus's own sandbox for the seeded demo company; null when this install has none. */
  sandbox: Sandbox | null;
  now?: () => Date;
  /** Minimum time between an evidence submission and an approval for the same investigation. */
  approvalGapMs?: number;
  /** MCP client names allowed to approve (the Nexus extension). Empty allows any client, for tests only. */
  approverClients?: string[];
};

const AGENT_STEPS =
  "Fulfil each request with your connected tools and call nexus_submit_evidence with the raw, unmodified output for each request id. If you cannot fulfil one, submit { id, status: \"unavailable\", reason }. Do not summarise, filter or interpret. Do not add a diagnosis of your own. Never call nexus_approve: approval is the engineer's action in the Nexus extension.";

const READ_ONLY = "Nexus is read-only toward your repository and tools. It never commits, pushes, opens pull requests, or writes to Jira, a database or docs. Fixes are patches you apply yourself.";

// ---------- helpers ----------

const nowIso = (d: IdeDeps) => (d.now?.() ?? new Date()).toISOString();

function stage(state: IdeState, id: StageId) {
  return state.stages.find((s) => s.id === id)!;
}
function startStage(deps: IdeDeps, state: IdeState, id: StageId) {
  const s = stage(state, id);
  if (s.status === "pending") {
    s.status = "running";
    s.startedAt = nowIso(deps);
  }
}
function finishStage(deps: IdeDeps, state: IdeState, id: StageId, status: Exclude<StageStatus, "pending" | "running">, summary: string) {
  const s = stage(state, id);
  if (s.status === "done" || s.status === "skipped" || s.status === "failed") return;
  const at = nowIso(deps);
  s.startedAt ??= at;
  s.finishedAt = at;
  s.durationMs = Date.parse(at) - Date.parse(s.startedAt);
  s.status = status;
  s.summary = summary;
}
function skipFrom(deps: IdeDeps, state: IdeState, from: StageId, why: string) {
  const at = STAGES.findIndex((s) => s.id === from);
  for (const s of STAGES.slice(at)) finishStage(deps, state, s.id, "skipped", why);
}

const can = (state: IdeState, kind: EvidenceRequestKind) => !state.capabilities || state.capabilities.includes(kind);

function addEvidence(state: IdeState, items: EvidenceItem[]) {
  for (const e of items) {
    const size = Buffer.byteLength(e.excerpt, "utf8") + 512;
    if (state.bytes + size > LIMITS.maxTotalBytes) {
      state.couldNotVerify.push("Some evidence was not stored because the investigation reached its size limit.");
      return;
    }
    state.bytes += size;
    state.evidence.push(e);
  }
}

function view(e: EvidenceItem): EvidenceView {
  return {
    ref: e.ref,
    kind: e.kind,
    title: e.title,
    excerpt: e.excerpt,
    observation: e.observation,
    provenance: provenanceOf(e),
    timestamp: e.timestamp,
    location: e.location ?? null,
    reportedTool: typeof e.meta?.reportedTool === "string" ? e.meta.reportedTool : null,
    rawSha256: typeof e.meta?.rawSha256 === "string" ? e.meta.rawSha256 : null,
  };
}

function pending(state: IdeState) {
  return state.requests.filter((r) => r.status === "pending");
}

// ---------- persistence ----------

function save(deps: IdeDeps, caller: Caller, state: IdeState) {
  deps.store.update(state.id, caller.companyId, { status: state.phase, verdict: state.verdict, state_json: JSON.stringify(state) });
}

export function loadState(deps: IdeDeps, caller: Caller, id: string): IdeState {
  if (typeof id !== "string" || id.length > 80) throw new IdeError("No investigation with that id.", "not_found");
  const row = deps.store.get(caller, id);
  if (!row) throw new IdeError("No investigation with that id.", "not_found");
  return JSON.parse(row.state_json) as IdeState;
}

// ---------- public API ----------

export const capabilities = () => ({
  kinds: EVIDENCE_REQUEST_KINDS.map((k) => ({ kind: k, ...KIND_INFO[k] })),
  limits: LIMITS,
  note: "Declare the kinds your connected tools can supply in nexus_start_investigation's capabilities. Nexus requests only those; the rest are recorded as not connected, and the stages that need them are skipped with a reason.",
});

const KIND_INFO: Record<EvidenceRequestKind, { what: string; usedBy: StageId[]; tools: string }> = {
  ticket: { what: "The defect ticket with description and comments.", usedBy: ["understand"], tools: "Jira or GitHub Issues MCP tools" },
  commits: { what: "Commits in the defect window.", usedBy: ["gather", "locate"], tools: "GitHub MCP list_commits, or git log" },
  code_search: { what: "Files matching search words from the ticket.", usedBy: ["gather", "locate"], tools: "GitHub MCP search_code, or grep" },
  file: { what: "Contents of suspect files.", usedBy: ["locate"], tools: "GitHub MCP get_file_contents, or a file read" },
  schema: { what: "Database table schema.", usedBy: ["gather", "detect"], tools: "A read-only database MCP tool" },
  query_stats: { what: "Query statistics such as pg_stat_statements.", usedBy: ["gather", "detect"], tools: "A read-only database MCP tool" },
  docs: { what: "Documentation pages matching the defect.", usedBy: ["gather"], tools: "Confluence or Notion MCP tools" },
  logs: { what: "Application logs in the defect window.", usedBy: ["gather", "detect"], tools: "Datadog, Grafana, Vercel or CloudWatch MCP tools" },
  tests: { what: "Recent test results.", usedBy: ["prove"], tools: "CI or GitHub Actions MCP tools" },
};

const StartInput = z.object({
  ticketRef: z.string().trim().min(1).max(120),
  capabilities: z.array(z.enum(EVIDENCE_REQUEST_KINDS)).max(EVIDENCE_REQUEST_KINDS.length).optional(),
  repos: z.array(z.string().max(201)).max(5).optional(),
});

export async function startInvestigation(deps: IdeDeps, caller: Caller, input: unknown): Promise<StepResult> {
  const parsed = StartInput.safeParse(input);
  if (!parsed.success) throw new IdeError("Give a ticket key such as PAY-1423, and optional capabilities and repos.", "invalid");
  const key = parsed.data.ticketRef.replace(/^\/?investigate\s+/i, "").trim();
  if (!isTicketKey(key)) throw new IdeError(`"${key.slice(0, 40)}" is not a ticket key. Use the form PAY-1423 or owner/repo#12.`, "invalid");
  const repos = (parsed.data.repos ?? []).filter(isRepo);
  const id = `ide_${randomUUID()}`;
  const created = nowIso(deps);
  const state: IdeState = {
    version: 1,
    id,
    ticketKey: key,
    createdAt: created,
    phase: "awaiting_evidence",
    round: 0,
    capabilities: parsed.data.capabilities ? [...new Set(["ticket" as const, ...parsed.data.capabilities])] : null,
    repos,
    stages: STAGES.map((s) => ({ id: s.id, title: s.title, status: "pending", summary: "", startedAt: null, finishedAt: null, durationMs: null })),
    requests: [],
    evidence: [],
    bytes: 0,
    ticket: null,
    ticketExtra: null,
    spec: null,
    missing: [],
    located: [],
    findings: [],
    detectors: [],
    couldNotVerify: [],
    demo: null,
    verdict: null,
    reason: null,
    approval: { status: "not_applicable", at: null, reason: null },
    validation: { status: "not_validated", statement: "Not validated yet.", before: null, after: null, checks: [] },
    lastSubmissionAt: null,
  };
  deps.store.insert({ id, company_id: caller.companyId, engineer_id: caller.engineerId, ticket_key: key, status: state.phase, verdict: null, state_json: JSON.stringify(state), created_at: created, updated_at: created });
  deps.store.audit(caller, "investigation.start", { ticketKey: key, investigationId: id, detail: { capabilities: state.capabilities, repos } });
  startStage(deps, state, "understand");
  if (key === SEEDED_TICKET && deps.sandbox) {
    // The seeded example ticket is held by Nexus itself; nothing to fetch.
    await afterTicket(deps, caller, state);
  } else {
    issueRound(deps, caller, state, [request.ticket({ round: 1, key, reason: "The ticket says what is wrong; every later step starts from it." })]);
  }
  save(deps, caller, state);
  return result(deps, caller, state, []);
}

const ResultSchema = z.union([
  z.object({ id: z.string().min(1).max(80), status: z.literal("ok"), tool: z.string().max(120).optional(), output: z.unknown() }),
  z.object({ id: z.string().min(1).max(80), status: z.literal("unavailable"), reason: z.string().max(2000) }),
]);
const SubmitSchema = z.object({ investigationId: z.string().min(1).max(80), results: z.array(ResultSchema).min(1).max(LIMITS.maxResultsPerSubmission) });

export async function submitEvidence(deps: IdeDeps, caller: Caller, input: unknown): Promise<StepResult> {
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(input) ?? "", "utf8");
  } catch {
    throw new IdeError("The submission could not be read.", "invalid");
  }
  if (size > LIMITS.maxSubmissionBytes) throw new IdeError(`The submission is ${size} bytes; the limit is ${LIMITS.maxSubmissionBytes}. Send fewer results per call.`, "too_large");
  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) throw new IdeError("Each result needs an id and either status \"ok\" with the raw output, or status \"unavailable\" with a reason.", "invalid");
  const state = loadState(deps, caller, parsed.data.investigationId);
  if (state.phase !== "awaiting_evidence") throw new IdeError(`This investigation is ${state.phase.replace("_", " ")} and takes no more evidence.`, "conflict");
  state.lastSubmissionAt = (deps.now?.() ?? new Date()).getTime();
  const rejected: { id: string; error: string }[] = [];
  const retry: EvidenceRequest[] = [];
  const seen = new Set<string>();
  for (const res of parsed.data.results) {
    const rec = state.requests.find((r) => r.request.id === res.id && r.status === "pending");
    if (!rec || seen.has(res.id)) {
      rejected.push({ id: res.id, error: rec ? "Sent twice in one call." : "Nexus has no open request with this id. Submit only ids from the latest requests." });
      continue;
    }
    seen.add(res.id);
    const req = rec.request;
    rec.attempts += 1;
    if (res.status === "unavailable") {
      const why = res.reason.replace(/\s+/g, " ").trim().slice(0, LIMITS.maxReasonChars) || "No reason given.";
      rec.status = "unavailable";
      rec.summary = `${KIND_LABEL[req.kind]}: not available (${why})`;
      deps.store.recordSubmission({ investigationId: state.id, round: req.round, requestId: req.id, kind: req.kind, status: "unavailable", tool: null, rawSha256: null, bytes: 0, summary: why });
      deps.store.audit(caller, "evidence.gap", { ticketKey: state.ticketKey, investigationId: state.id, detail: { requestId: req.id, kind: req.kind, required: req.required } });
      continue;
    }
    const p = parseResult(req, res, deps.now?.() ?? new Date());
    deps.store.recordSubmission({
      investigationId: state.id,
      round: req.round,
      requestId: req.id,
      kind: req.kind,
      status: p.ok ? "ok" : "rejected",
      tool: p.ok ? p.tool : (res.tool?.slice(0, 120) ?? null),
      rawSha256: p.rawSha256,
      bytes: p.bytes,
      summary: p.ok ? p.summary : p.error,
    });
    if (!p.ok) {
      rejected.push({ id: req.id, error: p.error });
      if (rec.attempts < 2) {
        rec.status = "rejected";
        rec.summary = `${KIND_LABEL[req.kind]}: result could not be read, asked again`;
        retry.push({ ...req, id: `${req.id}-again`, instruction: `${req.instruction} The previous result was rejected: ${p.error}` });
      } else {
        rec.status = "rejected";
        rec.summary = `${KIND_LABEL[req.kind]}: result could not be read twice`;
      }
      continue;
    }
    rec.status = "ok";
    rec.tool = p.tool;
    rec.rawSha256 = p.rawSha256;
    rec.summary = p.summary;
    addEvidence(state, p.items);
    if (p.ticket && req.kind === "ticket") {
      state.ticket = p.ticket;
      state.ticketExtra = p.ticketExtra ?? null;
    }
    deps.store.audit(caller, "evidence.round", {
      ticketKey: state.ticketKey,
      investigationId: state.id,
      detail: { requestId: req.id, kind: req.kind, items: p.items.length, rawSha256: p.rawSha256, tool: p.tool, redactions: p.redactions },
    });
  }
  if (pending(state).length) {
    // The agent has not answered everything yet: retries join the open round.
    for (const r of retry) state.requests.push({ request: r, status: "pending", attempts: 1, summary: "", tool: null, rawSha256: null });
  } else if (retry.length) {
    // Retries form their own round, counted against the cap.
    issueRound(deps, caller, state, retry);
    if (!pending(state).length) await advance(deps, caller, state);
  } else {
    await advance(deps, caller, state);
  }
  save(deps, caller, state);
  return result(deps, caller, state, rejected);
}

export function getStatus(deps: IdeDeps, caller: Caller, id: string): Progress & { pending: EvidenceRequest[] } {
  const state = loadState(deps, caller, id);
  return { ...progress(state), pending: pending(state).map((r) => r.request) };
}

export function getReport(deps: IdeDeps, caller: Caller, id: string): IdeReport | { status: Phase; message: string; progress: Progress } {
  const state = loadState(deps, caller, id);
  if (!state.verdict) return { status: state.phase, message: "The investigation is still waiting for evidence. The report is ready once every round is answered.", progress: progress(state) };
  return report(deps, caller, state);
}

export function listInvestigations(deps: IdeDeps, caller: Caller, limit = 20) {
  return deps.store.list(caller, limit).map((r) => ({ id: r.id, ticketKey: r.ticket_key, status: r.status, verdict: r.verdict, verdictLabel: r.verdict ? VERDICTS[r.verdict as Verdict]?.label ?? r.verdict : null, createdAt: r.created_at }));
}

export function cancelInvestigation(deps: IdeDeps, caller: Caller, id: string) {
  const state = loadState(deps, caller, id);
  if (state.phase === "done" || state.phase === "cancelled") throw new IdeError(`This investigation is already ${state.phase}.`, "conflict");
  for (const r of pending(state)) {
    r.status = "dropped";
    r.summary = `${KIND_LABEL[r.request.kind]}: cancelled`;
  }
  const at = STAGES.find((s) => ["pending", "running"].includes(stage(state, s.id).status));
  if (at) skipFrom(deps, state, at.id, "Cancelled.");
  state.phase = "cancelled";
  state.verdict ??= "failed";
  state.reason ??= "Cancelled by the engineer.";
  save(deps, caller, state);
  deps.store.audit(caller, "investigation.cancel", { ticketKey: state.ticketKey, investigationId: state.id });
  return { status: "cancelled" as const, investigationId: state.id };
}

export type ApprovalContext = { clientName: string | null };

export async function approve(deps: IdeDeps, caller: Caller, input: { investigationId: string; confirmation: unknown }, ctx: ApprovalContext) {
  const state = loadState(deps, caller, input.investigationId);
  const deny = (why: string): never => {
    deps.store.audit(caller, "approval.denied", { ticketKey: state.ticketKey, investigationId: state.id, detail: { why, client: ctx.clientName } });
    throw new IdeError(why, "denied");
  };
  if (state.phase !== "awaiting_approval" || state.approval.status !== "awaiting") deny("There is no suggested fix waiting for approval on this investigation.");
  const allowed = deps.approverClients ?? ["nexus-vscode"];
  if (allowed.length && !allowed.includes(ctx.clientName ?? "")) deny("Approval is accepted only from the Nexus extension, where the engineer types the confirmation. The IDE agent cannot approve.");
  const gap = deps.approvalGapMs ?? 2000;
  const now = (deps.now?.() ?? new Date()).getTime();
  if (state.lastSubmissionAt && now - state.lastSubmissionAt < gap) deny("Approval cannot arrive together with an evidence submission. The engineer approves separately, after reading the report.");
  // The engineer types the phrase; Nexus checks it and never fills it in.
  if (typeof input.confirmation !== "string" || !input.confirmation.trim()) deny("Type the confirmation phrase shown in the extension to approve.");
  if (!deps.sandbox || !state.demo?.snapshot) deny("Nexus's sandbox no longer holds this run. Start the investigation again.");
  const run = await deps.sandbox!.applyAndValidate(state.demo!.snapshot!, String(input.confirmation).trim());
  state.demo!.snapshot = run.snapshot;
  if (!run.ok) {
    // A wrong phrase or a failed sandbox step: still awaiting approval.
    save(deps, caller, state);
    deps.store.audit(caller, "approval.failed", { ticketKey: state.ticketKey, investigationId: state.id, detail: { message: run.message.slice(0, 200) } });
    throw new IdeError(run.message, "denied");
  }
  state.approval = { status: "approved", at: nowIso(deps), reason: null };
  deps.store.audit(caller, "approval.approved", { ticketKey: state.ticketKey, investigationId: state.id });
  startStage(deps, state, "prove");
  addEvidence(state, run.evidence.filter((e) => !state.evidence.some((x) => x.ref === e.ref)));
  const v = run.snapshot.run.validationResult;
  const proof = run.evidence.filter((e) => provenanceOf(e) === "nexus-executed");
  state.validation = {
    status: v?.outcome === "sandbox_improved" ? "validated" : "inconclusive",
    statement: v?.statement ?? "Validation finished.",
    before: run.snapshot.run.incident?.summary ?? null,
    after: run.snapshot.run.validation?.summary ?? null,
    checks: v?.checks ?? [],
  };
  if (v?.outcome === "sandbox_improved") {
    finishStage(deps, state, "prove", "done", `Sandbox proof: ${v.statement}`);
    setVerdict(state, capVerdict("diagnosed_verified", proof), `${state.reason ?? ""} The fix was applied in Nexus's sandbox and the same load was run again: ${v.statement}`.trim());
  } else {
    finishStage(deps, state, "prove", "done", `Sandbox validation was inconclusive: ${v?.statement ?? "no result"}`);
    setVerdict(state, "diagnosed", `${state.reason ?? ""} The sandbox validation was inconclusive, so the fix is not verified.`.trim());
  }
  state.phase = "done";
  save(deps, caller, state);
  return { status: "approved" as const, report: report(deps, caller, state) };
}

export function reject(deps: IdeDeps, caller: Caller, input: { investigationId: string; reason: unknown }) {
  const state = loadState(deps, caller, input.investigationId);
  if (state.phase !== "awaiting_approval") throw new IdeError("There is no suggested fix waiting for a decision.", "conflict");
  const why = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (!why) throw new IdeError("Give a one-line reason for rejecting.", "invalid");
  state.approval = { status: "rejected", at: nowIso(deps), reason: why };
  finishStage(deps, state, "prove", "skipped", "The suggested fix was rejected.");
  state.phase = "done";
  save(deps, caller, state);
  deps.store.audit(caller, "approval.rejected", { ticketKey: state.ticketKey, investigationId: state.id });
  return { status: "rejected" as const, report: report(deps, caller, state) };
}

export function feedback(deps: IdeDeps, caller: Caller, input: { investigationId: string; correct: unknown; note?: unknown }) {
  const state = loadState(deps, caller, input.investigationId);
  if (!state.verdict) throw new IdeError("Feedback can be given once the report is ready.", "conflict");
  if (typeof input.correct !== "boolean") throw new IdeError("Say whether the cause was correct (true or false).", "invalid");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  deps.store.addFeedback(caller, state.id, input.correct, note);
  deps.store.audit(caller, "feedback", { ticketKey: state.ticketKey, investigationId: state.id, detail: { correct: input.correct, hasNote: Boolean(note) } });
  return { status: "recorded" as const };
}

// ---------- the provenance rule ----------

/**
 * Diagnosed and verified may rest only on proof Nexus executed itself. Any
 * verdict stronger than "diagnosed" built on client-supplied evidence alone is
 * capped at Diagnosed (not verified).
 */
export function capVerdict(verdict: Verdict, proof: Pick<EvidenceItem, "provenance" | "kind">[]): Verdict {
  if (verdict !== "diagnosed_verified") return verdict;
  return proof.length > 0 && proof.every((e) => provenanceOf(e) === "nexus-executed") ? verdict : "diagnosed";
}

// ---------- rounds ----------

const KIND_LABEL: Record<EvidenceRequestKind, string> = {
  ticket: "Ticket",
  commits: "Commits",
  code_search: "Code search",
  file: "File",
  schema: "Schema",
  query_stats: "Query stats",
  docs: "Docs",
  logs: "Logs",
  tests: "Tests",
};

/** Opens the next round with these requests, or drops them when the round cap is reached. */
function issueRound(deps: IdeDeps, caller: Caller, state: IdeState, reqs: EvidenceRequest[]) {
  if (!reqs.length) return;
  if (state.round + 1 > LIMITS.maxRounds) {
    for (const r of reqs) {
      state.requests.push({ request: r, status: "dropped", attempts: 0, summary: `${KIND_LABEL[r.kind]}: not requested, the limit of ${LIMITS.maxRounds} rounds was reached`, tool: null, rawSha256: null });
    }
    state.couldNotVerify.push(`Nexus stopped asking for evidence after ${LIMITS.maxRounds} rounds.`);
    return;
  }
  state.round += 1;
  for (const r of reqs) state.requests.push({ request: { ...r, round: state.round, id: r.id.replace(/^r\d+-/, `r${state.round}-`) }, status: "pending", attempts: r.id.endsWith("-again") ? 1 : 0, summary: "", tool: null, rawSha256: null });
}

/** Called when every request of the current round has an answer. */
async function advance(deps: IdeDeps, caller: Caller, state: IdeState) {
  if (!state.spec && !state.missing.length && stage(state, "understand").status === "running") {
    await afterTicket(deps, caller, state);
    return;
  }
  if (stage(state, "gather").status === "running") {
    finishGather(deps, state);
    const files = locateRequests(state);
    startStage(deps, state, "locate");
    if (files.length) {
      issueRound(deps, caller, state, files);
      if (pending(state).length) return;
    }
    finishLocate(deps, state);
    finish(deps, caller, state);
    return;
  }
  if (stage(state, "locate").status === "running") {
    finishLocate(deps, state);
    finish(deps, caller, state);
  }
}

async function afterTicket(deps: IdeDeps, caller: Caller, state: IdeState) {
  const demoTicket = deps.sandbox && isDemoKey(state.ticketKey) ? await deps.sandbox.engineTicket(state.ticketKey, state.ticket, state.ticketExtra) : null;
  if (!state.ticket && !demoTicket) {
    const why = state.requests.filter((r) => r.request.kind === "ticket").map((r) => r.summary).pop() ?? "The ticket was not supplied.";
    finishStage(deps, state, "understand", "failed", `The ticket could not be read. ${why}`);
    skipFrom(deps, state, "reproduce", "Stopped: the ticket is required and was not supplied.");
    state.missing = [`The ticket ${state.ticketKey} itself. Connect your ticket tool (Jira or GitHub Issues) in the IDE so the agent can read it, then run the investigation again.`];
    setVerdict(state, "needs_more_information", `Nexus could not read ${state.ticketKey}, which every later step needs. Nothing was guessed in its place.`);
    state.phase = "done";
    return;
  }
  // The demo company's own scenarios run in Nexus's sandbox; any other ticket takes the general path.
  if (demoTicket && (demoTicket.sandboxScenario || state.ticketKey === SEEDED_TICKET)) {
    await demoPath(deps, caller, state, demoTicket);
    return;
  }
  const specResult = extractDefectSpec(state.ticket!);
  state.spec = specResult.ok ? specResult.spec : specResult.partial;
  if (!specResult.ok) {
    state.missing = specResult.missing;
    finishStage(deps, state, "understand", "done", `Read ${state.ticketKey}. The ticket is missing ${state.missing.length} thing${state.missing.length === 1 ? "" : "s"} needed to investigate.`);
    skipFrom(deps, state, "reproduce", "Stopped: the ticket needs more information first.");
    setVerdict(state, "needs_more_information", `${state.ticketKey} does not say enough to investigate yet. Add the items listed and run it again.`);
    state.phase = "done";
    return;
  }
  const spec = state.spec;
  finishStage(deps, state, "understand", "done", `Read ${state.ticketKey}: ${spec.steps.length} step${spec.steps.length === 1 ? "" : "s"}, expected and actual behaviour found.`);
  const noRepro = "Not reproduced: reproduction runs only in Nexus's own sandbox against a configured service under test, and this install has none for this ticket.";
  finishStage(deps, state, "reproduce", "skipped", noRepro);
  state.couldNotVerify.push(noRepro);
  startStage(deps, state, "gather");
  issueRound(deps, caller, state, gatherRequests(state));
  if (!pending(state).length) {
    finishGather(deps, state);
    startStage(deps, state, "locate");
    finishLocate(deps, state);
    finish(deps, caller, state);
  }
}

function gatherRequests(state: IdeState): EvidenceRequest[] {
  const spec = state.spec!;
  const out: EvidenceRequest[] = [];
  const reason = "To tie the defect to code, data or a recent change.";
  const terms = [...spec.errorMessages, ...spec.searchTerms].join(" ");
  const first = spec.firstReportedAt ?? state.ticket?.createdAt ?? null;
  const since = spec.window?.from ?? (first ? new Date(Date.parse(first) - 14 * 86_400_000).toISOString() : null);
  const until = spec.window?.to ?? (first ? new Date(Date.parse(first) + 86_400_000).toISOString() : null);
  const tryAdd = (make: () => EvidenceRequest) => {
    try {
      out.push(make());
    } catch (error) {
      if (!(error instanceof InvalidRequestValue)) throw error;
    }
  };
  state.repos.slice(0, 2).forEach((repo, i) => {
    if (can(state, "commits")) tryAdd(() => request.commits({ round: 0, seq: i + 1, repo, since, until, reason: "Changes shortly before the first report are a common cause." }));
    if (can(state, "code_search") && terms.trim()) tryAdd(() => request.codeSearch({ round: 0, seq: i + 1, repo, terms, reason: "To find the code the ticket describes." }));
  });
  if (can(state, "docs") && spec.searchTerms.length) tryAdd(() => request.docs({ round: 0, terms: spec.searchTerms.join(" "), reason }));
  if (can(state, "logs") && since && until) tryAdd(() => request.logs({ round: 0, terms: spec.errorMessages.join(" ") || spec.searchTerms.join(" "), since, until, reason: "Errors around the first report." }));
  if (state.capabilities?.includes("schema")) tryAdd(() => request.schema({ round: 0, tables: spec.identifiers.filter((x) => /^[a-z_][a-z0-9_]{2,}$/.test(x)).slice(0, 5), reason }));
  if (state.capabilities?.includes("query_stats")) tryAdd(() => request.queryStats({ round: 0, reason: "Slow or frequent queries around the defect." }));
  for (const k of ["commits", "code_search", "docs", "logs"] as const) {
    if (!can(state, k)) state.couldNotVerify.push(`${KIND_LABEL[k]}: not connected in the IDE, so nothing was read.`);
  }
  if (!state.repos.length && (can(state, "commits") || can(state, "code_search"))) state.couldNotVerify.push("No repository was given, so commits and code were not read. Set the repository in the Nexus extension settings.");
  return out;
}

function finishGather(deps: IdeDeps, state: IdeState) {
  const gathered = state.requests.filter((r) => r.request.round >= 2 && ["commits", "code_search", "docs", "logs", "schema", "query_stats"].includes(r.request.kind));
  for (const r of gathered.filter((x) => x.status !== "ok")) state.couldNotVerify.push(r.summary || `${KIND_LABEL[r.request.kind]}: not supplied.`);
  const ok = gathered.filter((r) => r.status === "ok");
  const items = state.evidence.filter((e) => ok.some((r) => r.request.id === e.meta?.requestId)).length;
  finishStage(deps, state, "gather", "done", `${items} evidence item${items === 1 ? "" : "s"} from ${ok.length} source${ok.length === 1 ? "" : "s"} supplied by the IDE agent.`);
}

/** Up to 3 files: code-search hits first, then files the commits changed that also matched. */
function locateRequests(state: IdeState): EvidenceRequest[] {
  if (!can(state, "file")) return [];
  const hits = state.evidence.filter((e) => e.meta?.evidenceKind === "code_search" && e.location?.path);
  const changed = new Set(state.evidence.filter((e) => e.meta?.evidenceKind === "commits").flatMap((e) => (Array.isArray(e.meta?.files) ? (e.meta!.files as string[]) : [])));
  const ranked = [...hits].sort((a, b) => Number(changed.has(b.location!.path!)) - Number(changed.has(a.location!.path!)));
  const out: EvidenceRequest[] = [];
  const seen = new Set<string>();
  for (const h of ranked) {
    const repo = String(h.meta?.repo ?? "");
    const p = h.location!.path!;
    if (seen.has(p) || out.length >= 3) continue;
    seen.add(p);
    try {
      out.push(request.file({ round: 0, seq: out.length + 1, repo, path: p, reason: changed.has(p) ? "It matched the ticket and changed in the defect window." : "It matched the ticket's words." }));
    } catch (error) {
      if (!(error instanceof InvalidRequestValue)) throw error;
    }
  }
  return out;
}

function finishLocate(deps: IdeDeps, state: IdeState) {
  const changed = new Set(state.evidence.filter((e) => e.meta?.evidenceKind === "commits").flatMap((e) => (Array.isArray(e.meta?.files) ? (e.meta!.files as string[]) : [])));
  const terms = (state.spec?.searchTerms ?? []).map((t) => t.toLowerCase()).filter((t) => t.length >= 3);
  for (const f of state.evidence.filter((e) => e.meta?.evidenceKind === "file" && e.location?.path)) {
    const p = f.location!.path!;
    if (state.located.some((l) => l.path === p)) continue;
    const lines = f.excerpt.split("\n");
    const offset = f.location?.startLine ?? 1;
    const idx = lines.findIndex((l) => terms.some((t) => l.toLowerCase().includes(t)));
    const term = idx >= 0 ? terms.find((t) => lines[idx].toLowerCase().includes(t)) : null;
    state.located.push({
      path: p,
      repo: typeof f.meta?.repo === "string" ? f.meta.repo : null,
      startLine: idx >= 0 ? offset + Math.max(0, idx - 3) : null,
      endLine: idx >= 0 ? offset + Math.min(lines.length - 1, idx + 3) : null,
      reason: `${term ? `"${term}" is on line ${offset + idx}` : "Matched by code search"}${changed.has(p) ? ", and the file changed in the defect window" : ""}. Supplied by the IDE agent.`,
      ref: f.ref,
    });
  }
  for (const h of state.evidence.filter((e) => e.meta?.evidenceKind === "code_search" && e.location?.path)) {
    if (state.located.length >= 10 || state.located.some((l) => l.path === h.location!.path)) continue;
    state.located.push({ path: h.location!.path!, repo: typeof h.meta?.repo === "string" ? h.meta.repo : null, startLine: h.location?.startLine ?? null, endLine: h.location?.endLine ?? null, reason: `Code search matched "${String(h.meta?.matchedTerm ?? "")}". The file itself was not read.`, ref: h.ref });
  }
  if (state.located.length) finishStage(deps, state, "locate", "done", `${state.located.length} code location${state.located.length === 1 ? "" : "s"} tied to the defect by search.`);
  else {
    const msg = "No code location could be tied to the ticket from the evidence supplied.";
    finishStage(deps, state, "locate", "skipped", msg);
    state.couldNotVerify.push(msg);
  }
}

function detect(deps: IdeDeps, state: IdeState, load?: LoadMeasurements) {
  startStage(deps, state, "detect");
  const ctx: DetectorContext = {
    investigationId: state.id,
    evidence: state.evidence,
    load,
    firstReportedAt: state.spec?.firstReportedAt ?? undefined,
    located: state.located.filter((l) => l.startLine != null).map((l) => ({ path: l.path, startLine: l.startLine!, endLine: l.endLine ?? l.startLine!, reason: l.reason })),
  };
  const runs = runDetectors(ctx);
  state.findings = rankFindings(runs);
  state.detectors = runs.map(({ detectorId, name, status, reason }) => ({ detectorId, name, status, reason }));
  const causes = state.findings.filter((f) => f.kind === "cause");
  const ran = runs.filter((d) => d.status === "ran");
  finishStage(
    deps,
    state,
    "detect",
    "done",
    causes.length
      ? `${causes.length} cause${causes.length === 1 ? "" : "s"} found by ${[...new Set(causes.map((c) => c.detectorId))].join(", ")}.`
      : `${ran.length} of ${runs.filter((d) => d.status !== "placeholder").length} detectors had the evidence they need; none found a cause.`,
  );
  for (const d of runs.filter((x) => x.status === "skipped")) state.couldNotVerify.push(`${d.name} did not run. ${d.reason ?? ""}`.trim());
  return { runs, causes };
}

function finish(deps: IdeDeps, caller: Caller, state: IdeState) {
  const { runs, causes } = detect(deps, state);
  if (causes.length) {
    finishStage(deps, state, "propose", "skipped", "No model endpoint is configured to draft a patch for this company.");
  } else {
    finishStage(deps, state, "propose", "skipped", "No cause was found, so no fix is suggested.");
  }
  finishStage(deps, state, "prove", "skipped", "Runs only after a suggested fix is approved.");
  if (causes.length) {
    const top = causes[0];
    const clientOnly = top.evidence.every((e) => provenanceOf(e) === "client-supplied");
    setVerdict(state, "diagnosed", `${top.cause}.${clientOnly ? " This rests only on evidence supplied by the IDE agent." : ""} No fix has been proven yet.`);
  } else {
    const n = state.evidence.length;
    const runnable = runs.filter((d) => d.status === "ran").length;
    setVerdict(
      state,
      "not_enough_evidence",
      runnable
        ? `Read ${n} piece${n === 1 ? "" : "s"} of evidence, but none of the ${runnable} detector${runnable === 1 ? "" : "s"} that could run found a cause.`
        : `Read ${n} piece${n === 1 ? "" : "s"} of evidence, but none of Nexus's detectors had the inputs they need for this defect, so no cause is claimed.`,
    );
  }
  state.phase = "done";
  deps.store.audit(caller, "investigation.report", { ticketKey: state.ticketKey, investigationId: state.id, detail: { verdict: state.verdict, evidence: state.evidence.length } });
}

// ---------- the demo company: Nexus's own sandbox ----------

async function demoPath(deps: IdeDeps, caller: Caller, state: IdeState, t: EngineTicket) {
  state.demo = { scenario: t.sandboxScenario ?? null, snapshot: null, engineAsk: t.ask };
  if (state.ticketKey === SEEDED_TICKET) {
    addEvidence(state, [
      {
        source: "Nexus seeded example",
        kind: "tickets",
        ref: `ticket:seeded:${SEEDED_TICKET}`,
        timestamp: t.openedAt || null,
        retrievedAt: nowIso(deps),
        title: `${SEEDED_TICKET} ${t.title}`,
        excerpt: t.symptom,
        observation: "observed",
        provenance: "nexus-fetched",
        meta: { trust: "untrusted-input", seeded: true },
      },
    ]);
  }
  if (t.sandboxScenario === "ask-for-info") {
    finishStage(deps, state, "understand", "done", `Read ${state.ticketKey}. The engine finds the evidence too thin to measure.`);
    skipFrom(deps, state, "reproduce", "Stopped: the ticket needs more information first.");
    state.missing = ["Traces for the affected requests", "Logs from the time of the report", "A reproduction: the steps and the expected and actual result"];
    setVerdict(state, "needs_more_information", `${t.ask} ${t.disclaimer}`.trim());
    state.phase = "done";
    return;
  }
  finishStage(deps, state, "understand", "done", `Read ${state.ticketKey}. Sandbox scenario: ${t.sandboxScenario ?? "lock"}.`);
  startStage(deps, state, "reproduce");
  let m;
  try {
    m = await deps.sandbox!.measure(t);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    finishStage(deps, state, "reproduce", "failed", msg.slice(0, 300));
    skipFrom(deps, state, "gather", "Stopped after an earlier stage failed.");
    setVerdict(state, "failed", `The sandbox measurement failed: ${msg.slice(0, 300)}`);
    state.phase = "done";
    return;
  }
  state.demo.snapshot = m.snapshot;
  addEvidence(state, m.evidence);
  const incident = m.snapshot.run.incident?.summary ?? m.snapshot.run.outage?.summary;
  finishStage(deps, state, "reproduce", "done", `Nexus ran the ${m.snapshot.run.scenario} load in its own sandbox: ${incident?.requests ?? 0} requests, ${incident?.errors ?? 0} errors.`);
  finishStage(deps, state, "gather", "skipped", "The sandbox recorded its own metrics, traces, logs and source; no outside evidence was needed.");
  startStage(deps, state, "locate");
  for (const e of m.evidence.filter((x) => x.location?.path && x.location.startLine)) {
    if (state.located.some((l) => l.path === e.location!.path && l.startLine === e.location!.startLine)) continue;
    state.located.push({ path: e.location!.path!, repo: null, startLine: e.location!.startLine ?? null, endLine: e.location!.endLine ?? null, reason: "Source the sandbox engine cites for this run.", ref: e.ref });
  }
  if (state.located.length) finishStage(deps, state, "locate", "done", `${state.located.length} source location${state.located.length === 1 ? "" : "s"} cited by the engine.`);
  else finishStage(deps, state, "locate", "skipped", "The engine cited no source for this run.");
  const { causes, runs } = detect(deps, state, m.load ?? undefined);
  const proposal = m.snapshot.run.diagnosis?.proposal ?? null;
  if (causes.length && proposal) {
    startStage(deps, state, "propose");
    finishStage(deps, state, "propose", "done", `${proposal.title}. Not applied.`);
    setVerdict(state, "diagnosed", `${causes[0].cause}. No fix has been proven yet.`);
    state.approval = { status: "awaiting", at: null, reason: null };
    state.phase = "awaiting_approval";
    deps.store.audit(caller, "investigation.report", { ticketKey: state.ticketKey, investigationId: state.id, detail: { verdict: state.verdict, awaitingApproval: true } });
    return;
  }
  finishStage(deps, state, "propose", "skipped", causes.length ? "The engine made no proposal." : "No cause was found, so no fix is suggested.");
  finishStage(deps, state, "prove", "skipped", "Runs only after a suggested fix is approved.");
  const abstained = runs.find((r) => r.detectorId === "lock-contention")?.result?.abstained ?? m.snapshot.run.diagnosis?.summary ?? "The rules did not fire.";
  setVerdict(state, causes.length ? "diagnosed" : "not_enough_evidence", causes.length ? `${causes[0].cause}.` : abstained);
  state.phase = "done";
  deps.store.audit(caller, "investigation.report", { ticketKey: state.ticketKey, investigationId: state.id, detail: { verdict: state.verdict } });
}

function setVerdict(state: IdeState, v: Verdict, reason: string) {
  state.verdict = v;
  state.reason = reason;
}

// ---------- output ----------

function progress(state: IdeState): Progress {
  return {
    investigationId: state.id,
    ticketKey: state.ticketKey,
    phase: state.phase,
    round: state.round,
    maxRounds: LIMITS.maxRounds,
    stages: state.stages,
    sources: state.requests.map((r) => ({
      requestId: r.request.id,
      kind: r.request.kind,
      status: r.status,
      line: r.status === "pending" ? `${KIND_LABEL[r.request.kind]}: waiting for the IDE agent` : r.summary,
    })),
  };
}

function report(deps: IdeDeps, caller: Caller, state: IdeState): IdeReport {
  const v = state.verdict ?? "failed";
  const baseId = (id: string) => id.replace(/^r\d+-/, "").replace(/-again$/, "");
  const answered = new Set(state.requests.filter((r) => r.status === "ok").map((r) => baseId(r.request.id)));
  const gaps = state.requests
    .filter((r) => r.status === "unavailable" || r.status === "dropped" || (r.status === "rejected" && !answered.has(baseId(r.request.id))))
    .filter((r, i, all) => all.findIndex((x) => baseId(x.request.id) === baseId(r.request.id)) === i || r.status !== "rejected")
    .map((r) => ({ requestId: r.request.id, kind: r.request.kind, required: r.request.required, reason: r.summary }));
  const help = new Set<string>();
  for (const g of gaps) help.add(`${KIND_INFO[g.kind as EvidenceRequestKind].what} Connect: ${KIND_INFO[g.kind as EvidenceRequestKind].tools}.`);
  if (state.capabilities && !state.demo) for (const k of EVIDENCE_REQUEST_KINDS) if (!state.capabilities.includes(k) && k !== "tests") help.add(`${KIND_INFO[k].what} Connect: ${KIND_INFO[k].tools}.`);
  if (!state.repos.length && !state.demo) help.add("Set the repository in the Nexus extension settings so commits and code can be read.");
  const byRef = new Map(state.evidence.map((e) => [e.ref, e]));
  const proposal = state.demo?.snapshot?.run.diagnosis?.proposal ?? null;
  const tools = [...new Set(state.requests.map((r) => r.tool).filter((t): t is string => Boolean(t)))];
  const provenanceNote =
    state.evidence.length && state.evidence.every((e) => provenanceOf(e) === "client-supplied")
      ? "Every piece of evidence was supplied by the IDE agent. Nexus did not run or fetch anything itself, so no conclusion here is verified."
      : null;
  void caller;
  return {
    investigationId: state.id,
    ticketKey: state.ticketKey,
    generatedAt: nowIso(deps),
    verdict: v,
    verdictLabel: VERDICTS[v].label,
    verdictDescription: VERDICTS[v].description,
    reason: state.reason ?? "",
    sourcesUsed: [...tools.map((t) => `IDE agent: ${t}`), ...(state.demo?.snapshot ? ["Nexus sandbox: local catalog and rule engine"] : [])],
    ticket: state.ticket
      ? { key: state.ticket.key, title: state.ticket.title, url: state.ticket.url, status: state.ticket.status, priority: state.ticket.priority, createdAt: state.ticket.createdAt, labels: state.ticket.labels }
      : null,
    spec: state.spec,
    missingInformation: state.missing,
    causes: state.findings.map((f) => {
      const ev = f.evidence.map((e) => byRef.get(e.ref) ?? e);
      return {
        rank: f.rank,
        detectorId: f.detectorId,
        cause: f.cause,
        score: f.score,
        threshold: f.threshold,
        kind: f.kind,
        rule: f.rule,
        facts: f.facts,
        evidence: ev.map(view),
        restsOnlyOnClientEvidence: ev.length > 0 && ev.every((e) => provenanceOf(e) === "client-supplied"),
      };
    }),
    evidence: state.evidence.map(view),
    located: state.located,
    detectors: state.detectors,
    couldNotVerify: [...new Set(state.couldNotVerify)],
    whatWouldHelp: [...help],
    gaps,
    suggestedFix: proposal && state.approval.status !== "not_applicable" ? { title: proposal.title, summary: proposal.summary, change: proposal.sandboxChange, boundary: proposal.boundary, diff: null } : null,
    validation: state.validation,
    approval: state.approval,
    provenanceNote,
    timeline: state.stages,
    readOnlyNote: READ_ONLY,
  };
}

function result(deps: IdeDeps, caller: Caller, state: IdeState, rejected: { id: string; error: string }[]): StepResult {
  const open = pending(state);
  if (state.phase === "awaiting_evidence" && open.length) {
    return { status: "needs_evidence", investigationId: state.id, round: state.round, requests: open.map((r) => r.request), rejected, progress: progress(state), instructions: AGENT_STEPS };
  }
  return { status: state.phase === "awaiting_evidence" ? "done" : state.phase, investigationId: state.id, report: report(deps, caller, state), progress: progress(state), rejected };
}
