import { redirect } from "next/navigation";
import { currentPortalSession } from "@/portal/server/page-guard";
import { SignInForm } from "@/portal/ui/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function PortalSignIn() {
  const ctx = await currentPortalSession();
  if (ctx) redirect(ctx.user.must_change_password ? "/portal/change-password" : "/portal");
  return (
    <main className="auth-wrap" id="main">
      <SignInForm />
    </main>
  );
}
