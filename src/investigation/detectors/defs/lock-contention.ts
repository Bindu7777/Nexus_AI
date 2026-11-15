// Detector 1: lock contention. The existing engine logic, unchanged.
//
// It calls the frozen diagnose() in src/lib/diagnosis.ts with the same inputs
// the engine uses, and only translates the result. Thresholds, the abstention
// matrix and the wording all stay in diagnosis.ts. It applies only when load
// measurements exist (the demo catalog, or a service under test emitting the
// same lock telemetry).
import { diagnose } from "../../../lib/diagnosis";
import type { Diagnosis } from "../../../lib/types";
import { defineDetector, type DetectorContext, type Finding } from "../../types";

/** The engine's own diagnosis for these measurements. Exposed so the pipeline can keep the engine's proposal and text. */
export function lockDiagnosis(ctx: DetectorContext): Diagnosis | null {
  if (!ctx.load) return null;
  return diagnose({ ...ctx.load });
}

const RULES = 3;

export default defineDetector({
  id: "lock-contention",
  name: "Lock contention",
  category: "performance",
  requires: ["load_measurements"],
  status: "active",
  applies(ctx) {
    const load = ctx.load;
    if (!load || load.incidentSamples.length === 0) return false;
    // An outage run is judged too: the engine's abstention for it must be preserved.
    return load.scenario === "outage" || load.incidentSamples.some((s) => s.lockWaitMs != null);
  },
  check(ctx) {
    const d = lockDiagnosis(ctx);
    if (!d) return { findings: [], abstained: "No load measurements." };
    if (d.outcome === "service_unavailable" || d.outcome === "insufficient_evidence") {
      return { findings: [], abstained: d.summary };
    }
    const fired = d.rules.filter((r) => r.fired);
    if (fired.length === 0) return { findings: [], abstained: d.summary };
    const byRef = new Map(ctx.evidence.map((e) => [e.ref, e]));
    const evidence = d.citations.map((c) => byRef.get(c.evidenceId)).filter((e): e is NonNullable<typeof e> => Boolean(e));
    const finding: Finding = {
      detectorId: "lock-contention",
      cause: d.title,
      evidence,
      // Score from the engine's own rules: the share that fired. A cause needs all three, as before.
      score: fired.length / RULES,
      threshold: 1,
      rule: "src/lib/diagnosis.ts: p95_latency_regression + exclusive_lock_wait + lock_queue_depth (all must fire)",
      facts: {
        engineOutcome: d.outcome,
        rulesFired: fired.length,
        rulesTotal: RULES,
        ...Object.fromEntries(d.rules.flatMap((r) => [[`${r.id}.fired`, r.fired], [`${r.id}.observed`, r.observed]])),
        proposal: d.proposal ? d.proposal.id : null,
      },
    };
    return { findings: [finding], abstained: d.outcome === "lock_contention" ? null : d.summary };
  },
  explain(finding) {
    return { ...finding.facts, score: finding.score, threshold: finding.threshold };
  },
  proposeFix(finding) {
    if (finding.facts.engineOutcome !== "lock_contention") return null;
    return {
      instructions: "Use the engine's sandbox proposal: move the slow read outside the exclusive lock.",
      allowedFiles: ["services/catalog/server.mjs"],
      constraints: ["Sandbox copy only", "No new dependencies", "No network calls"],
    };
  },
});
