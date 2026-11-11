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
            {children}
          </main>
        </div>
      </div>
    </AdminProvider>
  );
}
