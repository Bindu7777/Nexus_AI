import Link from "next/link";
import { NexusMark } from "@/nexus-admin/ui/icons";
import { devBypassEnabled } from "@/nexus-admin/server/dev-bypass";
import { requirePortalPage } from "@/portal/server/page-guard";
import { SignOutButton, ThemeToggle } from "@/portal/ui/auth";

export const dynamic = "force-dynamic";

const initialsOf = (name: string) =>
  name
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function companyMark(name: string) {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const caps = name.match(/[A-Z]/g);
  return (caps && caps.length > 1 ? caps.slice(0, 2).join("") : name.slice(0, 2)).toUpperCase();
}

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const { user, company, session } = await requirePortalPage();
  const name = user.display_name || user.login_id;
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <header className="p-top">
        <Link href="/portal" className="p-brand" aria-label="Nexus home"><NexusMark />Nexus</Link>
        <span className="p-co" title={`${company.name} · code ${company.short_code}`}>
          <span className="p-co-mark" aria-hidden="true">{companyMark(company.name)}</span>
          <span className="p-co-name">{company.name}</span>
        </span>
        <nav className="p-nav" aria-label="Portal">
          <Link href="/portal">Investigate</Link>
          <Link href="/portal/investigations">{user.role === "company_admin" ? "All investigations" : "My investigations"}</Link>
        </nav>
        <span className="p-spacer" />
        {devBypassEnabled() ? (
          <span className="tag tag-evidence" title="NEXUS_DEV_BYPASS_LOGIN is on. Turn it off before anyone else uses this server.">Dev sign-in bypass</span>
        ) : null}
        <ThemeToggle />
        <span className="p-who">
          <span className="p-avatar" aria-hidden="true">{initialsOf(name)}</span>
          <span className="p-who-text">
            <strong>{name}</strong>
            <span>{user.role === "company_admin" ? "Company admin" : `Employee ${user.login_id}`}</span>
          </span>
        </span>
        <Link href="/portal/change-password" className="btn btn-ghost btn-sm p-hide-sm">Password</Link>
        <SignOutButton csrf={session.csrf_token} />
      </header>
      <main className="p-main" id="main">{children}</main>
    </>
  );
}
