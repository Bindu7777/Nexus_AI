import { adminRoute, bad, body, ok } from "@/nexus-admin/server/api";
import { audit } from "@/nexus-admin/server/audit";
import { setTotp, totpSecretFor } from "@/nexus-admin/server/auth";
import { newTotpSecret, otpauthUrl, verifyTotp } from "@/nexus-admin/server/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pending secrets live only in memory until the admin proves they can read codes.
const pending = ((globalThis as { __nexusTotpPending?: Map<number, string> }).__nexusTotpPending ??= new Map());

export function POST(request: Request) {
  return adminRoute(request, async (ctx, req) => {
    const b = await body(req);
    const action = b.action;
    if (action === "start") {
      const secret = newTotpSecret();
      pending.set(ctx.admin.id, secret);
      // Shown once so the admin can add it to an authenticator app.
      return ok({ secret, otpauth: otpauthUrl(secret, ctx.admin.display_name) });
    }
    if (action === "enable") {
      const secret = pending.get(ctx.admin.id);
      if (!secret) return bad("Start the setup again.");
      if (!verifyTotp(secret, String(b.code ?? ""))) return bad("That code did not match. Check the time on your device and try again.");
      setTotp(ctx.admin.id, secret);
      pending.delete(ctx.admin.id);
      audit({ actor: ctx.actor, action: "settings.two_factor_enabled", result: "ok", ip: ctx.ip });
      return ok();
    }
    if (action === "disable") {
      const secret = totpSecretFor(ctx.admin);
      if (!secret || !verifyTotp(secret, String(b.code ?? ""))) return bad("Enter a current code from your authenticator app to turn two-factor sign-in off.");
      setTotp(ctx.admin.id, null);
      audit({ actor: ctx.actor, action: "settings.two_factor_disabled", result: "ok", ip: ctx.ip });
      return ok();
    }
    return bad("Unknown action.");
  });
}
