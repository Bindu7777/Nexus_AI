import { adminRoute, bad, body, ok } from "@/nexus-admin/server/api";
import { createCompany, listCompanies, validateDetails } from "@/nexus-admin/server/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return adminRoute(request, (_ctx, req) => ok({ companies: listCompanies(new URL(req.url).searchParams.get("q") ?? "") }));
}

export function POST(request: Request) {
  return adminRoute(request, async (ctx, req) => {
    const { details, errors } = validateDetails(await body(req));
    if (Object.keys(errors).length) return bad("Check the highlighted fields.", { fields: errors });
    const id = createCompany(details, ctx.actor, ctx.ip);
    return ok({ id });
  });
}
