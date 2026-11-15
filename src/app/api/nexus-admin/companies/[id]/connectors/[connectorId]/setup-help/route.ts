import { registry } from "@/nexus-admin/connectors/registry";
import { adminRoute, bad, idParam, ok } from "@/nexus-admin/server/api";
import { getCompanyConnector } from "@/nexus-admin/server/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; connectorId: string }> };

/** Setup instructions for a saved connector, for example SQL for a read-only role. */
export async function GET(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, () => {
    const c = getCompanyConnector(idParam(p.id), idParam(p.connectorId));
    if (!c) return bad("Connector not found.", {}, 404);
    const help = registry().get(c.registryId)?.setupHelp?.({ ...c.config, ...c.scope }) ?? "";
    return ok({ help });
  });
}
