import { changeEmployeePassword, clientIp, portalJson, requirePortalApi } from "@/portal/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change the password. Works while a temporary password must still be changed. */
export async function POST(request: Request) {
  const ctx = requirePortalApi(request, { allowMustChange: true });
  if (ctx instanceof Response) return ctx;
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const current = typeof raw.current === "string" ? raw.current.slice(0, 256) : "";
  const next = typeof raw.next === "string" ? raw.next.slice(0, 257) : "";
  if (next !== raw.confirm) return portalJson(400, { ok: false, error: "The new passwords do not match." });
  const result = await changeEmployeePassword(ctx, current, next, clientIp(request.headers));
  return result.ok ? portalJson(200, { ok: true }) : portalJson(400, { ok: false, error: result.message });
}
