import type {
  Citation,
  Diagnosis,
  Proposal,
  RuleResult,
  RunRecord,
  Sample,
  Summary,
  ValidationResult,
} from "./types";

export const CONFIRMATION_PHRASE = "APPLY_SANDBOX_REMEDIATION";

const METHOD_LABEL = "Rule-based sandbox demonstration — not live model inference" as const;

function baseUncertainties() {
  return [
    "This diagnosis is a deterministic rule set in src/lib/diagnosis.ts. No language model was called, and no model credential is configured.",
    "The ticket shown beside this run is a seeded example. It did not arrive from Jira or any other tracker.",
    "Every latency, lock-wait, queue, log, and trace figure is from this local catalog process on this run. None of them is a production SLO, a customer impact number, or a savings claim.",
    "The catalog is a small original sandbox. The OpenTelemetry Astronomy Shop is not running, and these traces were not imported from it.",
    "The slow read is a timer inside this process. It stands in for an expensive critical section. It is not a profiler capture from a customer system.",
  ];
}

function fmt(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return String(value);
}

export function proposalForSandbox(): Proposal {
  return {
    id: "sandbox-proposal-move-work-outside-lock",
    status: "not_applied",
    title: "Move the catalog read outside the exclusive lock",
    summary:
      "Incident mode holds one exclusive lock for the whole slow read, so overlapping callers queue. The sandbox can instead copy the in-memory product under a short lock and run the same timed read after the lock is released. That is a hypothesis to check in this process. It is not a patch applied to a production repository, and it has not been shown to fix anything outside this demo.",
    sandboxChange:
      "After engineer confirmation, the demo sends POST /admin/mode {\"mode\":\"remediated\"} to the catalog process on 127.0.0.1 only.",
    validationPlan: [
      "Use the same request count, concurrency, timeout, and product mix as the investigation load.",
      "Switch the local catalog to remediated mode only after the confirmation control in this page sends APPLY_SANDBOX_REMEDIATION.",
      "Repeat the load against that local process.",
      "Compare client latency, lock wait, and lock-queue depth with the incident samples kept from this investigation.",
      "Leave the result labeled as a sandbox check. Do not open a pull request, write to a tracker, or deploy.",
    ],
    boundary:
      "Nothing in the catalog process changes until an engineer confirms it here. Reset returns the catalog to baseline mode. The demo has no path that writes outside this machine.",
  };
}

function cite(ids: Set<string>, evidenceId: string, reason: string, citations: Citation[]) {
  if (ids.has(evidenceId)) citations.push({ evidenceId, reason });
}

export function diagnose(input: {
  scenario: "lock" | "outage";
  baseline: Summary | null;
  incident: Summary | null;
  incidentSamples: Sample[];
  evidenceIds: string[];
  warnLogs: { id: string; lockWaitMs: number | null }[];
  workMs: number;
  profile: { requests: number; concurrency: number; timeoutMs: number };
  runId: string;
}): Diagnosis {
  const uncertainties = baseUncertainties();
  const evidenceIds = new Set(input.evidenceIds);
  const profileText = `${input.profile.requests} requests, concurrency ${input.profile.concurrency}, client timeout ${input.profile.timeoutMs} ms, scheduled read ${input.workMs} ms`;

  const unavailable = (summary: Summary | null, reason: string): Diagnosis => ({
    method: "rule-based-sandbox",
    methodLabel: METHOD_LABEL,
    rulesModule: "src/lib/diagnosis.ts",
    outcome: "service_unavailable",
    title: "Catalog did not serve the collection load",
    summary: reason,
    rules: [
      {
        id: "service_responding",
        title: "Enough requests succeed to judge the lock",
        fired: false,
        threshold: "Fewer than 80% of incident requests fail",
        observed: summary
          ? `${summary.errors} of ${summary.requests} requests failed (${summary.timeouts} timeouts).`
          : "No incident summary was recorded.",
      },
      {
        id: "exclusive_lock_wait",
        title: "Incident lock wait is materially above baseline",
        fired: false,
        threshold: "Not applied when the service is mostly failing",
        observed: "Lock-contention rules were not applied.",
      },
    ],
    citations: [],
    uncertainties: [
      ...uncertainties,
      "A lock-contention finding would be the wrong conclusion while the process is refusing or dropping most calls. No remediation is proposed.",
    ],
    proposal: null,
  });

  if (input.scenario === "outage") {
    const diagnosis = unavailable(
      input.incident,
      input.incident
        ? `The outage control put the local catalog into unavailable mode, then the demo issued ${profileText}. ${input.incident.errors} of ${input.incident.requests} requests failed. This is a sandbox fault you armed, not a lock-contention diagnosis.`
        : "The outage scenario did not record a summary.",
    );
    const citations: Citation[] = [];
    cite(evidenceIds, `metric:${input.runId}:incident`, "Aggregate of the requests issued while the catalog was unavailable.", citations);
    for (const sample of input.incidentSamples.filter((item) => item.logId).slice(0, 2)) {
      cite(
        evidenceIds,
        `log:${input.runId}:${sample.logId}`,
        `Request ${sample.productId} ended with ${sample.error ?? `HTTP ${sample.status}`}.`,
        citations,
      );
    }
    diagnosis.citations = citations;
    return diagnosis;
  }

  if (
    !input.baseline ||
    !input.incident ||
    input.baseline.requests < 8 ||
    input.incident.requests < 8
  ) {
    return {
      method: "rule-based-sandbox",
      methodLabel: METHOD_LABEL,
      rulesModule: "src/lib/diagnosis.ts",
      outcome: "insufficient_evidence",
      title: "Not enough sandbox samples to apply the rules",
      summary: `The lock rules require at least 8 baseline requests and 8 incident requests. This run recorded ${input.baseline?.requests ?? 0} baseline and ${input.incident?.requests ?? 0} incident requests. No remediation is proposed.`,
      rules: [
        {
          id: "sample_size",
          title: "Both phases collected at least 8 requests",
          fired: false,
          threshold: "baseline requests >= 8 and incident requests >= 8",
          observed: `Baseline ${input.baseline?.requests ?? 0}, incident ${input.incident?.requests ?? 0}.`,
        },
      ],
      citations: [],
      uncertainties,
      proposal: null,
    };
  }

  const incidentErrorRate = input.incident.errors / input.incident.requests;
  if (incidentErrorRate >= 0.8) {
    return unavailable(
      input.incident,
      `The incident load (${profileText}) failed ${input.incident.errors} of ${input.incident.requests} requests. The lock rules stop here so a down process is not described as lock contention.`,
    );
  }

  const baseP95 = input.baseline.latencyMs?.p95 ?? null;
  const incP95 = input.incident.latencyMs?.p95 ?? null;
  const baseWait = input.baseline.lockWaitMs?.mean ?? null;
  const incWait = input.incident.lockWaitMs?.mean ?? null;
  const baseQueue = input.baseline.maxQueueDepth;
  const incQueue = input.incident.maxQueueDepth;

  const p95Fired =
    baseP95 != null && incP95 != null && incP95 >= baseP95 * 2 && incP95 - baseP95 >= 40;
  const waitFired = baseWait != null && incWait != null && incWait >= 25 && incWait >= Math.max(5, baseWait * 4);
  const queueFired = incQueue != null && incQueue >= 3 && (baseQueue == null || incQueue > baseQueue);

  const rules: RuleResult[] = [
    {
      id: "p95_latency_regression",
      title: "Incident p95 client latency is at least double the baseline and 40 ms higher",
      fired: p95Fired,
      threshold: "incident p95 >= baseline p95 × 2 and incident p95 − baseline p95 >= 40 ms",
      observed: `Baseline p95 ${fmt(baseP95)} ms, incident p95 ${fmt(incP95)} ms.`,
    },
    {
      id: "exclusive_lock_wait",
      title: "Incident mean lock wait is at least 25 ms and at least 4× the baseline",
      fired: waitFired,
      threshold: "incident mean lock wait >= 25 ms and >= max(5 ms, baseline mean × 4)",
      observed: `Baseline mean lock wait ${fmt(baseWait)} ms, incident mean lock wait ${fmt(incWait)} ms.`,
    },
    {
      id: "lock_queue_depth",
      title: "Incident lock queue reaches at least 3 waiters and exceeds baseline",
      fired: queueFired,
      threshold: "incident max lock waiters >= 3 and greater than baseline",
      observed: `Baseline max lock waiters ${fmt(baseQueue)}, incident max lock waiters ${fmt(incQueue)}.`,
    },
  ];

  const citations: Citation[] = [];
  cite(
    evidenceIds,
    `metric:${input.runId}:baseline`,
    "Aggregate computed from the baseline load samples.",
    citations,
  );
  cite(
    evidenceIds,
    `metric:${input.runId}:incident`,
    "Aggregate computed from the incident load samples.",
    citations,
  );
  cite(
    evidenceIds,
    `source:${input.runId}:readProduct`,
    "The catalog read function as it was read from services/catalog/server.mjs for this run.",
    citations,
  );

  const ranked = [...input.incidentSamples]
    .filter((sample) => sample.traceId && sample.lockWaitMs != null)
    .sort((a, b) => (b.lockWaitMs ?? 0) - (a.lockWaitMs ?? 0))
    .slice(0, 3);
  for (const sample of ranked) {
    cite(
      evidenceIds,
      `trace:${sample.traceId}`,
      `Incident trace for ${sample.productId}: lock wait ${sample.lockWaitMs} ms, client latency ${sample.latencyMs} ms, lock waiters at acquire ${sample.queueDepth}.`,
      citations,
    );
  }

  const warnLogs = [...input.warnLogs].sort((a, b) => (b.lockWaitMs ?? 0) - (a.lockWaitMs ?? 0)).slice(0, 2);
  for (const log of warnLogs) {
    cite(
      evidenceIds,
      `log:${input.runId}:${log.id}`,
      `Warn log recorded by the catalog. Lock wait field ${fmt(log.lockWaitMs)} ms.`,
      citations,
    );
  }

  if (p95Fired && waitFired && queueFired) {
    return {
      method: "rule-based-sandbox",
      methodLabel: METHOD_LABEL,
      rulesModule: "src/lib/diagnosis.ts",
      outcome: "lock_contention",
      title: "Exclusive catalog lock is serializing overlapping reads",
      summary: `Under the same load (${profileText}), incident p95 client latency was ${fmt(incP95)} ms and baseline p95 was ${fmt(baseP95)} ms. Mean lock wait was ${fmt(incWait)} ms in the incident samples and ${fmt(baseWait)} ms in the baseline samples. The deepest incident lock queue was ${fmt(incQueue)} waiters. All three rules fired. They point at the read path that holds the exclusive lock for the ${input.workMs} ms timer.`,
      rules,
      citations,
      uncertainties: [
        ...uncertainties,
        "The same timer runs in baseline mode, outside the lock. The comparison isolates lock placement. It does not measure a second, unknown production bug.",
        "Approving the proposal only flips this sandbox process to the outside-lock placement and reruns the load. That check is not a production verification.",
      ],
      proposal: proposalForSandbox(),
    };
  }

  const missed = rules.filter((rule) => !rule.fired).map((rule) => rule.title);
  return {
    method: "rule-based-sandbox",
    methodLabel: METHOD_LABEL,
    rulesModule: "src/lib/diagnosis.ts",
    outcome: "no_signal",
    title: "The lock-contention rules did not all fire",
    summary: `The catalog answered the load (${profileText}), but at least one rule missed: ${missed.join(" ")} No remediation is proposed from this run.`,
    rules,
    citations,
    uncertainties: [
      ...uncertainties,
      "A partial pattern is not treated as a diagnosis. Rerun the scenario if you want a fresh pair of loads.",
    ],
    proposal: null,
  };
}

export function interpretValidation(incident: Summary, validation: Summary): ValidationResult {
  const incWait = incident.lockWaitMs?.mean ?? null;
  const valWait = validation.lockWaitMs?.mean ?? null;
  const waitPassed = incWait != null && valWait != null && valWait <= incWait * 0.5;
  const incP95 = incident.latencyMs?.p95 ?? null;
  const valP95 = validation.latencyMs?.p95 ?? null;
  const p95Passed = incP95 != null && valP95 != null && valP95 <= incP95 * 0.75;
  const queuePassed =
    incident.maxQueueDepth != null &&
    validation.maxQueueDepth != null &&
    validation.maxQueueDepth < incident.maxQueueDepth;
  const successRate = validation.requests === 0 ? 0 : validation.success / validation.requests;
  const successPassed = successRate >= 0.9;

  const checks = [
    {
      id: "validation_succeeded",
      title: "At least 90% of remediated-sandbox requests succeeded",
      passed: successPassed,
      observed: `${validation.success} of ${validation.requests} succeeded.`,
    },
    {
      id: "lock_wait_dropped",
      title: "Mean lock wait is at most half the incident mean",
      passed: waitPassed,
      observed: `Incident mean ${fmt(incWait)} ms, remediated sandbox mean ${fmt(valWait)} ms.`,
    },
    {
      id: "p95_dropped",
      title: "p95 client latency is at most 75% of the incident p95",
      passed: p95Passed,
      observed: `Incident p95 ${fmt(incP95)} ms, remediated sandbox p95 ${fmt(valP95)} ms.`,
    },
    {
      id: "queue_shallower",
      title: "Max lock waiters is lower than in the incident run",
      passed: queuePassed,
      observed: `Incident max waiters ${fmt(incident.maxQueueDepth)}, remediated sandbox max waiters ${fmt(validation.maxQueueDepth)}.`,
    },
  ];

  const outcome = checks.every((check) => check.passed) ? "sandbox_improved" : "inconclusive";
  return {
    method: "rule-based-sandbox",
    outcome,
    checks,
    statement:
      outcome === "sandbox_improved"
        ? "On this sandbox run, remediated mode was lower on p95 client latency, mean lock wait, and max lock waiters than the incident run, with requests succeeding. That checks the lock-placement hypothesis in this process only. It is not evidence of a production fix."
        : "The sandbox check did not pass every comparison with the incident run. The proposal is not established, including inside this demo.",
  };
}

export function assertCanValidate(
  run: RunRecord | undefined,
  confirmation: unknown,
): { ok: true } | { ok: false; status: number; message: string } {
  if (!run) {
    return { ok: false, status: 404, message: "No investigation with that id is stored in this demo session." };
  }
  if (run.status === "running" || run.status === "validating") {
    return { ok: false, status: 409, message: "A sandbox run is already in progress." };
  }
  if (run.status === "failed" || !run.diagnosis) {
    return { ok: false, status: 409, message: "Validation stays closed until a diagnosis is recorded." };
  }
  if (run.diagnosis.outcome !== "lock_contention" || !run.diagnosis.proposal) {
    return { ok: false, status: 409, message: "This outcome has no sandbox remediation to apply." };
  }
  if (confirmation !== CONFIRMATION_PHRASE) {
    return {
      ok: false,
      status: 400,
      message: "Engineer confirmation is required before the sandbox applies a behavior change.",
    };
  }
  return { ok: true };
}
