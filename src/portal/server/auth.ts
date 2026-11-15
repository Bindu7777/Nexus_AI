// Employee portal sign-in. Company code + employee ID + password, for the
// logins created in admin onboarding. Shares the admin portal's database,
// password hashing, sessions table and audit log; uses its own cookie so an
// admin session and an employee session never mix.
import { createHash } from "node:crypto";
import { audit, type Actor } from "@/nexus-admin/server/audit";
import { type CompanyRow, getCompanyByCode } from "@/nexus-admin/server/companies";
import { getDb, nowIso } from "@/nexus-admin/server/db";
import { burnVerifyTime, hashPassword, passwordProblems, verifyPassword } from "@/nexus-admin/server/passwords";
import { createSession, csrfMatches, readCookie, readSession, revokeSession, revokeSubjectSessions, type SessionRow } from "@/nexus-admin/server/sessions";
import { ABSOLUTE_MS } from "@/nexus-admin/server/sessions";
import { DEV_SESSION_TOKEN, devBypassEnabled, devSession } from "@/nexus-admin/server/dev-bypass";

export const PORTAL_COOKIE = "nexus_portal_session";
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 30;
const MAX_PER_ACCOUNT = 10;
const MAX_LOOKUPS_PER_IP = 60;

export const NEUTRAL_FAIL =
  "Those sign-in details did not match, or the account is temporarily locked. Check the company code, employee ID and password, or wait 15 minutes.";

export type PortalUser = {
  id: number;
  company_id: number;
  role: "company_admin" | "employee";
  login_id: string;
  display_name: string;
  password_hash: string;
  must_change_password: number;
  disabled_at: string | null;
  failed_count: number;
  locked_until: string | null;
  password_changed_at: string | null;
};

export type PortalContext = { user: PortalUser; company: CompanyRow; session: SessionRow; token: string };

export const portalActor = (company: Pick<CompanyRow, "short_code">, user: Pick<PortalUser, "id" | "login_id">): Actor => ({
  type: "company_user",
  id: user.id,
  label: `${company.short_code}/${user.login_id}`,
});

// ---------- rate limiting ----------
type Bucket = { count: number; resetAt: number };
const buckets = ((globalThis as { __nexusPortalBuckets?: Map<string, Bucket> }).__nexusPortalBuckets ??= new Map());

function hit(key: string, max: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > max;
}

export function resetPortalRateLimitsForTests() {
  buckets.clear();
}

const hashKey = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const normCode = (code: string) => code.trim().toUpperCase().slice(0, 16);
const normId = (id: string) => (id.includes("@") ? id.trim().toLowerCase() : id.trim()).slice(0, 120);

// ---------- company name lookup ----------

/**
 * Shows the company's name after the code is typed, so people notice a wrong
 * code. Rate limited, and only for companies that are live: a draft or unknown
 * code returns nothing, so this cannot list onboarding customers.
 */
export function lookupCompanyName(code: string, ip: string) {
  if (hit(`lookup:${ip}`, MAX_LOOKUPS_PER_IP)) return { name: null as string | null, limited: true };
  const company = getCompanyByCode(normCode(code));
  if (!company || (company.status !== "active" && company.status !== "paused")) return { name: null as string | null, limited: false };
  return { name: company.name, limited: false };
}

// ---------- sign-in ----------

export type SignInResult =
  | { ok: true; token: string; csrf: string; mustChangePassword: boolean; companyName: string }
  | { ok: false; status: number; message: string };

export async function signInEmployee(input: { companyCode: string; employeeId: string; password: string; ip: string; userAgent?: string | null }): Promise<SignInResult> {
  const code = normCode(input.companyCode);
  const loginId = normId(input.employeeId);
  const limitedIp = hit(`ip:${input.ip}`, MAX_PER_IP);
  const limitedAccount = hit(`acct:${hashKey(`${code}/${loginId.toLowerCase()}`)}`, MAX_PER_ACCOUNT);
  const company = getCompanyByCode(code);
  const user = company
    ? (getDb().prepare("SELECT * FROM company_users WHERE company_id = ? AND login_id = ?").get(company.id, loginId) as PortalUser | undefined)
    : undefined;

  if (limitedIp || limitedAccount) {
    await burnVerifyTime(input.password);
    audit({
      actor: company && user ? portalActor(company, user) : { type: "anonymous", label: `${code}/${loginId}`.slice(0, 80) },
      action: "portal.sign_in_rate_limited",
      result: "denied",
      companyId: company?.id ?? null,
      ip: input.ip,
    });
    return { ok: false, status: 429, message: "Too many sign-in attempts. Wait 15 minutes and try again." };
  }
  if (!company || !user) {
    await burnVerifyTime(input.password);
    audit({ actor: { type: "anonymous", label: `${code}/${loginId}`.slice(0, 80) }, action: "portal.sign_in_failed", result: "fail", ip: input.ip, detail: { reason: "unknown" } });
    return { ok: false, status: 401, message: NEUTRAL_FAIL };
  }
  const actor = portalActor(company, user);
  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
    await burnVerifyTime(input.password);
    audit({ actor, action: "portal.sign_in_locked", result: "denied", companyId: company.id, ip: input.ip });
    return { ok: false, status: 401, message: NEUTRAL_FAIL };
  }
  const db = getDb();
  if (!(await verifyPassword(user.password_hash, input.password))) {
    const failed = user.failed_count + 1;
    const lock = failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    db.prepare("UPDATE company_users SET failed_count = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?").run(lock ? 0 : failed, lock, user.id);
    audit({ actor, action: lock ? "portal.account_locked" : "portal.sign_in_failed", result: "fail", companyId: company.id, ip: input.ip });
    return { ok: false, status: 401, message: NEUTRAL_FAIL };
  }
  // The password is right: now it is safe to say plainly why sign-in is blocked.
  if (user.disabled_at || company.status !== "active") {
    const reason = user.disabled_at ? "login_disabled" : company.status === "paused" ? "company_paused" : "company_not_live";
    audit({ actor, action: "portal.sign_in_blocked", result: "denied", companyId: company.id, ip: input.ip, detail: { reason } });
    const message =
      reason === "login_disabled"
        ? "Your login is turned off. Contact your company admin."
        : reason === "company_paused"
          ? `Nexus is paused for ${company.name}. Contact your company admin.`
          : `${company.name} is not live on Nexus yet. Contact your company admin.`;
    return { ok: false, status: 403, message };
  }
  db.prepare("UPDATE company_users SET failed_count = 0, locked_until = NULL, last_used_at = ? WHERE id = ?").run(nowIso(), user.id);
  const session = createSession({ subjectType: "company_user", subjectId: user.id, companyId: company.id, ip: input.ip, userAgent: input.userAgent ?? null });
  audit({ actor, action: "portal.sign_in", result: "ok", companyId: company.id, ip: input.ip, detail: { mustChangePassword: user.must_change_password === 1 } });
  return { ok: true, token: session.token, csrf: session.csrf, mustChangePassword: user.must_change_password === 1, companyName: company.name };
}

// ---------- sessions and guards ----------

export function portalFromCookieHeader(cookieHeader: string | null | undefined): PortalContext | null {
  const real = portalFromSession(cookieHeader);
  if (real || !devBypassEnabled()) return real;
  return devPortalContext();
}

/** Development only: act as NEXUS_DEV_PORTAL_USER (COMPANY/EMPLOYEE_ID), or the first live company's first employee. */
function devPortalContext(): PortalContext | null {
  const db = getDb();
  const wanted = process.env.NEXUS_DEV_PORTAL_USER?.split("/");
  const company = (wanted?.[0]
    ? db.prepare("SELECT * FROM companies WHERE short_code = ? AND status = 'active'").get(wanted[0].trim().toUpperCase())
    : db.prepare("SELECT * FROM companies WHERE status = 'active' ORDER BY id LIMIT 1").get()) as CompanyRow | undefined;
  if (!company) return null;
  const user = (wanted?.[1]
    ? db.prepare("SELECT * FROM company_users WHERE company_id = ? AND login_id = ? AND disabled_at IS NULL").get(company.id, wanted[1].trim())
    : db.prepare("SELECT * FROM company_users WHERE company_id = ? AND disabled_at IS NULL ORDER BY role = 'employee' DESC, id LIMIT 1").get(company.id)) as PortalUser | undefined;
  if (!user) return null;
  // The forced password change does not apply while the bypass is on.
  return { user: { ...user, must_change_password: 0 }, company, session: devSession("company_user", user.id, company.id), token: DEV_SESSION_TOKEN };
}

function portalFromSession(cookieHeader: string | null | undefined): PortalContext | null {
  const token = readCookie(cookieHeader, PORTAL_COOKIE);
  const session = readSession(token, "company_user");
  if (!session || !token || !session.company_id) return null;
  const db = getDb();
  const user = db.prepare("SELECT * FROM company_users WHERE id = ? AND company_id = ?").get(session.subject_id, session.company_id) as PortalUser | undefined;
  const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(session.company_id) as CompanyRow | undefined;
  // A paused company or a turned-off login ends the session at once.
  if (!user || !company || user.disabled_at || company.status !== "active") {
    revokeSession(token);
    return null;
  }
  return { user, company, session, token };
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return Boolean(origin && host && new URL(origin).host === host);
  } catch {
    return false;
  }
}

export const portalJson = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extraHeaders } });

export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

/**
 * Guard for portal API routes. Writes need same-origin and the CSRF header.
 * A login that must change its temporary password can only change it.
 */
export function requirePortalApi(request: Request, options: { allowMustChange?: boolean; roles?: PortalUser["role"][] } = {}): PortalContext | Response {
  const ctx = portalFromCookieHeader(request.headers.get("cookie"));
  if (!ctx) return portalJson(401, { ok: false, error: "Sign in again. Your session is missing or has expired." });
  if (ctx.user.must_change_password === 1 && !options.allowMustChange) {
    return portalJson(403, { ok: false, error: "Choose a new password first.", mustChangePassword: true });
  }
  if (options.roles && !options.roles.includes(ctx.user.role)) return portalJson(403, { ok: false, error: "Your role does not allow this." });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (!sameOrigin(request) || !csrfMatches(ctx.session, request.headers.get("x-csrf-token"))) {
      audit({ actor: portalActor(ctx.company, ctx.user), action: "portal.csrf_rejected", result: "denied", companyId: ctx.company.id, ip: clientIp(request.headers) });
      return portalJson(403, { ok: false, error: "This request could not be verified. Reload the page and try again." });
    }
  }
  return ctx;
}

export function portalCookie(token: string) {
  const secure = process.env.NEXUS_ALLOW_HTTP_COOKIES === "1" ? "" : "; Secure";
  return `${PORTAL_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ABSOLUTE_MS / 1000)}${secure}`;
}

export function clearPortalCookie() {
  const secure = process.env.NEXUS_ALLOW_HTTP_COOKIES === "1" ? "" : "; Secure";
  return `${PORTAL_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

// ---------- password change and sign-out ----------

export async function changeEmployeePassword(ctx: PortalContext, current: string, next: string, ip: string) {
  const actor = portalActor(ctx.company, ctx.user);
  if (!(await verifyPassword(ctx.user.password_hash, current))) {
    audit({ actor, action: "portal.password_change_failed", result: "fail", companyId: ctx.company.id, ip });
    return { ok: false as const, message: "Your current password is not correct." };
  }
  const problems = passwordProblems(next, ctx.user.login_id);
  if (next === current) problems.push("Choose a password different from the current one.");
  if (problems.length) return { ok: false as const, message: problems.join(" ") };
  getDb()
    .prepare("UPDATE company_users SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?")
    .run(await hashPassword(next), nowIso(), ctx.user.id);
  revokeSubjectSessions("company_user", ctx.user.id, ctx.token);
  audit({ actor, action: "portal.password_changed", result: "ok", companyId: ctx.company.id, ip, detail: { wasTemporary: ctx.user.must_change_password === 1 } });
  return { ok: true as const };
}

export function signOutEmployee(ctx: PortalContext, ip: string) {
  revokeSession(ctx.token);
  audit({ actor: portalActor(ctx.company, ctx.user), action: "portal.sign_out", result: "ok", companyId: ctx.company.id, ip });
}
