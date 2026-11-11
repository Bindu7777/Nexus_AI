import { adminRoute, ok } from "@/nexus-admin/server/api";
import { auditFilterFromUrl, queryAudit } from "@/nexus-admin/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return adminRoute(request, (_ctx, req) => ok(queryAudit(auditFilterFromUrl(new URL(req.url)))));
}
