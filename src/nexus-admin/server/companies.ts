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
  region: string;
  deployment_mode: "customer" | "nexus-hosted";
  notes: string;
  status: CompanyStatus;
  status_before_pause: CompanyStatus | null;
  onboarding_step: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  went_live_at: string | null;
};

export type CompanyDetails = Pick<CompanyRow, "name" | "short_code" | "contact_name" | "contact_email" | "country" | "region" | "deployment_mode" | "notes">;

export function validateDetails(input: Partial<Record<keyof CompanyDetails, unknown>>) {
  const errors: Partial<Record<keyof CompanyDetails, string>> = {};
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const details: CompanyDetails = {
    name: str(input.name, 120),
    short_code: str(input.short_code, 16).toUpperCase(),
    contact_name: str(input.contact_name, 120),
    contact_email: str(input.contact_email, 200),
    country: str(input.country, 80),
    region: str(input.region, 80),
    deployment_mode: input.deployment_mode === "nexus-hosted" ? "nexus-hosted" : "customer",
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
        (SELECT COUNT(*) FROM company_connectors x WHERE x.company_id = c.id AND x.status = 'healthy') AS ok_count,
        (SELECT COUNT(*) FROM company_connectors x WHERE x.company_id = c.id AND x.status = 'failing') AS failed_count,
        (SELECT COUNT(*) FROM company_connectors x WHERE x.company_id = c.id) AS conn_count,
        (SELECT COUNT(*) FROM company_users u WHERE u.company_id = c.id AND u.role = 'employee') AS employee_count
       FROM companies c
       WHERE c.name LIKE @like OR c.short_code LIKE @like
       ORDER BY c.last_activity_at DESC`,
    )
    .all({ like }) as (CompanyRow & { ok_count: number; failed_count: number; conn_count: number; employee_count: number })[];
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
      `INSERT INTO companies (name, short_code, contact_name, contact_email, country, region, deployment_mode, notes, status, onboarding_step, created_at, updated_at, last_activity_at)
       VALUES (@name, @short_code, @contact_name, @contact_email, @country, @region, @deployment_mode, @notes, 'draft', 'application', @now, @now, @now)`,
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
       country=@country, region=@region, deployment_mode=@deployment_mode, notes=@notes, updated_at=@now WHERE id=@id`,
    )
    .run({ ...details, id, now: nowIso() });
  audit({ actor, action: "onboarding.details_saved", result: "ok", companyId: id, target: details.name, ip });
}

export function setOnboardingStep(id: number, step: string) {
  getDb().prepare("UPDATE companies SET onboarding_step = ?, updated_at = ? WHERE id = ?").run(step, nowIso(), id);
}

/** Categories whose connectors must have passed a test before logins are created or the company goes live. */
export const REQUIRED_CATEGORIES = ["code", "defects"] as const;

function activeCategories(id: number) {
  return new Set(
    (getDb().prepare("SELECT DISTINCT category FROM company_connectors WHERE company_id = ? AND activated_at IS NOT NULL AND status != 'failing'").all(id) as {
      category: string;
    }[]).map((r) => r.category),
  );
}

/** Code and defects connectors have passed their tests. */
export function requiredConnectorsReady(id: number) {
  const cats = activeCategories(id);
  return REQUIRED_CATEGORIES.every((c) => cats.has(c));
}

/**
 * Keeps a Draft company's internal state current: "connected" means the
 * required connectors passed and it is ready to go live. Active and Paused
 * change only through goLive(), pauseCompany() and resumeCompany().
 */
export function refreshStatus(id: number) {
  const company = getCompany(id);
  if (!company || company.status === "paused" || company.status === "active") return company?.status;
  const status: CompanyStatus = requiredConnectorsReady(id) ? "connected" : "draft";
  if (status !== company.status) getDb().prepare("UPDATE companies SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  return status;
}

export function canCreateLogins(id: number) {
  return requiredConnectorsReady(id);
}

/** What still blocks Go live, in plain words. Empty when ready. */
export function goLiveBlockers(id: number) {
  const company = getCompany(id);
  if (!company) return ["Company not found."];
  const blockers: string[] = [];
  if (company.status === "active") blockers.push("The company is already live.");
  if (company.status === "paused") blockers.push("Resume the company first.");
  const cats = activeCategories(id);
  if (!cats.has("code")) blockers.push("A code connector must pass its test.");
  if (!cats.has("defects")) blockers.push("A defects connector must pass its test.");
  const admins = (getDb().prepare("SELECT COUNT(*) n FROM company_users WHERE company_id = ? AND role = 'company_admin' AND disabled_at IS NULL").get(id) as { n: number }).n;
  if (!admins) blockers.push("Create the company admin login.");
  return blockers;
}

export function goLive(id: number, actor: Actor, ip: string) {
  const blockers = goLiveBlockers(id);
  if (blockers.length) throw new Error(blockers.join(" "));
  const now = nowIso();
  getDb().prepare("UPDATE companies SET status = 'active', went_live_at = COALESCE(went_live_at, ?), updated_at = ?, last_activity_at = ? WHERE id = ?").run(now, now, now, id);
  audit({ actor, action: "company.went_live", result: "ok", companyId: id, target: getCompany(id)!.name, ip });
}

/** Display status for lists: Draft, Active or Paused. "connected" shows as Draft, ready to go live. */
export function displayStatus(status: CompanyStatus) {
  return status === "connected" ? "Draft · ready to go live" : status === "active" ? "Active" : status === "paused" ? "Paused" : "Draft";
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
  // refreshStatus leaves Active alone and re-derives Draft/connected.
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
      `SELECT c.id, c.name, c.short_code, x.id AS connector_id, x.category, x.registry_id, x.last_tested_at, x.last_error
       FROM company_connectors x JOIN companies c ON c.id = x.company_id
       WHERE x.status = 'failing' ORDER BY x.last_tested_at DESC LIMIT 20`,
    )
    .all() as { id: number; name: string; short_code: string; connector_id: number; category: string; registry_id: string; last_tested_at: string | null; last_error: string | null }[];
}

// ---------- onboarding tool plan ----------

export type ToolPlanEntry = { key: string; category: string; registryId: string; deployment: "cloud" | "self-hosted"; label: string; connectorId?: number };
export type ToolPlan = { entries: ToolPlanEntry[]; other: { category: string; text: string }[]; none: string[] };

export function getToolPlan(id: number): ToolPlan {
  const row = getDb().prepare("SELECT tool_plan_json FROM companies WHERE id = ?").get(id) as { tool_plan_json: string } | undefined;
  const plan = row ? (JSON.parse(row.tool_plan_json) as Partial<ToolPlan>) : {};
  return { entries: plan.entries ?? [], other: plan.other ?? [], none: plan.none ?? [] };
}

/** Validates and saves the tools chosen for a company. Unknown connector ids are refused. */
export function saveToolPlan(
  id: number,
  raw: unknown,
  known: (registryId: string) => { category: string; deployments: string[] } | undefined,
  actor: Actor,
  ip: string,
) {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<ToolPlan>;
  const previous = getToolPlan(id);
  const entries: ToolPlanEntry[] = [];
  for (const e of (Array.isArray(input.entries) ? input.entries : []).slice(0, 40)) {
    const def = known(String(e?.registryId ?? ""));
    if (!def) throw new Error(`Unknown tool "${String(e?.registryId ?? "")}".`);
    const deployment = e.deployment === "self-hosted" ? "self-hosted" : "cloud";
    if (!def.deployments.includes(deployment)) throw new Error(`${e.registryId} does not support ${deployment}.`);
    const key = /^[a-z0-9-]{4,40}$/.test(String(e.key)) ? String(e.key) : Math.random().toString(36).slice(2, 10);
    const kept = previous.entries.find((p) => p.key === key);
    entries.push({
      key,
      category: def.category,
      registryId: String(e.registryId),
      deployment,
      label: String(e.label ?? "").trim().slice(0, 80),
      connectorId: kept?.connectorId,
    });
  }
  const other = (Array.isArray(input.other) ? input.other : [])
    .map((o) => ({ category: String(o?.category ?? "").slice(0, 20), text: String(o?.text ?? "").trim().slice(0, 200) }))
    .filter((o) => o.text)
    .slice(0, 20);
  const none = (Array.isArray(input.none) ? input.none : []).map(String).slice(0, 10);
  const plan: ToolPlan = { entries, other, none };
  getDb().prepare("UPDATE companies SET tool_plan_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(plan), nowIso(), id);
  audit({ actor, action: "onboarding.tools_chosen", result: "info", companyId: id, target: entries.map((e) => e.registryId).join(", "), ip, detail: { other, none } });
  return plan;
}

/** Links a saved connector to its plan entry so the wizard knows credentials were entered. */
export function linkPlanEntry(id: number, key: string, connectorId: number) {
  const plan = getToolPlan(id);
  const entry = plan.entries.find((e) => e.key === key);
  if (!entry) return;
  entry.connectorId = connectorId;
  getDb().prepare("UPDATE companies SET tool_plan_json = ? WHERE id = ?").run(JSON.stringify(plan), id);
}
