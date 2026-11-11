import { adminCount, clientIp, jsonResponse, signIn } from "@/nexus-admin/server/auth";
import { cookieHeader } from "@/nexus-admin/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return Boolean(origin && host && new URL(origin).host === host);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonResponse(403, { ok: false, error: "This request could not be verified." });
  if (adminCount() === 0) return jsonResponse(409, { ok: false, error: "No admin account exists yet. Run npm run admin:create on the Nexus server." });
  const raw = (await request.json().catch(() => ({}))) as { loginId?: unknown; password?: unknown };
  const loginId = typeof raw.loginId === "string" ? raw.loginId.slice(0, 120) : "";
  const password = typeof raw.password === "string" ? raw.password.slice(0, 256) : "";
  if (!loginId.trim() || !password) return jsonResponse(400, { ok: false, error: "Enter your login ID and password." });
  const result = await signIn({ loginId, password, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") });
  if (!result.ok) return jsonResponse(result.status, { ok: false, error: result.message });
  return new Response(JSON.stringify({ ok: true, totpRequired: result.totpRequired }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": cookieHeader(result.token) },
  });
}
