import { adminRoute, idParam, ok } from "@/nexus-admin/server/api";
import { testConnector } from "@/nexus-admin/server/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; connectorId: string }> };

/** Read-only test. A pending change is applied only when it passes. */
export async function POST(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, async (ctx) => {
    const tested = await testConnector({ companyId: idParam(p.id), connectorId: idParam(p.connectorId), trigger: "manual", actor: ctx.actor, ip: ctx.ip });
    return ok(tested);
  });
}
