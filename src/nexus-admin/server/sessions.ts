// Sessions: a random token in an HTTP-only cookie; only its SHA-256 hash is stored.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb, nowIso } from "./db";

export const ADMIN_COOKIE = "nexus_admin_session";
export const IDLE_MS = 30 * 60 * 1000; // 30 minutes
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12 hours

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export type SessionRow = {
  token_hash: string;
  subject_type: "nexus_admin" | "company_user";
  subject_id: number;
  company_id: number | null;
  csrf_token: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  totp_pending: number;
};

export function createSession(input: {
  subjectType: SessionRow["subject_type"];
  subjectId: number;
  companyId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  totpPending?: boolean;
}) {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  const now = new Date();
  getDb()
    .prepare(
      `INSERT INTO sessions (token_hash, subject_type, subject_id, company_id, csrf_token, ip, user_agent, created_at, last_seen_at, expires_at, totp_pending)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sha256(token),
      input.subjectType,
      input.subjectId,
      input.companyId ?? null,
      csrf,
      input.ip ?? null,
      (input.userAgent ?? "").slice(0, 200),
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + ABSOLUTE_MS).toISOString(),
      input.totpPending ? 1 : 0,
    );
  return { token, csrf };
}

/** Returns the live session or null. Slides the idle window forward. */
export function readSession(token: string | undefined | null, subjectType: SessionRow["subject_type"]) {
  if (!token || token.length < 20) return null;
  const db = getDb();
  const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(sha256(token)) as SessionRow | undefined;
  if (!row || row.subject_type !== subjectType || row.revoked_at) return null;
  const now = Date.now();
  if (now > Date.parse(row.expires_at) || now - Date.parse(row.last_seen_at) > IDLE_MS) {
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").run(nowIso(), row.token_hash);
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > 30_000) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(nowIso(), row.token_hash);
  }
  return row;
}

export function completeTotp(token: string) {
  getDb().prepare("UPDATE sessions SET totp_pending = 0 WHERE token_hash = ?").run(sha256(token));
}

export function revokeSession(token: string) {
  getDb().prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(nowIso(), sha256(token));
}

export function revokeSubjectSessions(subjectType: SessionRow["subject_type"], subjectId: number, exceptToken?: string) {
  const except = exceptToken ? sha256(exceptToken) : "";
  getDb()
    .prepare("UPDATE sessions SET revoked_at = ? WHERE subject_type = ? AND subject_id = ? AND revoked_at IS NULL AND token_hash != ?")
    .run(nowIso(), subjectType, subjectId, except);
}

export function revokeCompanySessions(companyId: number) {
  getDb()
    .prepare("UPDATE sessions SET revoked_at = ? WHERE subject_type = 'company_user' AND company_id = ? AND revoked_at IS NULL")
    .run(nowIso(), companyId);
}

export function csrfMatches(session: SessionRow, supplied: string | null | undefined) {
  if (!supplied) return false;
  const a = Buffer.from(session.csrf_token);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieHeader(token: string, maxAgeSeconds = ABSOLUTE_MS / 1000) {
  const secure = process.env.NEXUS_ALLOW_HTTP_COOKIES === "1" ? "" : "; Secure";
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeSeconds)}${secure}`;
}

export function clearCookieHeader() {
  const secure = process.env.NEXUS_ALLOW_HTTP_COOKIES === "1" ? "" : "; Secure";
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function readCookie(header: string | null | undefined, name = ADMIN_COOKIE) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
