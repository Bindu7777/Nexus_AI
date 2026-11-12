import { adminRoute, idParam, ok } from "@/nexus-admin/server/api";
import { removeAppUrl } from "@/nexus-admin/server/application";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; urlId: string }> };

export async function DELETE(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, (ctx) => {
    removeAppUrl(idParam(p.id), idParam(p.urlId), ctx.actor, ctx.ip);
    return ok();
  });
}
