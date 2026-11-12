import { checkDefectNumber, defectSources } from "@/portal/server/defects";
import { portalJson, requirePortalApi } from "@/portal/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Checks a defect number against the company's defect connectors. Read-only; nothing is fetched. */
export async function POST(request: Request) {
  const ctx = requirePortalApi(request);
  if (ctx instanceof Response) return ctx;
  const raw = (await request.json().catch(() => ({}))) as { defect?: unknown };
  const result = checkDefectNumber(defectSources(ctx.company.id), typeof raw.defect === "string" ? raw.defect : "");
  return portalJson(result.ok ? 200 : 400, result.ok ? result : { ok: false, error: result.message });
}
