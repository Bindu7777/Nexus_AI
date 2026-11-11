import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { resetUserPassword, setUserDisabled } from "@/nexus-admin/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; userId: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(p.id);
    const userId = idParam(p.userId);
    const b = await body(req);
    if (b.action === "reset") {
      const r = await resetUserPassword(companyId, userId, ctx.actor, ctx.ip);
      return new Response(JSON.stringify({ ok: true, ...r }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (b.action === "disable" || b.action === "enable") {
      setUserDisabled(companyId, userId, b.action === "disable", ctx.actor, ctx.ip);
      return ok();
    }
    return bad("Unknown action.");
  });
}
