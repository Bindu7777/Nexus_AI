// Shared types for the reproduce-first investigation pipeline.
//
// EvidenceItem is the one evidence type used by connectors, detectors and
// reports (defined in connectors/types.ts; re-exported here). Detectors decide
// findings with code: a score is computed from the evidence, never taken from
// a model.
import type { EvidenceItem } from "../../connectors/types";
import type { Sample, Summary } from "../lib/types";

export type { EvidenceItem };

// ---------- verdicts ----------

export const VERDICTS = {
  diagnosed_verified: {
    label: "Diagnosed and verified",
    description: "A cause was found and a fix was proven: the reproduction failed before the patch and passed after, and the existing tests passed.",
    requires: ["reproduction", "finding", "patch", "proof"],
  },
  diagnosed: {
    label: "Diagnosed (not verified)",
    description: "A detector found a cause supported by evidence, but no fix has been proven yet.",
    requires: ["finding"],
  },
  not_reproduced: {
    label: "Not reproduced",
    description: "The defect could not be reproduced. Static evidence is shown, with what is missing.",
    requires: ["reproductionAttempt"],
  },
  not_enough_evidence: {
    label: "Not enough evidence",
    description: "No detector found a cause that passes its threshold. The evidence collected and what is missing are shown.",
    requires: ["evidenceSummary"],
  },
  needs_more_information: {
    label: "Needs more information",
    description: "The ticket is too vague to investigate. It lists exactly what to add.",
    requires: ["missingFields"],
  },
  failed: {
    label: "Failed",
    description: "The investigation could not complete. The failing stage and its error are shown.",
    requires: ["failedStage"],
  },
} as const;
export type Verdict = keyof typeof VERDICTS;

// ---------- detector inputs ----------

/** Kinds of evidence a detector can require. A detector runs only when all of them exist. */
export type EvidenceKind = "reproduction" | "commits" | "schema" | "query_stats" | "logs" | "load_measurements" | "located_code" | "first_report";

/**
 * Load measurements from the demo catalog path, exactly as the frozen engine's
 * diagnose() consumes them. Only the demo, or a service under test that emits
 * the same lock telemetry, produces these.
 */
export type LoadMeasurements = {
  scenario: "lock" | "outage";
  baseline: Summary | null;
  incident: Summary | null;
  incidentSamples: Sample[];
  /** Engine evidence ids (metric:, trace:, log:, source:) recorded for this run. */
  evidenceIds: string[];
  warnLogs: { id: string; lockWaitMs: number | null }[];
  workMs: number;
  profile: { requests: number; concurrency: number; timeoutMs: number };
  runId: string;
};

export type ReproductionResult = {
  runs: number;
  passes: number;
  /** True when the defect showed up: the assertion that encodes the bug failed. */
  reproduced: boolean;
  assertions: { name: string; expected: string; actual: string; passed: boolean }[];
  scriptRef: string;
};

export type DetectorContext = {
  investigationId: string;
  evidence: EvidenceItem[];
  load?: LoadMeasurements;
  reproduction?: ReproductionResult;
  firstReportedAt?: string;
  /** Code locations chosen by the Locate stage. */
  located?: { path: string; startLine: number; endLine: number; reason: string }[];
};

// ---------- findings ----------

export type Finding = {
  detectorId: string;
  /** One-sentence cause statement, built from fixed text and observed values. */
  cause: string;
  evidence: EvidenceItem[];
  /** 0..1, computed by code from which required signals fired. */
  score: number;
  /** Score at or above which the finding counts as a cause; below it is a weak lead. */
  threshold: number;
  /** The rule or check that produced the finding. */
  rule: string;
  /** Plain structured facts for reports and the narrator. No free-text claims. */
  facts: Record<string, string | number | boolean | null>;
};

export type DetectorResult = { findings: Finding[]; abstained: string | null };

export type FixPrompt = { instructions: string; allowedFiles: string[]; constraints: string[] };

export interface Detector {
  readonly id: string;
  readonly name: string;
  readonly category: "performance" | "reproduction" | "change" | "database" | "configuration" | "dependency";
  readonly requires: EvidenceKind[];
  /** Placeholders are registered but never run. */
  readonly status: "active" | "placeholder";
  /** True only when every input the detector needs is present. */
  applies(ctx: DetectorContext): boolean;
  /** Findings, or an abstention reason when the detector ran and declined to name a cause. */
  check(ctx: DetectorContext): DetectorResult;
  explain(finding: Finding): Record<string, string | number | boolean | null>;
  proposeFix?(finding: Finding): FixPrompt | null;
}

export function defineDetector<T extends Detector>(d: T): T {
  return d;
}
