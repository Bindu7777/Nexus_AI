import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { addAppUrl } from "@/nexus-admin/server/application";
import { getCompany } from "@/nexus-admin/server/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Record where the application runs. Reference only; Nexus sends no traffic to it. */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(id);
    if (!getCompany(companyId)) return bad("Company not found.", {}, 404);
    const result = addAppUrl(companyId, await body(req), ctx.actor, ctx.ip);
    return result.ok ? ok({ id: result.id }) : bad("Check the highlighted fields.", { fields: result.errors });
  });
}
