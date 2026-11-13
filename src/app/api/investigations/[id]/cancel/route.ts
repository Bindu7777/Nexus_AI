import { clientIp, portalJson, requirePortalApi } from "@/portal/server/auth";
import { cancelInvestigation, findForCaller } from "@/portal/server/investigations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const ctx = requirePortalApi(request);
  if (ctx instanceof Response) return ctx;
  const row = findForCaller(ctx, (await params).id);
  if (!row) return portalJson(404, { ok: false, error: "Investigation not found." });
  const r = cancelInvestigation(ctx, row, clientIp(request.headers));
  return r.ok ? portalJson(200, { ok: true }) : portalJson(409, { ok: false, error: r.error });
}
