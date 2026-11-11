import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { adminCount, adminFromCookieHeader } from "@/nexus-admin/server/auth";
import { secretsKeyConfigured } from "@/nexus-admin/server/crypto";
import { NexusMark } from "@/nexus-admin/ui/icons";
import { LoginForm } from "@/nexus-admin/ui/login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const jar = await cookies();
  if (adminFromCookieHeader(jar.getAll().map((c) => `${c.name}=${c.value}`).join("; "))) redirect("/nexus-admin");
  const noAdmin = adminCount() === 0;
  return (
    <main className="login-wrap">
      <div className="card login-card">
        <div className="row">
          <NexusMark />
          <strong style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>Nexus Admin</strong>
        </div>
        <div>
          <h1>Sign in</h1>
          <p className="muted small" style={{ marginTop: 6 }}>
            For Nexus staff. Every sign-in is recorded.
          </p>
        </div>
        {noAdmin ? (
          <div className="callout warn" role="status">
            <div>
              <strong>No admin account exists yet.</strong>
              <p style={{ marginTop: 6 }}>On the Nexus server, run this once and choose a password:</p>
              <pre className="sql" style={{ marginTop: 8 }}>npm run admin:create</pre>
            </div>
          </div>
        ) : (
          <LoginForm />
        )}
        {!secretsKeyConfigured() ? (
          <p className="callout warn small">
            NEXUS_SECRETS_KEY is not set, so connection credentials cannot be saved yet. Run npm run secrets:generate-key.
          </p>
        ) : null}
      </div>
    </main>
  );
}
