import { clientIp, portalJson, requirePortalApi } from "@/portal/server/auth";
import { addFeedback, findForCaller } from "@/portal/server/investigations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** { kind: cause_correct | cause_wrong | fix_worked | fix_failed, note? } */
export async function POST(request: Request, { params }: Ctx) {
  const ctx = requirePortalApi(request);
  if (ctx instanceof Response) return ctx;
  const row = findForCaller(ctx, (await params).id);
  if (!row) return portalJson(404, { ok: false, error: "Investigation not found." });
  const raw = (await request.json().catch(() => ({}))) as { kind?: unknown; note?: unknown };
  const r = addFeedback(ctx, row, String(raw.kind ?? ""), typeof raw.note === "string" ? raw.note : "", clientIp(request.headers));
  return r.ok ? portalJson(200, { ok: true }) : portalJson(400, { ok: false, error: r.error });
}
