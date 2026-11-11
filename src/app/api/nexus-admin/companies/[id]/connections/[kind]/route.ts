import type { ConnectionKind } from "@/nexus-admin/providers";
import { KINDS } from "@/nexus-admin/providers";
import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { getCompany } from "@/nexus-admin/server/companies";
import { removeConnection, saveConnection, testConnection, validateConnection } from "@/nexus-admin/server/connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; kind: string }> };

function kindOf(raw: string): ConnectionKind {
  if (!KINDS.some((k) => k.kind === raw)) throw new Error("Unknown connection type.");
  return raw as ConnectionKind;
}

/** Save (create or replace). The secret is accepted here and never returned. */
export async function PUT(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(p.id);
    const kind = kindOf(p.kind);
    if (!getCompany(companyId)) return bad("Company not found.", {}, 404);
    const b = await body(req);
    const { provider, config, errors } = validateConnection(kind, String(b.provider ?? ""), (b.config ?? {}) as Record<string, unknown>);
    if (!provider || Object.keys(errors).length) return bad("Check the highlighted fields.", { fields: errors });
    const connection = saveConnection({ companyId, kind, providerId: provider.id, config, secret: typeof b.secret === "string" ? b.secret : null, actor: ctx.actor, ip: ctx.ip });
    return ok({ connection });
  });
}

/** Test the saved connection. Read-only. */
export async function POST(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, async (ctx) => {
    const outcome = await testConnection(idParam(p.id), kindOf(p.kind), ctx.actor, ctx.ip);
    return ok({ outcome });
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, (ctx) => {
    removeConnection(idParam(p.id), kindOf(p.kind), ctx.actor, ctx.ip);
    return ok();
  });
}
