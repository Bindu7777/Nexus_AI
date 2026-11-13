// Company investigations: storage, a background queue, and the scoped reads
// the API serves. Every read is filtered by the signed-in user's company; an
// employee sees their own investigations, a company admin sees the company's.
import { randomUUID } from "node:crypto";
import type { EvidenceItem } from "../../../connectors/types";
import type { TicketConnector } from "../../../connectors/tickets/types";
import { audit, type Actor } from "@/nexus-admin/server/audit";
import { companySources } from "@/nexus-admin/server/connectors";
import { dbPath, getDb, nowIso } from "@/nexus-admin/server/db";
import path from "node:path";
import { reproduceDefect } from "@/investigation/repro";
import { runPipeline, STAGES, type InvestigationReport, type PipelineDeps, type SourceHandle, type StageId } from "@/investigation/pipeline";
import { readGitHubIssueTicket, readJiraTicket, type TicketRead } from "@/investigation/ticket";
import { VERDICTS, type Verdict } from "@/investigation/types";
import { checkDefectNumber, defectSources } from "./defects";
import { portalActor, type PortalContext } from "./auth";

export const MAX_RUNNING_PER_COMPANY = 3;

export type InvestigationRow = {
  id: string;
  company_id: number;
  user_id: number;
  ticket_key: string;
  ticket_source: string;
  status: "queued" | "running" | "done" | "cancelled" | "failed";
  verdict: Verdict | null;
  verdict_reason: string | null;
  spec_json: string | null;
  report_json: string | null;
  cancel_requested: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type StepRow = { stage: StageId; position: number; status: string; started_at: string | null; finished_at: string | null; summary: string; detail_json: string };
type EvidenceRow = { id: number; stage: string; source: string; ref: string; title: string; timestamp: string | null; excerpt: string; observation: "observed" | "inferred"; location_json: string | null; meta_json: string };

// ---------- dependencies (replaceable in tests) ----------

export type DepsFactory = (inv: InvestigationRow) => Omit<PipelineDeps, "recorder" | "isCancelled">;

export const defaultDeps: DepsFactory = (inv) => {
  const all = companySources(inv.company_id);
  const sources: SourceHandle[] = all.map((s) => ({
    connectorId: s.connectorId,
    registryId: s.registryId,
    category: s.category,
    name: s.name,
    status: s.status,
    connector: s.connector,
    secretValues: s.secretValues,
  }));
  const readTicket = async (): Promise<TicketRead> => {
    const defects = all.filter((s) => s.category === "defects");
    if (inv.ticket_source === "jira") {
      const project = inv.ticket_key.split("-")[0];
      const src = defects.find((s) => s.registryId === "jira" && (Array.isArray(s.ctx.scope.projectKeys) ? s.ctx.scope.projectKeys : []).map(String).map((k) => k.toUpperCase()).includes(project));
      if (!src) return { ok: false, reason: "unsupported", message: `No working Jira connector covers project ${project}.` };
      return readJiraTicket(src.ctx, inv.ticket_key);
    }
    const repo = inv.ticket_key.split("#")[0].toLowerCase();
    const src = defects.find((s) => s.registryId === "github-issues" && String(s.ctx.scope.repository ?? "").toLowerCase() === repo);
    if (!src?.connector) return { ok: false, reason: "unsupported", message: `No working GitHub Issues connector covers ${repo}.` };
    return readGitHubIssueTicket(src.connector as TicketConnector, inv.ticket_key);
  };
  const service = all.find((s) => s.registryId === "service-under-test");
  const reproduce = service ? (spec: Parameters<typeof reproduceDefect>[0]["spec"]) => reproduceDefect({ spec, service: service.ctx, workDir: artifactDir(inv.id) }) : undefined;
  return { sources, readTicket, reproduce };
};

/** Where a run's screenshots live: next to the admin database, never in the repository. */
export function artifactDir(investigationId: string) {
  return path.join(path.dirname(dbPath()), "investigations", investigationId);
}

let depsFactory: DepsFactory = defaultDeps;
export function setDepsFactoryForTests(f: DepsFactory | null) {
  depsFactory = f ?? defaultDeps;
}

// ---------- queue ----------

type G = typeof globalThis & { __nexusInvestigationRunner?: { running: Set<string>; booted: boolean } };
function state() {
  const g = globalThis as G;
  g.__nexusInvestigationRunner ??= { running: new Set(), booted: false };
  const st = g.__nexusInvestigationRunner;
  if (!st.booted) {
    st.booted = true;
    // Work in flight when the server stopped cannot be resumed honestly: mark it failed.
    const db = getDb();
    const stale = db.prepare("SELECT id FROM investigations WHERE status = 'running'").all() as { id: string }[];
    for (const { id } of stale) {
      db.prepare("UPDATE investigations SET status = 'failed', verdict = 'failed', verdict_reason = ?, finished_at = ? WHERE id = ?").run(
        "The Nexus server restarted while this investigation was running. Run it again.",
        nowIso(),
        id,
      );
      db.prepare("UPDATE investigation_steps SET status = 'failed', summary = 'Interrupted by a server restart.', finished_at = ? WHERE investigation_id = ? AND status = 'running'").run(nowIso(), id);
      db.prepare("UPDATE investigation_steps SET status = 'skipped', summary = 'Stopped after a server restart.' WHERE investigation_id = ? AND status = 'pending'").run(id);
    }
    setTimeout(pump, 0);
  }
  return st;
}

export function queuePosition(inv: Pick<InvestigationRow, "id" | "company_id" | "status" | "created_at">) {
  if (inv.status !== "queued") return null;
  const ahead = getDb()
    .prepare("SELECT COUNT(*) n FROM investigations WHERE company_id = ? AND status = 'queued' AND (created_at < ? OR (created_at = ? AND id < ?))")
    .get(inv.company_id, inv.created_at, inv.created_at, inv.id) as { n: number };
  return ahead.n + 1;
}

function pump() {
  const st = state();
  const db = getDb();
  const queued = db.prepare("SELECT * FROM investigations WHERE status = 'queued' ORDER BY created_at, id").all() as InvestigationRow[];
  for (const inv of queued) {
    const running = (db.prepare("SELECT COUNT(*) n FROM investigations WHERE company_id = ? AND status = 'running'").get(inv.company_id) as { n: number }).n;
    if (running >= MAX_RUNNING_PER_COMPANY || st.running.has(inv.id)) continue;
    st.running.add(inv.id);
    db.prepare("UPDATE investigations SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'").run(nowIso(), inv.id);
    void execute({ ...inv, status: "running" }).finally(() => {
      st.running.delete(inv.id);
      setTimeout(pump, 0);
    });
  }
}

async function execute(inv: InvestigationRow) {
  const db = getDb();
  const actor = actorFor(inv);
  const recorder: PipelineDeps["recorder"] = {
    start: (stage) => db.prepare("UPDATE investigation_steps SET status = 'running', started_at = ? WHERE investigation_id = ? AND stage = ?").run(nowIso(), inv.id, stage),
    finish: (stage, status, summary, detail) =>
      db
        .prepare("UPDATE investigation_steps SET status = ?, finished_at = ?, started_at = COALESCE(started_at, ?), summary = ?, detail_json = ? WHERE investigation_id = ? AND stage = ?")
        .run(status, nowIso(), nowIso(), summary.slice(0, 600), JSON.stringify(detail ?? {}).slice(0, 60_000), inv.id, stage),
    evidence: (stage, items) => storeEvidence(inv.id, stage, items),
  };
  const isCancelled = () => (db.prepare("SELECT cancel_requested FROM investigations WHERE id = ?").get(inv.id) as { cancel_requested: number } | undefined)?.cancel_requested === 1;
  let deps: Omit<PipelineDeps, "recorder" | "isCancelled">;
  try {
    deps = depsFactory(inv);
  } catch (error) {
    finishRun(inv, "failed", "failed", `The company's connectors could not be prepared: ${error instanceof Error ? error.message : String(error)}`, null, null, actor);
    return;
  }
  const result = await runPipeline({ ...deps, recorder, isCancelled });
  finishRun(inv, result.cancelled ? "cancelled" : "done", result.verdict, result.reason, result.spec, result.report, actor);
}

function finishRun(inv: InvestigationRow, status: InvestigationRow["status"], verdict: Verdict, reason: string, spec: unknown, report: InvestigationReport | null, actor: Actor) {
  getDb()
    .prepare("UPDATE investigations SET status = ?, verdict = ?, verdict_reason = ?, spec_json = ?, report_json = ?, finished_at = ? WHERE id = ?")
    .run(status, status === "cancelled" ? null : verdict, reason, spec ? JSON.stringify(spec) : null, report ? JSON.stringify(report) : null, nowIso(), inv.id);
  audit({
    actor,
    action: status === "cancelled" ? "investigation.cancelled" : "investigation.finished",
    result: status === "done" ? "ok" : status === "cancelled" ? "info" : "fail",
    companyId: inv.company_id,
    target: inv.ticket_key,
    detail: { investigation: inv.id, verdict: status === "cancelled" ? null : verdict },
  });
}

function storeEvidence(id: string, stage: string, items: EvidenceItem[]) {
  const ins = getDb().prepare(
    "INSERT INTO evidence_items (investigation_id, stage, source, ref, title, timestamp, excerpt, observation, location_json, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const e of items.slice(0, 200)) {
    ins.run(id, stage, e.source, e.ref.slice(0, 500), e.title.slice(0, 300), e.timestamp, (e.excerpt ?? "").slice(0, 1500), e.observation, e.location ? JSON.stringify(e.location) : null, JSON.stringify(e.meta ?? {}).slice(0, 4000));
  }
}

function actorFor(inv: Pick<InvestigationRow, "company_id" | "user_id">): Actor {
  const row = getDb()
    .prepare("SELECT u.id, u.login_id, c.short_code FROM company_users u JOIN companies c ON c.id = u.company_id WHERE u.id = ? AND u.company_id = ?")
    .get(inv.user_id, inv.company_id) as { id: number; login_id: string; short_code: string } | undefined;
  return row ? { type: "company_user", id: row.id, label: `${row.short_code}/${row.login_id}` } : { type: "system", label: "nexus" };
}

// ---------- API operations, always scoped to the caller's company ----------

export type StartResult =
  | { ok: true; id: string; queuePosition: number | null }
  | { ok: false; status: number; error: string; recent?: { id: string; createdAt: string; verdict: Verdict | null; status: string } };

export function startInvestigation(ctx: PortalContext, defect: string, options: { force?: boolean; ip?: string } = {}): StartResult {
  state();
  const check = checkDefectNumber(defectSources(ctx.company.id), defect);
  if (!check.ok) return { ok: false, status: 400, error: check.message };
  const db = getDb();
  if (!options.force) {
    const recent = db
      .prepare("SELECT id, created_at, verdict, status FROM investigations WHERE company_id = ? AND ticket_key = ? AND created_at > ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1")
      .get(ctx.company.id, check.key, new Date(Date.now() - 24 * 3600_000).toISOString()) as { id: string; created_at: string; verdict: Verdict | null; status: string } | undefined;
    if (recent) {
      return {
        ok: false,
        status: 409,
        error: `${check.key} was investigated in the last 24 hours. Open that report, or run it again.`,
        recent: { id: recent.id, createdAt: recent.created_at, verdict: recent.verdict, status: recent.status },
      };
    }
  }
  const id = randomUUID();
  const now = nowIso();
  db.transaction(() => {
    db.prepare("INSERT INTO investigations (id, company_id, user_id, ticket_key, ticket_source, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)").run(id, ctx.company.id, ctx.user.id, check.key, check.source, now);
    const st = db.prepare("INSERT INTO investigation_steps (investigation_id, stage, position, status) VALUES (?, ?, ?, 'pending')");
    STAGES.forEach((s, i) => st.run(id, s.id, i + 1));
  })();
  audit({ actor: portalActor(ctx.company, ctx.user), action: "investigation.started", result: "ok", companyId: ctx.company.id, target: check.key, ip: options.ip, detail: { investigation: id } });
  setTimeout(pump, 0);
  const row = db.prepare("SELECT * FROM investigations WHERE id = ?").get(id) as InvestigationRow;
  return { ok: true, id, queuePosition: queuePosition(row) };
}

/** The investigation if the caller may see it, else null. Never reveals other companies' rows. */
export function findForCaller(ctx: PortalContext, id: string): InvestigationRow | null {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const row = getDb().prepare("SELECT * FROM investigations WHERE id = ? AND company_id = ?").get(id, ctx.company.id) as InvestigationRow | undefined;
  if (!row) return null;
  if (ctx.user.role !== "company_admin" && row.user_id !== ctx.user.id) return null;
  return row;
}

export function investigationView(row: InvestigationRow) {
  const db = getDb();
  const steps = (db.prepare("SELECT stage, position, status, started_at, finished_at, summary, detail_json FROM investigation_steps WHERE investigation_id = ? ORDER BY position").all(row.id) as StepRow[]).map((s) => ({
    stage: s.stage,
    title: STAGES.find((x) => x.id === s.stage)?.title ?? s.stage,
    position: s.position,
    status: s.status,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    durationMs: s.started_at && s.finished_at ? Math.max(0, Date.parse(s.finished_at) - Date.parse(s.started_at)) : null,
    summary: s.summary,
    detail: JSON.parse(s.detail_json || "{}") as Record<string, unknown>,
  }));
  const evidence = (db.prepare("SELECT * FROM evidence_items WHERE investigation_id = ? ORDER BY id").all(row.id) as EvidenceRow[]).map((e) => ({
    id: e.id,
    stage: e.stage,
    source: e.source,
    ref: e.ref,
    title: e.title,
    timestamp: e.timestamp,
    excerpt: e.excerpt,
    observation: e.observation,
    location: e.location_json ? (JSON.parse(e.location_json) as EvidenceItem["location"]) : null,
  }));
  const owner = db.prepare("SELECT login_id, display_name FROM company_users WHERE id = ?").get(row.user_id) as { login_id: string; display_name: string } | undefined;
  const fb = db.prepare("SELECT kind, note, created_at FROM feedback WHERE investigation_id = ? ORDER BY id").all(row.id) as { kind: string; note: string; created_at: string }[];
  return {
    id: row.id,
    ticketKey: row.ticket_key,
    ticketSource: row.ticket_source,
    status: row.status,
    verdict: row.verdict,
    verdictLabel: row.verdict ? VERDICTS[row.verdict].label : null,
    verdictReason: row.verdict_reason,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    queuePosition: queuePosition(row),
    owner: owner ? { employeeId: owner.login_id, name: owner.display_name } : null,
    steps,
    evidence,
    report: row.report_json ? (JSON.parse(row.report_json) as InvestigationReport) : null,
    feedback: fb.map((f) => ({ kind: f.kind, note: f.note, createdAt: f.created_at })),
  };
}
export type InvestigationView = ReturnType<typeof investigationView>;

export function listForCaller(ctx: PortalContext, options: { verdict?: string; q?: string; limit?: number } = {}) {
  const where = ["i.company_id = @company"];
  const params: Record<string, unknown> = { company: ctx.company.id, limit: Math.min(options.limit ?? 50, 200) };
  if (ctx.user.role !== "company_admin") {
    where.push("i.user_id = @user");
    params.user = ctx.user.id;
  }
  if (options.verdict && options.verdict in VERDICTS) {
    where.push("i.verdict = @verdict");
    params.verdict = options.verdict;
  }
  if (options.q) {
    where.push("i.ticket_key LIKE @q");
    params.q = `%${options.q.slice(0, 40)}%`;
  }
  const rows = getDb()
    .prepare(
      `SELECT i.*, u.login_id, u.display_name, (SELECT kind FROM feedback f WHERE f.investigation_id = i.id ORDER BY f.id DESC LIMIT 1) AS last_feedback
       FROM investigations i JOIN company_users u ON u.id = i.user_id WHERE ${where.join(" AND ")} ORDER BY i.created_at DESC LIMIT @limit`,
    )
    .all(params) as (InvestigationRow & { login_id: string; display_name: string; last_feedback: string | null })[];
  return rows.map((r) => ({
    id: r.id,
    ticketKey: r.ticket_key,
    status: r.status,
    verdict: r.verdict,
    verdictLabel: r.verdict ? VERDICTS[r.verdict].label : null,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    queuePosition: queuePosition(r),
    owner: { employeeId: r.login_id, name: r.display_name },
    feedback: r.last_feedback,
  }));
}

export function recordView(ctx: PortalContext, row: InvestigationRow, ip?: string) {
  audit({ actor: portalActor(ctx.company, ctx.user), action: "investigation.viewed", result: "info", companyId: ctx.company.id, target: row.ticket_key, ip, detail: { investigation: row.id } });
}

export function cancelInvestigation(ctx: PortalContext, row: InvestigationRow, ip?: string) {
  if (row.status !== "queued" && row.status !== "running") return { ok: false as const, error: "This investigation has already finished." };
  const db = getDb();
  db.prepare("UPDATE investigations SET cancel_requested = 1 WHERE id = ?").run(row.id);
  if (row.status === "queued") {
    db.prepare("UPDATE investigations SET status = 'cancelled', verdict_reason = 'Cancelled before it started.', finished_at = ? WHERE id = ? AND status = 'queued'").run(nowIso(), row.id);
    db.prepare("UPDATE investigation_steps SET status = 'skipped', summary = 'Cancelled.' WHERE investigation_id = ? AND status = 'pending'").run(row.id);
    audit({ actor: portalActor(ctx.company, ctx.user), action: "investigation.cancelled", result: "info", companyId: ctx.company.id, target: row.ticket_key, ip, detail: { investigation: row.id } });
  }
  return { ok: true as const };
}

const FEEDBACK = new Set(["cause_correct", "cause_wrong", "fix_worked", "fix_failed"]);
export function addFeedback(ctx: PortalContext, row: InvestigationRow, kind: string, note: string, ip?: string) {
  if (!FEEDBACK.has(kind)) return { ok: false as const, error: "Unknown feedback." };
  if (row.status !== "done") return { ok: false as const, error: "Feedback opens when the investigation has finished." };
  const report = row.report_json ? (JSON.parse(row.report_json) as InvestigationReport) : null;
  if ((kind === "fix_worked" || kind === "fix_failed") && !report?.suggestedFix) return { ok: false as const, error: "There is no suggested fix to give feedback on." };
  getDb()
    .prepare("INSERT INTO feedback (investigation_id, user_id, kind, note, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, ctx.user.id, kind, note.trim().slice(0, 500), nowIso());
  audit({ actor: portalActor(ctx.company, ctx.user), action: "investigation.feedback", result: "info", companyId: ctx.company.id, target: row.ticket_key, ip, detail: { investigation: row.id, kind } });
  return { ok: true as const };
}

/** Approve or reject a suggested fix. Nothing is applied: approval only records the decision until the sandbox exists. */
export function decide(ctx: PortalContext, row: InvestigationRow, decision: "approved" | "rejected", input: { confirmation?: string; reason?: string; diffVersion?: string }, ip?: string) {
  const report = row.report_json ? (JSON.parse(row.report_json) as InvestigationReport) : null;
  if (!report?.suggestedFix) return { ok: false as const, status: 409, error: "This investigation has no suggested fix to approve or reject." };
  if (decision === "rejected" && !input.reason?.trim()) return { ok: false as const, status: 400, error: "Give a one-line reason for rejecting." };
  getDb()
    .prepare("INSERT INTO approvals (investigation_id, user_id, decision, reason, diff_version, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, ctx.user.id, decision, (input.reason ?? "").trim().slice(0, 300), String(input.diffVersion ?? ""), nowIso());
  audit({ actor: portalActor(ctx.company, ctx.user), action: `investigation.${decision}`, result: "info", companyId: ctx.company.id, target: row.ticket_key, ip, detail: { investigation: row.id } });
  return { ok: true as const };
}
