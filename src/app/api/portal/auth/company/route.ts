import { clientIp, lookupCompanyName, portalJson } from "@/portal/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shows a live company's name for a code, so a wrong code is noticed. Rate limited. */
export function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/.test(code.trim())) return portalJson(200, { ok: true, name: null });
  const result = lookupCompanyName(code, clientIp(request.headers));
  if (result.limited) return portalJson(429, { ok: false, error: "Too many lookups. Wait a few minutes." });
  return portalJson(200, { ok: true, name: result.name });
}
