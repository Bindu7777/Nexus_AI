import { isStep } from "@/nexus-admin/onboarding";
import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { audit } from "@/nexus-admin/server/audit";
import { getCompany, goLive, goLiveBlockers, pauseCompany, resumeCompany, setOnboardingStep, updateCompany, validateDetails } from "@/nexus-admin/server/companies";
import { listCompanyConnectors } from "@/nexus-admin/server/connectors";
import { listUsers } from "@/nexus-admin/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, () => {
    const company = getCompany(idParam(id));
    if (!company) return bad("Company not found.", {}, 404);
    return ok({ company, connectors: listCompanyConnectors(company.id), users: listUsers(company.id), goLiveBlockers: goLiveBlockers(company.id) });
  });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(id);
    const b = await body(req);
    if (typeof b.step === "string") {
      if (!isStep(b.step)) return bad("Unknown step.");
      setOnboardingStep(companyId, b.step);
      audit({ actor: ctx.actor, action: "onboarding.step_saved", result: "info", companyId, target: b.step, ip: ctx.ip });
      return ok();
    }
    const { details, errors } = validateDetails(b);
    if (Object.keys(errors).length) return bad("Check the highlighted fields.", { fields: errors });
    updateCompany(companyId, details, ctx.actor, ctx.ip);
    return ok();
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(id);
    const b = await body(req);
    if (b.action === "pause") pauseCompany(companyId, ctx.actor, ctx.ip);
    else if (b.action === "resume") resumeCompany(companyId, ctx.actor, ctx.ip);
    else if (b.action === "go-live") goLive(companyId, ctx.actor, ctx.ip);
    else return bad("Unknown action.");
    return ok({ company: getCompany(companyId) });
  });
}
