// Detector registry and ranking. Definitions come from ./defs through the
// generated index (npm run connectors:index rebuilds both indexes).
import { type Detector, type DetectorContext, type DetectorResult, EVIDENCE_KIND_LABEL, type Finding } from "../types";
import { DETECTORS } from "./index.generated";

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const ALLOWED_DETECTOR_FUNCTIONS = new Set(["applies", "check", "explain", "proposeFix"]);

export function checkDetector(d: Detector) {
  const where = `Detector "${d?.id ?? "?"}"`;
  if (!d || typeof d !== "object") throw new Error("A detector file must default-export defineDetector({...}).");
  if (!ID.test(d.id)) throw new Error(`${where}: id must be lowercase letters, digits and dashes.`);
  if (!d.name) throw new Error(`${where}: name is required.`);
  if (!Array.isArray(d.requires) || d.requires.length === 0) throw new Error(`${where}: requires must list the evidence it needs.`);
  for (const fn of ["applies", "check", "explain"] as const) {
    if (typeof d[fn] !== "function") throw new Error(`${where}: ${fn}() is required.`);
  }
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === "function" && !ALLOWED_DETECTOR_FUNCTIONS.has(k)) throw new Error(`${where}: unexpected function "${k}".`);
  }
}

export function createDetectorRegistry(detectors: Detector[]) {
  const byId = new Map<string, Detector>();
  for (const d of detectors) {
    checkDetector(d);
    if (byId.has(d.id)) throw new Error(`Two detectors use the id "${d.id}".`);
    byId.set(d.id, d);
  }
  return { all: () => [...byId.values()], get: (id: string) => byId.get(id) };
}
export type DetectorRegistry = ReturnType<typeof createDetectorRegistry>;

let current: DetectorRegistry | null = null;
export function detectorRegistry() {
  current ??= createDetectorRegistry(DETECTORS);
  return current;
}

export type DetectorRun = {
  detectorId: string;
  name: string;
  status: "ran" | "skipped" | "placeholder" | "error";
  reason: string | null;
  result: DetectorResult | null;
};

/** Runs every applicable detector. A detector whose inputs are missing is skipped, never run. */
export function runDetectors(ctx: DetectorContext, registry: DetectorRegistry = detectorRegistry()): DetectorRun[] {
  return registry.all().map((d) => {
    if (d.status === "placeholder") return { detectorId: d.id, name: d.name, status: "placeholder", reason: "Not built yet.", result: null };
    let applies = false;
    try {
      applies = d.applies(ctx);
    } catch (error) {
      return { detectorId: d.id, name: d.name, status: "error", reason: error instanceof Error ? error.message : String(error), result: null };
    }
    if (!applies) {
      const needs = d.requires.map((r) => EVIDENCE_KIND_LABEL[r] ?? r);
      return { detectorId: d.id, name: d.name, status: "skipped", reason: `It needs ${needs.join(" and ")}, which this investigation does not have.`, result: null };
    }
    try {
      return { detectorId: d.id, name: d.name, status: "ran", reason: null, result: d.check(ctx) };
    } catch (error) {
      return { detectorId: d.id, name: d.name, status: "error", reason: error instanceof Error ? error.message : String(error), result: null };
    }
  });
}

export type RankedFinding = Finding & { rank: number; kind: "cause" | "weak_lead"; tiedWith: string[] };

/**
 * Ranks findings by score. Scores are never averaged across detectors. A
 * finding below its own threshold is a weak lead, not a cause. Equal scores
 * are reported as a tie on both sides.
 */
export function rankFindings(runs: DetectorRun[]): RankedFinding[] {
  const findings = runs.flatMap((r) => r.result?.findings ?? []);
  const sorted = [...findings].sort((a, b) => b.score - a.score || a.detectorId.localeCompare(b.detectorId));
  return sorted.map((f, i) => {
    const kind = f.score >= f.threshold ? "cause" : "weak_lead";
    const tiedWith = sorted.filter((o) => o !== f && o.score === f.score && (o.score >= o.threshold) === (kind === "cause")).map((o) => o.detectorId);
    return { ...f, rank: i + 1, kind, tiedWith };
  });
}
