import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { getCompany, linkPlanEntry } from "@/nexus-admin/server/companies";
import { addConnector, listCompanyConnectors } from "@/nexus-admin/server/connectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, () => {
    const companyId = idParam(id);
    if (!getCompany(companyId)) return bad("Company not found.", {}, 404);
    return ok({ connectors: listCompanyConnectors(companyId) });
  });
}

/** Add a connector. Secrets are accepted here and never returned. */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(id);
    if (!getCompany(companyId)) return bad("Company not found.", {}, 404);
    const b = await body(req);
    const result = addConnector({
      companyId,
      registryId: String(b.registryId ?? ""),
      label: typeof b.label === "string" ? b.label : "",
      values: { deployment: b.deployment, config: b.config, scope: b.scope },
      actor: ctx.actor,
      ip: ctx.ip,
    });
    if (!result.ok) return bad("Check the highlighted fields.", { fields: result.errors });
    if (typeof b.planKey === "string") linkPlanEntry(companyId, b.planKey, result.connector.id);
    return ok({ connector: result.connector });
  });
}
