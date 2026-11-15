import { portalJson, requirePortalApi } from "@/portal/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who is signed in, for clients such as the IDE plugin. Never includes secrets. */
export function GET(request: Request) {
  const ctx = requirePortalApi(request, { allowMustChange: true });
  if (ctx instanceof Response) return ctx;
  return portalJson(200, {
    ok: true,
    user: { employeeId: ctx.user.login_id, name: ctx.user.display_name, role: ctx.user.role, mustChangePassword: ctx.user.must_change_password === 1 },
    company: { code: ctx.company.short_code, name: ctx.company.name },
    csrf: ctx.session.csrf_token,
  });
}
