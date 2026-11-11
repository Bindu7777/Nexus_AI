// Server-side guard for admin pages. A missing, expired or second-factor-pending
// session redirects to the login page. Links being hidden is never relied on.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminFromCookieHeader } from "./auth";

export async function requireAdminPage() {
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const ctx = adminFromCookieHeader(header);
  if (!ctx) redirect("/nexus-admin/login");
  return ctx;
}
