// Server-side guard for portal pages. No session → sign-in. A temporary
// password → the change-password page, before anything else.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PORTAL_COOKIE, portalFromCookieHeader } from "./auth";

export async function requirePortalPage(options: { allowMustChange?: boolean } = {}) {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  const ctx = token ? portalFromCookieHeader(`${PORTAL_COOKIE}=${token}`) : null;
  if (!ctx) redirect("/portal/sign-in");
  if (ctx.user.must_change_password === 1 && !options.allowMustChange) redirect("/portal/change-password");
  return ctx;
}

/** For the sign-in page: an already signed-in employee goes straight in. */
export async function currentPortalSession() {
  const jar = await cookies();
  const token = jar.get(PORTAL_COOKIE)?.value;
  return token ? portalFromCookieHeader(`${PORTAL_COOKIE}=${token}`) : null;
}
