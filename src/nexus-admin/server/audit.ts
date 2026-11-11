// Persistent, append-only audit log. Every entry passes through redaction.
import { getDb, nowIso } from "./db";
import { redactText, redactValue } from "./redact";

export type Actor = { type: "nexus_admin" | "company_user" | "system" | "anonymous"; id?: number | null; label: string };
export type AuditResult = "ok" | "fail" | "denied" | "info";

export type AuditInput = {
  actor: Actor;
  action: string;
  result: AuditResult;
  companyId?: number | null;
  target?: string;
  ip?: string | null;
  detail?: Record<string, unknown>;
  /** Values that must never appear, e.g. the secret just saved. */
  scrub?: Array<string | null | undefined>;
};

export function audit(entry: AuditInput) {
  const detail = redactValue(entry.detail ?? {}, entry.scrub ?? []);
  getDb()
    .prepare(
      `INSERT INTO audit_log (at, actor_type, actor_id, actor_label, company_id, action, target, result, ip, detail_json)
       VALUES (@at, @actor_type, @actor_id, @actor_label, @company_id, @action, @target, @result, @ip, @detail_json)`,
    )
    .run({
      at: nowIso(),
      actor_type: entry.actor.type,
      actor_id: entry.actor.id ?? null,
      actor_label: redactText(entry.actor.label, entry.scrub),
      company_id: entry.companyId ?? null,
      action: entry.action,
      target: redactText(entry.target ?? "", entry.scrub),
      result: entry.result,
      ip: entry.ip ?? null,
      detail_json: JSON.stringify(detail),
    });
  if (entry.companyId) {
    getDb().prepare("UPDATE companies SET last_activity_at = ? WHERE id = ?").run(nowIso(), entry.companyId);
  }
}

export type AuditRow = {
  id: number;
  at: string;
  actor_type: string;
  actor_label: string;
  company_id: number | null;
  company_name: string | null;
  action: string;
  target: string;
  result: AuditResult;
  ip: string | null;
  detail_json: string;
};

export type AuditFilter = {
  companyId?: number;
  action?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export const ACTION_GROUPS: Record<string, string> = {
  "auth.": "Sign-ins",
  "company.": "Companies",
  "connection.": "Connections",
  "onboarding.": "Onboarding",
  "user.": "Company logins",
  "settings.": "Settings",
};

export function queryAudit(filter: AuditFilter) {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.companyId) {
    where.push("a.company_id = @companyId");
    params.companyId = filter.companyId;
  }
  if (filter.action) {
    where.push("a.action LIKE @action");
    params.action = `${filter.action}%`;
  }
  if (filter.from) {
    where.push("a.at >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("a.at <= @to");
    params.to = filter.to.length === 10 ? `${filter.to}T23:59:59.999Z` : filter.to;
  }
  if (filter.q) {
    where.push("(a.action LIKE @q OR a.target LIKE @q OR a.actor_label LIKE @q OR c.name LIKE @q OR a.detail_json LIKE @q)");
    params.q = `%${filter.q}%`;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 5000);
  const page = Math.max(filter.page ?? 1, 1);
  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) n FROM audit_log a LEFT JOIN companies c ON c.id = a.company_id ${clause}`).get(params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT a.id, a.at, a.actor_type, a.actor_label, a.company_id, c.name AS company_name, a.action, a.target, a.result, a.ip, a.detail_json
       FROM audit_log a LEFT JOIN companies c ON c.id = a.company_id ${clause}
       ORDER BY a.id DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as AuditRow[];
  return { rows, total, page, pageSize };
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function auditCsv(rows: AuditRow[]) {
  const header = ["time", "actor", "company", "action", "target", "result", "ip", "detail"];
  const lines = rows.map((r) =>
    [r.at, r.actor_label, r.company_name ?? "", r.action, r.target, r.result, r.ip ?? "", redactText(r.detail_json)].map(csvCell).join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
