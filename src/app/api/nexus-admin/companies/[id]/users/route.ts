import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { bulkCreateEmployees, createUser } from "@/nexus-admin/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Create one login ({ role, loginId, displayName }) or bulk employees ({ csv }).
 * The temporary password is returned in this one response only and never stored in plain text.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(id);
    const b = await body(req);
    if (typeof b.csv === "string") {
      const result = await bulkCreateEmployees({ companyId, csv: b.csv, actor: ctx.actor, ip: ctx.ip });
      return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    const role = b.role === "company_admin" ? "company_admin" : b.role === "employee" ? "employee" : null;
    if (!role) return bad("Choose a role.");
    const created = await createUser({ companyId, role, loginId: String(b.loginId ?? ""), displayName: String(b.displayName ?? ""), actor: ctx.actor, ip: ctx.ip });
    return new Response(JSON.stringify({ ok: true, ...created }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  });
}
