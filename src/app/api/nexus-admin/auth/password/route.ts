import { adminRoute, bad, body, ok } from "@/nexus-admin/server/api";
import { changePassword } from "@/nexus-admin/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return adminRoute(request, async (ctx, req) => {
    const b = await body(req);
    const current = typeof b.current === "string" ? b.current : "";
    const next = typeof b.next === "string" ? b.next : "";
    if (next !== b.confirm) return bad("The new passwords do not match.");
    const result = await changePassword(ctx, current, next, ctx.ip);
    return result.ok ? ok() : bad(result.message);
  });
}
