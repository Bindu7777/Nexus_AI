import { adminRoute, body, idParam, ok } from "@/nexus-admin/server/api";
import { rotateSecret } from "@/nexus-admin/server/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; connectorId: string }> };

/** Replace one secret. It is tested at once and used only if the test passes. */
export async function POST(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, async (ctx, req) => {
    const b = await body(req);
    const rotated = await rotateSecret({
      companyId: idParam(p.id),
      connectorId: idParam(p.connectorId),
      field: String(b.field ?? ""),
      value: typeof b.value === "string" ? b.value : "",
      actor: ctx.actor,
      ip: ctx.ip,
    });
    return ok(rotated);
  });
}
