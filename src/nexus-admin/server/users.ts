// Company logins (company admins and employees). Temporary passwords are shown
// once to the Nexus admin and only their hash is stored.
import { audit, type Actor } from "./audit";
import { canCreateLogins, getCompany, refreshStatus } from "./companies";
import { getDb, nowIso } from "./db";
import { generateTemporaryPassword, hashPassword } from "./passwords";
import { revokeSubjectSessions } from "./sessions";

export type CompanyUserRow = {
  id: number;
  company_id: number;
  role: "company_admin" | "employee";
  login_id: string;
  display_name: string;
  password_hash: string;
  must_change_password: number;
  disabled_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type PublicUser = Omit<CompanyUserRow, "password_hash">;

const strip = ({ password_hash: _hash, ...rest }: CompanyUserRow): PublicUser => {
  void _hash;
  return rest;
};

export function listUsers(companyId: number): PublicUser[] {
  return (getDb().prepare("SELECT * FROM company_users WHERE company_id = ? ORDER BY role, login_id").all(companyId) as CompanyUserRow[]).map(strip);
}

export function validateLoginId(role: CompanyUserRow["role"], loginId: string) {
  const id = loginId.trim();
  if (role === "company_admin") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(id) ? null : "A company admin signs in with an email address.";
  }
  return /^[A-Za-z0-9._-]{2,40}$/.test(id) ? null : "Employee IDs use 2 to 40 letters, digits, dots, dashes or underscores, for example 221272.";
}

export async function createUser(input: { companyId: number; role: CompanyUserRow["role"]; loginId: string; displayName?: string; actor: Actor; ip: string }) {
  const company = getCompany(input.companyId);
  if (!company) throw new Error("Company not found.");
  if (company.status === "paused") throw new Error("This company is paused. Resume it before creating logins.");
  if (!canCreateLogins(input.companyId)) throw new Error("A code connector and a defects connector must pass their tests before logins are created.");
  const problem = validateLoginId(input.role, input.loginId);
  if (problem) throw new Error(problem);
  const loginId = input.role === "company_admin" ? input.loginId.trim().toLowerCase() : input.loginId.trim();
  const exists = getDb().prepare("SELECT 1 FROM company_users WHERE company_id = ? AND login_id = ?").get(input.companyId, loginId);
  if (exists) throw new Error(`${loginId} already has a login at ${company.short_code}.`);
  const temporaryPassword = generateTemporaryPassword();
  const info = getDb()
    .prepare(
      `INSERT INTO company_users (company_id, role, login_id, display_name, password_hash, must_change_password, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(input.companyId, input.role, loginId, (input.displayName ?? "").trim().slice(0, 120), await hashPassword(temporaryPassword), nowIso());
  audit({
    actor: input.actor,
    action: "user.created",
    result: "ok",
    companyId: input.companyId,
    target: `${input.role}:${loginId}`,
    ip: input.ip,
    detail: { mustChangePassword: true },
    scrub: [temporaryPassword],
  });
  refreshStatus(input.companyId);
  return { id: Number(info.lastInsertRowid), loginId, temporaryPassword };
}

/** CSV of employee IDs: one per line, optional header "employee_id[,name]". */
export async function bulkCreateEmployees(input: { companyId: number; csv: string; actor: Actor; ip: string }) {
  const rows = input.csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows[0] && /employee/i.test(rows[0])) rows.shift();
  if (rows.length > 500) throw new Error("Upload at most 500 employees at a time.");
  const created: { loginId: string; temporaryPassword: string }[] = [];
  const skipped: { loginId: string; reason: string }[] = [];
  for (const line of rows) {
    const [id, name] = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    try {
      const r = await createUser({ companyId: input.companyId, role: "employee", loginId: id ?? "", displayName: name, actor: input.actor, ip: input.ip });
      created.push({ loginId: r.loginId, temporaryPassword: r.temporaryPassword });
    } catch (error) {
      skipped.push({ loginId: id ?? "", reason: error instanceof Error ? error.message : "Could not create." });
    }
  }
  audit({ actor: input.actor, action: "user.bulk_created", result: "info", companyId: input.companyId, ip: input.ip, detail: { created: created.length, skipped: skipped.length } });
  return { created, skipped };
}

export async function resetUserPassword(companyId: number, userId: number, actor: Actor, ip: string) {
  const user = getDb().prepare("SELECT * FROM company_users WHERE id = ? AND company_id = ?").get(userId, companyId) as CompanyUserRow | undefined;
  if (!user) throw new Error("Login not found.");
  const temporaryPassword = generateTemporaryPassword();
  getDb().prepare("UPDATE company_users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(await hashPassword(temporaryPassword), userId);
  revokeSubjectSessions("company_user", userId);
  audit({ actor, action: "user.password_reset", result: "ok", companyId, target: `${user.role}:${user.login_id}`, ip, scrub: [temporaryPassword] });
  return { loginId: user.login_id, temporaryPassword };
}

export function setUserDisabled(companyId: number, userId: number, disabled: boolean, actor: Actor, ip: string) {
  const user = getDb().prepare("SELECT * FROM company_users WHERE id = ? AND company_id = ?").get(userId, companyId) as CompanyUserRow | undefined;
  if (!user) throw new Error("Login not found.");
  getDb().prepare("UPDATE company_users SET disabled_at = ? WHERE id = ?").run(disabled ? nowIso() : null, userId);
  if (disabled) revokeSubjectSessions("company_user", userId);
  audit({ actor, action: disabled ? "user.disabled" : "user.enabled", result: "ok", companyId, target: `${user.role}:${user.login_id}`, ip });
}

// Company users sign in through the employee portal: see src/portal/server/auth.ts.
