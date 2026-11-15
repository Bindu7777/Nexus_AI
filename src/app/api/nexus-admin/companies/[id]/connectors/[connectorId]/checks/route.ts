import { adminRoute, idParam, ok } from "@/nexus-admin/server/api";
import { listChecks } from "@/nexus-admin/server/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; connectorId: string }> };

/** History of tests and status changes for one connector. */
export async function GET(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, () => ok({ checks: listChecks(idParam(p.id), idParam(p.connectorId)) }));
}
