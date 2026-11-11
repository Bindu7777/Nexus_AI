import type { DiagnosisView } from "./engine";

const FORBIDDEN = [
  /\b\d+(?:\.\d+)?\s*%\s*(?:faster|savings|reduction|improvement|cheaper)/i,
  /proven production/i,
  /production[- ]ready/i,
  /astronomy shop is running/i,
];

export function checkNarrative(text: string, view: Pick<DiagnosisView, "abstain" | "outcome">) {
  const notes: string[] = [];
  for (const pattern of FORBIDDEN) {
    if (pattern.test(text)) {
      notes.push(`The model text includes a claim this sandbox does not make (${pattern.source}).`);
    }
  }
  if (view.abstain && /confirmed (?:root cause|lock contention)|definite root cause|production cause/i.test(text)) {
    notes.push("The rule set abstained, and the model text states a confirmed cause.");
  }
  if (!view.abstain && view.outcome === "lock_contention" && /not lock contention|no lock contention|rules did not fire/i.test(text)) {
    notes.push("The sandbox rules found lock contention, and the model text denies that finding.");
  }
  return { aligned: notes.length === 0, notes };
}

export function narrativePrompt(view: DiagnosisView) {
  return [
    "Write a short engineer-facing narrative from the JSON below.",
    "Use only those fields. Do not invent metrics, traces, or a customer impact number.",
    "Do not claim a production fix, a percentage saving, or that the OpenTelemetry Astronomy Shop is running.",
    "If abstain is true, say the rules abstained and quote abstainReason. Do not turn a sparse Jira issue into a root cause.",
    "The rule-based result remains the guardrail. Your paragraph is a narrative, not a second diagnosis.",
    JSON.stringify(view),
  ].join("\n");
}
