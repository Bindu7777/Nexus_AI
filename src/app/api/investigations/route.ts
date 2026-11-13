import { clientIp, portalJson, requirePortalApi } from "@/portal/server/auth";
import { listForCaller, startInvestigation } from "@/portal/server/investigations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's investigations (a company admin sees the whole company's). */
export function GET(request: Request) {
  const ctx = requirePortalApi(request);
  if (ctx instanceof Response) return ctx;
  const sp = new URL(request.url).searchParams;
  return portalJson(200, { ok: true, investigations: listForCaller(ctx, { verdict: sp.get("verdict") ?? undefined, q: sp.get("q") ?? undefined }) });
}

/** Start an investigation for a defect number. Runs in the background; closing the page does not stop it. */
export async function POST(request: Request) {
  const ctx = requirePortalApi(request);
  if (ctx instanceof Response) return ctx;
  const raw = (await request.json().catch(() => ({}))) as { defect?: unknown; force?: unknown };
  const result = startInvestigation(ctx, typeof raw.defect === "string" ? raw.defect : "", { force: raw.force === true, ip: clientIp(request.headers) });
  if (!result.ok) return portalJson(result.status, { ok: false, error: result.error, recent: result.recent ?? null });
  return portalJson(202, { ok: true, id: result.id, queuePosition: result.queuePosition });
}
