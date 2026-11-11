import { audit, type Actor } from "./audit";
import { getDb, nowIso } from "./db";
import { revokeCompanySessions } from "./sessions";

export type CompanyStatus = "draft" | "connected" | "active" | "paused";

export type CompanyRow = {
  id: number;
  name: string;
  short_code: string;
  contact_name: string;
  contact_email: string;
  country: string;
  notes: string;
  status: CompanyStatus;
  status_before_pause: CompanyStatus | null;
  onboarding_step: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
};

export type CompanyDetails = Pick<CompanyRow, "name" | "short_code" | "contact_name" | "contact_email" | "country" | "notes">;

export function validateDetails(input: Partial<Record<keyof CompanyDetails, unknown>>) {
  const errors: Partial<Record<keyof CompanyDetails, string>> = {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const details: CompanyDetails = {
    name: str(input.name, 120),
    short_code: str(input.short_code, 16).toUpperCase(),
    contact_name: str(input.contact_name, 120),
    contact_email: str(input.contact_email, 200),
    country: str(input.country, 80),
    notes: str(input.notes, 2000),
  };
  if (!details.name) errors.name = "Enter the company name.";
  if (!/^[A-Z0-9][A-Z0-9-]{1,15}$/.test(details.short_code)) errors.short_code = "Use 2 to 16 letters, digits or dashes, for example ACME.";
  if (!details.contact_name) errors.contact_name = "Enter a primary contact.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(details.contact_email)) errors.contact_email = "Enter a valid email address.";
  return { details, errors };
}

export function listCompanies(q = "") {
  const like = `%${q.trim()}%`;
  return getDb()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM company_connections x WHERE x.company_id = c.id AND x.status = 'ok') AS ok_count,
        (SELECT COUNT(*) FROM company_connections x WHERE x.company_id = c.id AND x.status = 'failed') AS failed_count,
        (SELECT COUNT(*) FROM company_connections x WHERE x.company_id = c.id) AS conn_count
       FROM companies c
       WHERE c.name LIKE @like OR c.short_code LIKE @like
       ORDER BY c.last_activity_at DESC`,
    )
    .all({ like }) as (CompanyRow & { ok_count: number; failed_count: number; conn_count: number })[];
}

export function getCompany(id: number) {
  return getDb().prepare("SELECT * FROM companies WHERE id = ?").get(id) as CompanyRow | undefined;
}

export function getCompanyByCode(code: string) {
  return getDb().prepare("SELECT * FROM companies WHERE short_code = ?").get(code.trim().toUpperCase()) as CompanyRow | undefined;
}

export function createCompany(details: CompanyDetails, actor: Actor, ip: string) {
  const now = nowIso();
  if (getCompanyByCode(details.short_code)) throw new Error(`The short code ${details.short_code} is already used by another company.`);
  const info = getDb()
    .prepare(
      `INSERT INTO companies (name, short_code, contact_name, contact_email, country, notes, status, onboarding_step, created_at, updated_at, last_activity_at)
       VALUES (@name, @short_code, @contact_name, @contact_email, @country, @notes, 'draft', 'code', @now, @now, @now)`,
    )
    .run({ ...details, now });
  const id = Number(info.lastInsertRowid);
  audit({ actor, action: "onboarding.company_created", result: "ok", companyId: id, target: details.name, ip, detail: { short_code: details.short_code } });
  return id;
}

export function updateCompany(id: number, details: CompanyDetails, actor: Actor, ip: string) {
  const other = getCompanyByCode(details.short_code);
  if (other && other.id !== id) throw new Error(`The short code ${details.short_code} is already used by another company.`);
  getDb()
    .prepare(
      `UPDATE companies SET name=@name, short_code=@short_code, contact_name=@contact_name, contact_email=@contact_email,
       country=@country, notes=@notes, updated_at=@now WHERE id=@id`,
    )
    .run({ ...details, id, now: nowIso() });
  audit({ actor, action: "onboarding.details_saved", result: "ok", companyId: id, target: details.name, ip });
}

export function setOnboardingStep(id: number, step: string) {
  getDb().prepare("UPDATE companies SET onboarding_step = ?, updated_at = ? WHERE id = ?").run(step, nowIso(), id);
}

/** Recomputes draft/connected/active from connections and logins. Paused stays paused. */
export function refreshStatus(id: number) {
  const db = getDb();
  const company = getCompany(id);
  if (!company || company.status === "paused") return company?.status;
  const okKinds = new Set((db.prepare("SELECT kind FROM company_connections WHERE company_id = ? AND status = 'ok'").all(id) as { kind: string }[]).map((r) => r.kind));
  const users = (db.prepare("SELECT COUNT(*) n FROM company_users WHERE company_id = ?").get(id) as { n: number }).n;
  const connected = okKinds.has("code") && okKinds.has("tickets");
  const status: CompanyStatus = connected ? (users > 0 ? "active" : "connected") : "draft";
  if (status !== company.status) db.prepare("UPDATE companies SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  return status;
}

export function canCreateLogins(id: number) {
  const okKinds = new Set(
    (getDb().prepare("SELECT kind FROM company_connections WHERE company_id = ? AND status = 'ok'").all(id) as { kind: string }[]).map((r) => r.kind),
  );
  return okKinds.has("code") && okKinds.has("tickets");
}

export function pauseCompany(id: number, actor: Actor, ip: string) {
  const company = getCompany(id);
  if (!company || company.status === "paused") return;
  getDb().prepare("UPDATE companies SET status = 'paused', status_before_pause = ?, updated_at = ? WHERE id = ?").run(company.status, nowIso(), id);
  revokeCompanySessions(id);
  audit({ actor, action: "company.paused", result: "ok", companyId: id, target: company.name, ip, detail: { sessions: "ended" } });
}

export function resumeCompany(id: number, actor: Actor, ip: string) {
  const company = getCompany(id);
  if (!company || company.status !== "paused") return;
  getDb().prepare("UPDATE companies SET status = ?, status_before_pause = NULL, updated_at = ? WHERE id = ?").run(company.status_before_pause ?? "draft", nowIso(), id);
  refreshStatus(id);
  audit({ actor, action: "company.resumed", result: "ok", companyId: id, target: company.name, ip });
}

export function statusCounts() {
  const rows = getDb().prepare("SELECT status, COUNT(*) n FROM companies GROUP BY status").all() as { status: CompanyStatus; n: number }[];
  const counts: Record<CompanyStatus, number> = { draft: 0, connected: 0, active: 0, paused: 0 };
  for (const r of rows) counts[r.status] = r.n;
  return counts;
}

export function companiesNeedingAttention() {
  return getDb()
    .prepare(
      `SELECT c.id, c.name, c.short_code, x.kind, x.provider, x.last_test_at
       FROM company_connections x JOIN companies c ON c.id = x.company_id
       WHERE x.status = 'failed' ORDER BY x.last_test_at DESC LIMIT 20`,
    )
    .all() as { id: number; name: string; short_code: string; kind: string; provider: string; last_test_at: string | null }[];
}
