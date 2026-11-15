import { requirePortalPage } from "@/portal/server/page-guard";
import { ChangePasswordForm } from "@/portal/ui/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a password" };

export default async function PortalChangePassword() {
  const ctx = await requirePortalPage({ allowMustChange: true });
  return (
    <main className="auth-wrap" id="main">
      <ChangePasswordForm csrf={ctx.session.csrf_token} temporary={ctx.user.must_change_password === 1} employeeId={ctx.user.login_id} />
    </main>
  );
}
