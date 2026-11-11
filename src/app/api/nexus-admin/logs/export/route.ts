import { adminRoute } from "@/nexus-admin/server/api";
import { audit, auditCsv, auditFilterFromUrl, queryAudit } from "@/nexus-admin/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return adminRoute(request, (ctx, req) => {
    const filter = { ...auditFilterFromUrl(new URL(req.url)), page: 1, pageSize: 5000 };
    const { rows } = queryAudit(filter);
    audit({ actor: ctx.actor, action: "settings.logs_exported", result: "ok", ip: ctx.ip, detail: { rows: rows.length } });
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(auditCsv(rows), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="nexus-audit-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  });
}
