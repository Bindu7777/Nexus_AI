import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { getApplication, saveApplicationInfo } from "@/nexus-admin/server/application";
import { getCompany } from "@/nexus-admin/server/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, () => {
    const companyId = idParam(id);
    if (!getCompany(companyId)) return bad("Company not found.", {}, 404);
    return ok({ application: getApplication(companyId) });
  });
}

/** Save the application's name and description. */
export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(id);
    if (!getCompany(companyId)) return bad("Company not found.", {}, 404);
    const result = saveApplicationInfo(companyId, await body(req), ctx.actor, ctx.ip);
    return result.ok ? ok({ application: getApplication(companyId) }) : bad("Check the highlighted fields.", { fields: result.errors });
  });
}
