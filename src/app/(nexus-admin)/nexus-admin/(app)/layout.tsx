import { devBypassEnabled } from "@/nexus-admin/server/dev-bypass";
import { requireAdminPage } from "@/nexus-admin/server/page-guard";
import { AdminProvider } from "@/nexus-admin/ui/client";
import { Sidebar, Topbar } from "@/nexus-admin/ui/shell";

export const dynamic = "force-dynamic";

export default async function AdminAppLayout({ children }: { children: React.ReactNode }) {
  const { admin, session } = await requireAdminPage();
  return (
    <AdminProvider csrf={session.csrf_token} name={admin.display_name}>
      <div className="shell">
        <Sidebar />
        <div className="main">
          <Topbar />
          <main className="content" id="main">
            {devBypassEnabled() ? (
              <p className="callout warn small" style={{ marginBottom: 16 }}>
                Sign-in bypassed for development (NEXUS_DEV_BYPASS_LOGIN). Turn it off before anyone else uses this server.
              </p>
            ) : null}
            {children}
          </main>
        </div>
      </div>
    </AdminProvider>
  );
}
