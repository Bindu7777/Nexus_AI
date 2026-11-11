import { adminRoute } from "@/nexus-admin/server/api";
import { audit } from "@/nexus-admin/server/audit";
import { clearCookieHeader, revokeSession } from "@/nexus-admin/server/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return adminRoute(request, ({ token, actor, ip }) => {
    revokeSession(token);
    audit({ actor, action: "auth.sign_out", result: "ok", ip });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": clearCookieHeader() },
    });
  });
}
