// Redaction for evidence submitted by the IDE agent, applied before anything
// is stored. Builds on the shared secret patterns and adds personal-data
// patterns. Returns counts by kind so a redaction can be logged without the
// value itself.
import { redactText } from "../nexus-admin/server/redact";

export type RedactionCount = { kind: string; count: number };

/** Luhn check, so long numbers such as epoch-millisecond timestamps are kept. */
function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** A replace function returning null keeps the match and does not count it. */
const EXTRA: { kind: string; pattern: RegExp; replace: string | ((m: string, ...g: string[]) => string | null) }[] = [
  { kind: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: "[redacted private key]" },
  {
    kind: "assigned-secret",
    pattern: /\b((?:[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth)[A-Za-z0-9_-]*)(\s*[:=]\s*)(["']?)([^\s"',;]{6,})\3/gi,
    replace: (_m, name: string, sep: string, q: string) => `${name}${sep}${q}[redacted]${q}`,
  },
  { kind: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: "[email]" },
  {
    kind: "card-number",
    pattern: /\b(?:\d[ -]?){12,18}\d\b/g,
    replace: (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhn(digits) && !/^1[6-9]\d{11}$/.test(digits) ? "[number]" : null;
    },
  },
  { kind: "phone", pattern: /(?<![\w.])\+?\d{1,3}[ .-]?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, replace: "[phone]" },
];

/** Redact secrets and personal data in one text. */
export function redactEvidenceText(text: string, extra: string[] = []): { text: string; redactions: RedactionCount[] } {
  const counts = new Map<string, number>();
  const bump = (k: string, n = 1) => counts.set(k, (counts.get(k) ?? 0) + n);
  let out = text;
  for (const r of EXTRA) {
    out = out.replace(r.pattern, (...args: unknown[]) => {
      const [m, ...groups] = args as string[];
      const next = typeof r.replace === "string" ? r.replace : r.replace(m, ...groups);
      if (next === null) return m;
      bump(r.kind);
      return next;
    });
  }
  const before = (out.match(/\[redacted\]/g) ?? []).length;
  out = redactText(out, extra);
  const added = (out.match(/\[redacted\]/g) ?? []).length - before;
  if (added > 0) bump("token", added);
  return { text: out, redactions: [...counts].map(([kind, count]) => ({ kind, count })) };
}

export function mergeCounts(a: RedactionCount[], b: RedactionCount[]): RedactionCount[] {
  const m = new Map<string, number>();
  for (const r of [...a, ...b]) m.set(r.kind, (m.get(r.kind) ?? 0) + r.count);
  return [...m].map(([kind, count]) => ({ kind, count }));
}

// ---------- display only ----------

const INSTRUCTION_LIKE = [
  /\bignore (?:all |any |the )?(?:previous|prior|above|earlier|your)? ?(?:instructions|rules|prompts?)\b/i,
  /\b(?:disregard|forget|override) (?:all |the |your )?(?:previous |prior )?(?:instructions|rules|guardrails|system prompt)\b/i,
  /\byou are now\b/i,
  /\b(?:system|developer) (?:prompt|message|instructions?)\b/i,
  /\b(?:call|run|invoke|use) (?:the )?(?:tool|function)\b/i,
  /\bnexus_(?:approve|reject|submit_evidence|start_investigation|cancel)\b/i,
  /\bAPPLY_SANDBOX_REMEDIATION\b/,
  /\b(?:skip|bypass) (?:the )?(?:approval|review|confirmation)\b/i,
  /\b(?:push|commit|merge|delete|drop table|force[- ]push)\b.*\b(?:now|immediately|without)\b/i,
];

export function looksLikeInstruction(line: string): boolean {
  return INSTRUCTION_LIKE.some((p) => p.test(line));
}

/**
 * For display only: marks each instruction-like line as data. The stored
 * evidence is not changed, and nothing here is ever executed or followed.
 */
export function neutraliseForDisplay(text: string): { text: string; flagged: number } {
  let flagged = 0;
  const lines = text.split("\n").map((line) => {
    if (!looksLikeInstruction(line)) return line;
    flagged += 1;
    return `[instruction-like text, shown as data only] ${line}`;
  });
  return { text: lines.join("\n"), flagged };
}
