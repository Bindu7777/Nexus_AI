import { clearPortalCookie, clientIp, portalJson, requirePortalApi, signOutEmployee } from "@/portal/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  const ctx = requirePortalApi(request, { allowMustChange: true });
  if (ctx instanceof Response) return portalJson(200, { ok: true }, { "set-cookie": clearPortalCookie() });
  signOutEmployee(ctx, clientIp(request.headers));
  return portalJson(200, { ok: true }, { "set-cookie": clearPortalCookie() });
}
