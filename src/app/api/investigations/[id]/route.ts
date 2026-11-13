import { clientIp, portalJson, requirePortalApi } from "@/portal/server/auth";
import { findForCaller, investigationView, recordView } from "@/portal/server/investigations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const ctx = requirePortalApi(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const row = findForCaller(ctx, id);
  // Same answer for "does not exist" and "belongs to someone else".
  if (!row) return portalJson(404, { ok: false, error: "Investigation not found." });
  recordView(ctx, row, clientIp(request.headers));
  return portalJson(200, { ok: true, investigation: investigationView(row) });
}
