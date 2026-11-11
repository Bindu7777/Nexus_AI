import { catalogUrlFromEnv } from "./catalog-client";
import { assertCanValidate, CONFIRMATION_PHRASE } from "./diagnosis";
import {
  createRun,
  engageRemediatedMode,
  executeValidationLoad,
  resetSandbox,
  runInvestigation,
  runValidation,
} from "./investigate";
import { resolveTarget } from "./targets";
import { resolveTicket } from "./tickets/resolve";
import type { DemoStore } from "./store";
import { getStore } from "./store";
import type { Citation, Diagnosis, EngineTicket, Proposal, RunRecord } from "./types";

export { CONFIRMATION_PHRASE, createRun, resetSandbox, runInvestigation, runValidation };

export type DiagnosisView = {
  method: "rule-based-sandbox";
  outcome: Diagnosis["outcome"] | "not-run";
  hypothesis: string;
  evidence: Array<Citation & { path?: string; startLine?: number; endLine?: number }>;
  confidence: "high" | "low" | "none";
  abstain: boolean;
  abstainReason: string | null;
  rules: Diagnosis["rules"];
  uncertainties: string[];
  proposal: Proposal | null;
  ticketNote: string | null;
  sandboxOnly: true;
};

function evidenceDetails(run: RunRecord, projectRoot?: string, store?: DemoStore) {
  return (run.diagnosis?.citations ?? []).map((citation) => {
    const record = store?.evidence.get(citation.evidenceId);
    if (record?.type !== "source") return citation;
    const body = record.body as { path?: string; startLine?: number; endLine?: number };
    return {
      ...citation,
      path: body.path,
      startLine: body.startLine,
      endLine: body.endLine,
      projectRoot,
    };
  });
}

export function presentDiagnosis(run: RunRecord | null, projectRoot?: string, store?: DemoStore): DiagnosisView {
  if (!run?.diagnosis) {
    return {
      method: "rule-based-sandbox",
      outcome: "not-run",
      hypothesis: "No sandbox diagnosis has been recorded for this run.",
      evidence: [],
      confidence: "none",
      abstain: true,
      abstainReason: "There are no measurements to judge.",
      rules: [],
      uncertainties: [],
      proposal: null,
      ticketNote: run?.ticket?.disclaimer ?? null,
      sandboxOnly: true,
    };
  }
  const diagnosis = run.diagnosis;
  const rulesAbstain = diagnosis.outcome !== "lock_contention" || !diagnosis.proposal;
  const sparse = run.ticket?.detail === "sparse" || run.ticket?.fallback === "seeded-scenario";
  const fired = diagnosis.rules.filter((rule) => rule.fired).length;
  const confidence = sparse || rulesAbstain ? (fired > 0 && !sparse ? "low" : "none") : "high";
  const ticketNote = sparse
    ? run.ticket?.disclaimer ?? "The ticket text was too thin to investigate. No evidence was invented from it."
    : run.ticket?.source === "seeded"
      ? "The ticket is the seeded example NI-1042, not a Jira issue."
      : null;
  const hypothesis = sparse
    ? `No hypothesis is offered for ${run.ticket?.id}. ${ticketNote} The sandbox rules on the seeded scenario say: ${diagnosis.summary}`
    : diagnosis.summary;
  return {
    method: "rule-based-sandbox",
    outcome: diagnosis.outcome,
    hypothesis,
    evidence: evidenceDetails(run, projectRoot, store),
    confidence: rulesAbstain || sparse ? (rulesAbstain ? confidence : "none") : "high",
    abstain: rulesAbstain || Boolean(sparse),
    abstainReason: sparse
      ? `Jira text for ${run.ticket?.id} is not detailed enough to diagnose that issue. ${rulesAbstain ? diagnosis.summary : "A sandbox finding exists only for the seeded scenario and is not evidence about this Jira issue."}`
      : rulesAbstain
        ? diagnosis.summary
        : null,
    rules: diagnosis.rules,
    uncertainties: diagnosis.uncertainties,
    proposal: rulesAbstain ? null : diagnosis.proposal,
    ticketNote,
    sandboxOnly: true,
  };
}

export async function getTicket(id?: string) {
  return resolveTicket(id);
}

export async function measureService(options: {
  ticketId?: string;
  scenario?: "lock" | "outage";
  targetId?: string;
  catalogUrl?: string;
  store?: DemoStore;
  projectRoot?: string;
}) {
  const target = resolveTarget(options.targetId);
  if (!target.ok) {
    return { ok: false as const, message: target.message, ticket: null, run: null };
  }
  let ticket: EngineTicket | null = null;
  if (options.ticketId || options.scenario !== "outage") {
    ticket = await resolveTicket(options.ticketId);
    if (ticket.detail === "unavailable") {
      return {
        ok: false as const,
        message: ticket.disclaimer,
        ticket,
        run: null,
      };
    }
  }
  if (ticket?.sandboxScenario === "ask-for-info") {
    return {
      ok: true as const,
      message: ticket.disclaimer,
      ticket,
      run: null,
      skipped: true as const,
    };
  }
  const scenarioName =
    ticket?.sandboxScenario === "lock" || ticket?.sandboxScenario === "outage"
      ? ticket.sandboxScenario
      : (options.scenario ?? "lock");
  const store = options.store ?? getStore();
  const run = createRun(scenarioName);
  run.ticket = ticket;
  store.runs.set(run.id, run);
  await runInvestigation({
    catalogUrl: options.catalogUrl ?? target.baseUrl,
    store,
    run,
    projectRoot: options.projectRoot,
  });
  return { ok: true as const, message: null, ticket, run, target: target.target, skipped: false as const };
}

export function collectEvidence(runId: string, store = getStore(), projectRoot?: string) {
  const run = store.runs.get(runId);
  if (!run) return { ok: false as const, message: "No investigation with that id is stored in this process.", evidence: [] };
  return {
    ok: true as const,
    message: null,
    evidence: run.evidence.map((item) => {
      const record = store.evidence.get(item.id);
      const body = (record?.body ?? {}) as { path?: string; startLine?: number; endLine?: number };
      return {
        ...item,
        path: item.type === "source" ? body.path : undefined,
        startLine: item.type === "source" ? body.startLine : undefined,
        endLine: item.type === "source" ? body.endLine : undefined,
        projectRoot,
      };
    }),
  };
}

export function diagnoseRun(runId: string, store = getStore(), projectRoot?: string) {
  const run = store.runs.get(runId) ?? null;
  if (!run) {
    return { ok: false as const, message: "No investigation with that id is stored in this process.", diagnosis: presentDiagnosis(null) };
  }
  return { ok: true as const, message: null, diagnosis: presentDiagnosis(run, projectRoot, store) };
}

export function proposeRemediation(runId: string, store = getStore()) {
  const view = diagnoseRun(runId, store);
  if (!view.ok) return { ok: false as const, message: view.message, proposal: null, labeledFallback: false };
  if (view.diagnosis.abstain || !view.diagnosis.proposal) {
    return {
      ok: true as const,
      message: view.diagnosis.abstainReason,
      proposal: null,
      labeledFallback: false,
    };
  }
  const run = store.runs.get(runId);
  const sparse = run?.ticket?.fallback === "seeded-scenario";
  return {
    ok: true as const,
    message: sparse
      ? "This proposal is for the seeded sandbox scenario NI-1042. It is not a proposal for the sparse Jira issue."
      : "Sandbox proposal only. It is not applied.",
    proposal: view.diagnosis.proposal,
    labeledFallback: sparse,
  };
}

export async function applySandboxRemediation(options: {
  runId: string;
  approvalToken?: string;
  catalogUrl?: string;
  store?: DemoStore;
}) {
  const store = options.store ?? getStore();
  const run = store.runs.get(options.runId);
  const gate = assertCanValidate(run, options.approvalToken);
  if (!gate.ok || !run) {
    return { applied: false as const, status: gate.ok ? 400 : gate.status, message: gate.ok ? "Missing run." : gate.message };
  }
  const target = options.catalogUrl ? { ok: true as const, baseUrl: options.catalogUrl } : resolveTarget();
  if (!target.ok) return { applied: false as const, status: 409, message: target.message };
  try {
    await engageRemediatedMode(
      target.baseUrl,
      run,
      "APPLY_SANDBOX_REMEDIATION was supplied for this sandbox process. No external system was written.",
    );
    return { applied: true as const, status: 200, message: "Sandbox catalog mode is remediated. Validation has not been run yet.", runId: run.id };
  } catch (error) {
    return {
      applied: false as const,
      status: 502,
      message: error instanceof Error ? error.message : "The sandbox catalog did not change mode.",
    };
  }
}

export async function validateRemediation(options: { runId: string; catalogUrl?: string; store?: DemoStore }) {
  const store = options.store ?? getStore();
  const run = store.runs.get(options.runId);
  if (!run) return { ok: false as const, message: "No investigation with that id is stored in this process." };
  if (run.diagnosis?.proposal?.status !== "applied_in_sandbox") {
    return {
      ok: false as const,
      message: "Validation stays closed until apply_sandbox_remediation is called with APPLY_SANDBOX_REMEDIATION.",
    };
  }
  const target = options.catalogUrl ? { ok: true as const, baseUrl: options.catalogUrl } : resolveTarget();
  if (!target.ok) return { ok: false as const, message: target.message };
  try {
    await executeValidationLoad(target.baseUrl, run);
    return { ok: true as const, message: run.validationResult?.statement ?? "Validation finished.", run };
  } catch (error) {
    run.validationError = error instanceof Error ? error.message : "Sandbox validation failed.";
    return { ok: false as const, message: run.validationError };
  }
}

export function defaultCatalogUrl() {
  return catalogUrlFromEnv();
}

export function listSteps() {
  return [
    "get_ticket",
    "measure_service",
    "collect_evidence",
    "diagnose",
    "propose_remediation",
    "apply_sandbox_remediation",
    "validate",
  ] as const;
}
