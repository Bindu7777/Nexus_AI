import Link from "next/link";
import { requirePortalPage } from "@/portal/server/page-guard";
import { NexusMark } from "@/nexus-admin/ui/icons";
import { SignOutButton, ThemeToggle } from "@/portal/ui/auth";

export const dynamic = "force-dynamic";

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const { user, company, session } = await requirePortalPage();
  const name = user.display_name || user.login_id;
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <header className="p-top">
        <Link href="/portal" className="p-brand"><NexusMark />Nexus</Link>
        <span className="p-company">{company.name}</span>
        <nav className="p-nav" aria-label="Portal">
          <Link href="/portal">Investigate</Link>
          <Link href="/portal/change-password">Password</Link>
        </nav>
        <span className="p-spacer" />
        <ThemeToggle />
        <span className="p-who">
          <span className="p-avatar" aria-hidden="true">{initials}</span>
          <span>{name}{user.role === "company_admin" ? " · admin" : ""}</span>
        </span>
        <SignOutButton csrf={session.csrf_token} />
      </header>
      <main className="p-main" id="main">{children}</main>
    </>
  );
}
