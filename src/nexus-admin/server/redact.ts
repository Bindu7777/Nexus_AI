// One place that strips secrets from anything that might be logged, stored in
// the audit log, or returned in an error. Used by audit.ts and every API route.

const SECRET_KEYS = /(secret|token|password|passwd|pwd|api[_-]?key|authorization|cookie|connection[_-]?string|private[_-]?key|credential)/i;

const PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{16,}/g, // GitLab
  /xox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /ATATT[A-Za-z0-9_=-]{20,}/g, // Atlassian API token
  /sbp_[A-Za-z0-9]{20,}/g, // Supabase access token
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(postgres(?:ql)?|mysql|mssql|sqlserver|oracle):\/\/[^:\s/]+:[^@\s]+@/gi, // credentials inside URLs
  /\b([a-z][a-z0-9+.-]*:\/\/)[^:@\s/]+:[^@\s/]+@/gi,
];

/** Extra values to scrub (for example, the secret currently being tested). */
export function redactText(text: string, extra: Array<string | null | undefined> = []): string {
  let out = text;
  for (const value of extra) {
    if (value && value.length >= 4) out = out.split(value).join("[redacted]");
  }
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match) => {
      const urlCred = match.match(/^([a-z][a-z0-9+.-]*:\/\/)/i);
      return urlCred ? `${urlCred[1]}[redacted]@` : "[redacted]";
    });
  }
  return out;
}

export function redactValue(value: unknown, extra: Array<string | null | undefined> = [], depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return redactText(value, extra);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, extra, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) && v != null && v !== "" && typeof v !== "boolean" ? "[redacted]" : redactValue(v, extra, depth + 1);
    }
    return out;
  }
  return value;
}

/** Last four characters at most; never the whole value. */
export function maskSecret(secret: string | null | undefined) {
  if (!secret) return "";
  return secret.length <= 8 ? "••••" : `••••${secret.slice(-4)}`;
}
