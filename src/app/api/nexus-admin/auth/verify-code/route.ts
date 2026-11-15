import { adminFromCookieHeader, clientIp, completeSecondFactor, jsonResponse } from "@/nexus-admin/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return jsonResponse(403, { ok: false, error: "This request could not be verified." });
  const ctx = adminFromCookieHeader(request.headers.get("cookie"), true);
  if (!ctx || !ctx.session.totp_pending) return jsonResponse(401, { ok: false, error: "Sign in again." });
  const raw = (await request.json().catch(() => ({}))) as { code?: unknown };
  const ok = completeSecondFactor(ctx, typeof raw.code === "string" ? raw.code : "", clientIp(request.headers));
  return ok ? jsonResponse(200, { ok: true }) : jsonResponse(401, { ok: false, error: "That code did not match. Check the time on your device and try again." });
}
