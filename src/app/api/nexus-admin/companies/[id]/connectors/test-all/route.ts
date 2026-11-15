import { adminRoute, idParam, ok } from "@/nexus-admin/server/api";
import { testAllConnectors } from "@/nexus-admin/server/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, async (ctx) => {
    const results = await testAllConnectors(idParam(id), ctx.actor, ctx.ip, "manual");
    return ok({ results: results.map((r) => ({ connector: r.connector, result: r.result, applied: r.applied })) });
  });
}
