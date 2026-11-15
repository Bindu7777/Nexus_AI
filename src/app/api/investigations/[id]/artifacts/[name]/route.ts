import fs from "node:fs";
import path from "node:path";
import { portalJson, requirePortalApi } from "@/portal/server/auth";
import { artifactDir, findForCaller } from "@/portal/server/investigations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; name: string }> };

/** A reproduction screenshot, for someone allowed to see the investigation. Only run-N.png names exist. */
export async function GET(request: Request, { params }: Ctx) {
  const ctx = requirePortalApi(request);
  if (ctx instanceof Response) return ctx;
  const p = await params;
  const row = findForCaller(ctx, p.id);
  if (!row || !/^run-\d{1,2}\.png$/.test(p.name)) return portalJson(404, { ok: false, error: "Not found." });
  const file = path.join(artifactDir(row.id), p.name);
  if (!fs.existsSync(file)) return portalJson(404, { ok: false, error: "Not found." });
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": `inline; filename="${p.name}"` },
  });
}
