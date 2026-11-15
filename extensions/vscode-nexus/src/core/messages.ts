// Messages from the report webview. The webview renders untrusted text, so
// every message is checked here before the extension acts on it: only known
// actions, and only files and lines the report itself cites.
import type { IdeReport } from "../../../../src/ide/machine";

export type WebviewMessage =
  | { type: "openLocation"; path: string; start: number; end: number }
  | { type: "openDiff" }
  | { type: "approve" }
  | { type: "reject" }
  | { type: "savePatch" }
  | { type: "copyPatch" }
  | { type: "apply" }
  | { type: "feedback"; correct: boolean; note: string }
  | { type: "refresh" }
  | { type: "openChat" }
  | { type: "continueWithout" }
  | { type: "openReport" };

/** Every repository path the report cites. */
export function citedPaths(report: Pick<IdeReport, "located" | "evidence" | "suggestedFix">): Set<string> {
  const out = new Set<string>();
  for (const l of report.located) out.add(l.path);
  for (const e of report.evidence) if (e.location?.path) out.add(e.location.path);
  if (report.suggestedFix?.path) out.add(report.suggestedFix.path);
  return out;
}

const SIMPLE = new Set(["openDiff", "approve", "reject", "savePatch", "copyPatch", "apply", "refresh", "openChat", "continueWithout", "openReport"]);

export function validateMessage(raw: unknown, report: Pick<IdeReport, "located" | "evidence" | "suggestedFix"> | null): WebviewMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.type !== "string") return null;
  if (SIMPLE.has(m.type)) return { type: m.type } as WebviewMessage;
  if (m.type === "openLocation") {
    if (!report || typeof m.path !== "string" || !citedPaths(report).has(m.path)) return null;
    if (/^(\/|\.\.)|\/\.\.\//.test(m.path)) return null;
    const start = Number(m.start);
    const end = Number(m.end);
    const okLine = (n: number) => Number.isInteger(n) && n >= 1 && n <= 1_000_000;
    if (!okLine(start) || !okLine(end) || end < start) return { type: "openLocation", path: m.path, start: 1, end: 1 };
    return { type: "openLocation", path: m.path, start, end };
  }
  if (m.type === "feedback") {
    if (typeof m.correct !== "boolean") return null;
    return { type: "feedback", correct: m.correct, note: typeof m.note === "string" ? m.note.slice(0, 500) : "" };
  }
  return null;
}
