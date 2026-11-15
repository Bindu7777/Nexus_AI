// Admin accounts, sign-in with rate limiting and lockout, and the role checks
// every admin page and API route goes through.
import { audit, type Actor } from "./audit";
import { decryptSecret, encryptSecret } from "./crypto";
import { getDb, nowIso } from "./db";
import { burnVerifyTime, hashPassword, normaliseLoginId, passwordProblems, verifyPassword } from "./passwords";
import { ADMIN_COOKIE, completeTotp, createSession, csrfMatches, readCookie, readSession, revokeSubjectSessions, type SessionRow } from "./sessions";
import { verifyTotp } from "./totp";
import { DEV_SESSION_TOKEN, devBypassEnabled, devSession } from "./dev-bypass";

/** Roles. Add more here; checks go through hasRole(). */
export const ROLES = ["nexus_admin"] as const;
export type Role = (typeof ROLES)[number];

export type AdminRow = {
  id: number;
  login_id_norm: string;
  display_name: string;
  password_hash: string;
  role: Role;
  totp_secret_enc: string | null;
  totp_enabled: number;
  failed_count: number;
  locked_until: string | null;
  password_changed_at: string;
  last_login_at: string | null;
};

export type AdminContext = { admin: AdminRow; session: SessionRow; token: string };

export const actorOf = (admin: Pick<AdminRow, "id" | "display_name">): Actor => ({ type: "nexus_admin", id: admin.id, label: admin.display_name });

export function hasRole(admin: Pick<AdminRow, "role">, allowed: readonly Role[]) {
  return allowed.includes(admin.role);
}

export function adminCount() {
  return (getDb().prepare("SELECT COUNT(*) n FROM nexus_admins").get() as { n: number }).n;
}

export function findAdmin(loginId: string) {
  return getDb().prepare("SELECT * FROM nexus_admins WHERE login_id_norm = ?").get(normaliseLoginId(loginId)) as AdminRow | undefined;
}

export function getAdmin(id: number) {
  return getDb().prepare("SELECT * FROM nexus_admins WHERE id = ?").get(id) as AdminRow | undefined;
}

export async function createAdmin(loginId: string, password: string, role: Role = "nexus_admin") {
  const displayName = loginId.trim().replace(/\s+/g, " ");
  if (!displayName) throw new Error("Login ID is required.");
  const problems = passwordProblems(password, loginId);
  if (problems.length) throw new Error(problems.join(" "));
  if (findAdmin(loginId)) throw new Error(`An admin with login ID "${displayName}" already exists. Use npm run admin:reset-password instead.`);
  const passwordHash = await hashPassword(password);
  const now = nowIso();
  const info = getDb()
    .prepare("INSERT INTO nexus_admins (login_id_norm, display_name, password_hash, role, password_changed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(normaliseLoginId(loginId), displayName, passwordHash, role, now, now);
  audit({ actor: { type: "system", label: "admin:create" }, action: "auth.admin_created", result: "ok", target: displayName });
  return Number(info.lastInsertRowid);
}

export async function resetAdminPassword(loginId: string, password: string) {
  const admin = findAdmin(loginId);
  if (!admin) throw new Error("No admin with that login ID.");
  const problems = passwordProblems(password, loginId);
  if (problems.length) throw new Error(problems.join(" "));
  getDb()
    .prepare("UPDATE nexus_admins SET password_hash = ?, password_changed_at = ?, failed_count = 0, locked_until = NULL WHERE id = ?")
    .run(await hashPassword(password), nowIso(), admin.id);
  revokeSubjectSessions("nexus_admin", admin.id);
  audit({ actor: { type: "system", label: "admin:reset-password" }, action: "auth.password_reset_cli", result: "ok", target: admin.display_name });
}

// ---------- Rate limiting (per IP and per login ID) + lockout ----------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 20;
const MAX_PER_ID = 8;
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60 * 1000;

type Bucket = { count: number; resetAt: number };
const buckets = ((globalThis as { __nexusLoginBuckets?: Map<string, Bucket> }).__nexusLoginBuckets ??= new Map());

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

export function resetRateLimitsForTests() {
  buckets.clear();
}

export const NEUTRAL_FAIL = "That login ID and password did not match, or the account is temporarily locked. Wait a few minutes and try again.";

export type LoginResult =
  | { ok: true; token: string; csrf: string; totpRequired: boolean; mustSetupNothing?: true }
  | { ok: false; status: number; message: string };

export async function signIn(input: { loginId: string; password: string; ip: string; userAgent?: string | null }): Promise<LoginResult> {
  const idKey = `id:${normaliseLoginId(input.loginId)}`;
  const ipKey = `ip:${input.ip}`;
  const limited = hit(ipKey, MAX_PER_IP) || hit(idKey, MAX_PER_ID);
  const admin = findAdmin(input.loginId);
  const anon: Actor = { type: "anonymous", label: input.loginId.trim().slice(0, 60) || "(empty)" };

  if (limited) {
    await burnVerifyTime(input.password);
    audit({ actor: anon, action: "auth.sign_in_rate_limited", result: "denied", ip: input.ip });
    return { ok: false, status: 429, message: NEUTRAL_FAIL };
  }
  if (!admin) {
    await burnVerifyTime(input.password);
    audit({ actor: anon, action: "auth.sign_in_failed", result: "fail", ip: input.ip, detail: { reason: "unknown_or_wrong" } });
    return { ok: false, status: 401, message: NEUTRAL_FAIL };
  }
  if (admin.locked_until && Date.parse(admin.locked_until) > Date.now()) {
    await burnVerifyTime(input.password);
    audit({ actor: actorOf(admin), action: "auth.sign_in_locked", result: "denied", ip: input.ip });
    return { ok: false, status: 401, message: NEUTRAL_FAIL };
  }
  const good = await verifyPassword(admin.password_hash, input.password);
  const db = getDb();
  if (!good) {
    const failed = admin.failed_count + 1;
    const lock = failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MS).toISOString() : null;
    db.prepare("UPDATE nexus_admins SET failed_count = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?").run(lock ? 0 : failed, lock, admin.id);
    audit({ actor: actorOf(admin), action: lock ? "auth.account_locked" : "auth.sign_in_failed", result: "fail", ip: input.ip, detail: { reason: "unknown_or_wrong" } });
    return { ok: false, status: 401, message: NEUTRAL_FAIL };
  }
  db.prepare("UPDATE nexus_admins SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").run(nowIso(), admin.id);
  const totpRequired = admin.totp_enabled === 1;
  const { token, csrf } = createSession({ subjectType: "nexus_admin", subjectId: admin.id, ip: input.ip, userAgent: input.userAgent, totpPending: totpRequired });
  audit({ actor: actorOf(admin), action: totpRequired ? "auth.password_ok_awaiting_code" : "auth.sign_in", result: "ok", ip: input.ip });
  return { ok: true, token, csrf, totpRequired };
}

export function completeSecondFactor(ctx: { token: string; session: SessionRow }, code: string, ip: string) {
  const admin = getAdmin(ctx.session.subject_id);
  if (!admin?.totp_enabled || !admin.totp_secret_enc) return false;
  const secret = decryptSecret(admin.totp_secret_enc, `admin:${admin.id}:totp`);
  const ok = verifyTotp(secret, code);
  audit({ actor: actorOf(admin), action: ok ? "auth.sign_in" : "auth.code_failed", result: ok ? "ok" : "fail", ip, detail: { factor: "totp" } });
  if (ok) completeTotp(ctx.token);
  return ok;
}

export function setTotp(adminId: number, secret: string | null) {
  const enc = secret ? encryptSecret(secret, `admin:${adminId}:totp`).blob : null;
  getDb().prepare("UPDATE nexus_admins SET totp_secret_enc = ?, totp_enabled = ? WHERE id = ?").run(enc, secret ? 1 : 0, adminId);
}

export function totpSecretFor(admin: AdminRow) {
  return admin.totp_secret_enc ? decryptSecret(admin.totp_secret_enc, `admin:${admin.id}:totp`) : null;
}

export async function changePassword(ctx: AdminContext, current: string, next: string, ip: string) {
  if (!(await verifyPassword(ctx.admin.password_hash, current))) {
    audit({ actor: actorOf(ctx.admin), action: "auth.password_change_failed", result: "fail", ip });
    return { ok: false as const, message: "Your current password is not correct." };
  }
  const problems = passwordProblems(next, ctx.admin.display_name);
  if (problems.length) return { ok: false as const, message: problems.join(" ") };
  getDb().prepare("UPDATE nexus_admins SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(await hashPassword(next), nowIso(), ctx.admin.id);
  revokeSubjectSessions("nexus_admin", ctx.admin.id, ctx.token);
  audit({ actor: actorOf(ctx.admin), action: "auth.password_changed", result: "ok", ip });
  return { ok: true as const };
}

// ---------- Request guards ----------
export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

/** Session from a raw Cookie header. Two-factor-pending sessions are not authenticated. */
export function adminFromCookieHeader(cookieHeader: string | null | undefined, allowTotpPending = false): AdminContext | null {
  const real = adminFromSession(cookieHeader, allowTotpPending);
  if (real || !devBypassEnabled()) return real;
  return devAdminContext();
}

function adminFromSession(cookieHeader: string | null | undefined, allowTotpPending: boolean): AdminContext | null {
  const token = readCookie(cookieHeader, ADMIN_COOKIE);
  const session = readSession(token, "nexus_admin");
  if (!session || !token) return null;
  if (session.totp_pending && !allowTotpPending) return null;
  const admin = getAdmin(session.subject_id);
  if (!admin || !hasRole(admin, ROLES)) return null;
  return { admin, session, token };
}

/** Development only: act as NEXUS_DEV_ADMIN, or the first admin. */
function devAdminContext(): AdminContext | null {
  const wanted = process.env.NEXUS_DEV_ADMIN;
  const admin = wanted
    ? findAdmin(wanted)
    : (getDb().prepare("SELECT * FROM nexus_admins ORDER BY id LIMIT 1").get() as AdminRow | undefined);
  if (!admin || !hasRole(admin, ROLES)) return null;
  return { admin, session: devSession("nexus_admin", admin.id, null), token: DEV_SESSION_TOKEN };
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * Guard for admin API routes. Returns either the admin context or a ready
 * error Response. State-changing methods also require the CSRF header and a
 * same-origin request.
 */
export function requireAdminApi(request: Request, roles: readonly Role[] = ROLES): AdminContext | Response {
  const ctx = adminFromCookieHeader(request.headers.get("cookie"));
  if (!ctx) return json(401, { ok: false, error: "Sign in again. Your session is missing or has expired." });
  if (!hasRole(ctx.admin, roles)) return json(403, { ok: false, error: "Your role does not allow this." });
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    if (!sameOrigin(request) || !csrfMatches(ctx.session, request.headers.get("x-csrf-token"))) {
      audit({ actor: actorOf(ctx.admin), action: "auth.csrf_rejected", result: "denied", ip: clientIp(request.headers), target: new URL(request.url).pathname });
      return json(403, { ok: false, error: "This request could not be verified. Reload the page and try again." });
    }
  }
  return ctx;
}

export { json as jsonResponse };
