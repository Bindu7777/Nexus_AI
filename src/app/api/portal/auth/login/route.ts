import { clientIp, portalCookie, portalJson, signInEmployee } from "@/portal/server/auth";

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
  if (!sameOrigin(request)) return portalJson(403, { ok: false, error: "This request could not be verified. Reload the page and try again." });
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companyCode = typeof raw.companyCode === "string" ? raw.companyCode.slice(0, 32) : "";
  const employeeId = typeof raw.employeeId === "string" ? raw.employeeId.slice(0, 120) : "";
  const password = typeof raw.password === "string" ? raw.password.slice(0, 256) : "";
  if (!companyCode.trim() || !employeeId.trim() || !password) {
    return portalJson(400, { ok: false, error: "Enter your company code, employee ID and password." });
  }
  const result = await signInEmployee({ companyCode, employeeId, password, ip: clientIp(request.headers), userAgent: request.headers.get("user-agent") });
  if (!result.ok) return portalJson(result.status, { ok: false, error: result.message });
  return portalJson(200, { ok: true, mustChangePassword: result.mustChangePassword, companyName: result.companyName }, { "set-cookie": portalCookie(result.token) });
}
