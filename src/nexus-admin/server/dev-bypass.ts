// Development-only sign-in bypass.
//
// When NEXUS_DEV_BYPASS_LOGIN=1 and the server runs in development mode, a
// request without a session is treated as signed in: the admin portal as
// NEXUS_DEV_ADMIN (default: the first admin) and the employee portal as
// NEXUS_DEV_PORTAL_USER, written COMPANY/EMPLOYEE_ID (default: the first live
// company's first employee). It never applies to a production build. Run the
// dev server on 127.0.0.1 so nobody else on the network can reach it.
import { randomBytes } from "node:crypto";
import type { SessionRow } from "./sessions";

export function devBypassEnabled() {
  return process.env.NEXUS_DEV_BYPASS_LOGIN === "1" && process.env.NODE_ENV !== "production";
}

export const DEV_SESSION_TOKEN = "dev-bypass-session-not-a-real-token";

/** One CSRF token per server process, so writes from the bypassed pages still carry the header check. */
export function devCsrf() {
  const g = globalThis as { __nexusDevCsrf?: string };
  g.__nexusDevCsrf ??= randomBytes(24).toString("base64url");
  return g.__nexusDevCsrf;
}

export function devSession(subjectType: SessionRow["subject_type"], subjectId: number, companyId: number | null): SessionRow {
  const now = new Date().toISOString();
  return {
    token_hash: "dev-bypass",
    subject_type: subjectType,
    subject_id: subjectId,
    company_id: companyId,
    csrf_token: devCsrf(),
    last_seen_at: now,
    expires_at: new Date(Date.now() + 12 * 3600_000).toISOString(),
    revoked_at: null,
    totp_pending: 0,
  };
}
