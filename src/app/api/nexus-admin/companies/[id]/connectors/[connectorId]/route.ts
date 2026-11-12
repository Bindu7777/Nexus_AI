import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { discardPending, getCompanyConnector, removeConnector, updateConnector } from "@/nexus-admin/server/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; connectorId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, () => {
    const connector = getCompanyConnector(idParam(p.id), idParam(p.connectorId));
    return connector ? ok({ connector }) : bad("Connector not found.", {}, 404);
  });
}

/** Change a connector. Once active, the change is held until it passes a test. */
export async function PATCH(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(p.id);
    const connectorId = idParam(p.connectorId);
    const b = await body(req);
    if (b.action === "discard-pending") return ok({ connector: discardPending(companyId, connectorId, ctx.actor, ctx.ip) });
    const result = updateConnector({
      companyId,
      connectorId,
      label: typeof b.label === "string" ? b.label : undefined,
      values: { deployment: b.deployment, config: b.config, scope: b.scope },
      actor: ctx.actor,
      ip: ctx.ip,
    });
    if (!result.ok) return bad("Check the highlighted fields.", { fields: result.errors });
    return ok({ connector: result.connector });
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, (ctx) => {
    removeConnector(idParam(p.id), idParam(p.connectorId), ctx.actor, ctx.ip);
    return ok();
  });
}
