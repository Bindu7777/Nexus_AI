import { LOCK_AFTER, LOCK_MS } from "@/nexus-admin/server/auth";
import { requireAdminPage } from "@/nexus-admin/server/page-guard";
import { ABSOLUTE_MS, IDLE_MS } from "@/nexus-admin/server/sessions";
import { fmtTime } from "@/nexus-admin/ui/chips";
import { PasswordForm } from "@/nexus-admin/ui/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { admin } = await requireAdminPage();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Your account and how sign-in is protected.</p>
        </div>
      </div>
      <div className="stack">
        <section className="card card-pad">
          <h2>Account</h2>
          <dl className="small" style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "6px 12px", margin: 0 }}>
            <dt className="muted">Login ID</dt><dd style={{ margin: 0 }}>{admin.display_name}</dd>
            <dt className="muted">Role</dt><dd style={{ margin: 0 }}>Nexus admin</dd>
            <dt className="muted">Password last changed</dt><dd style={{ margin: 0 }}>{fmtTime(admin.password_changed_at)}</dd>
            <dt className="muted">Two-factor sign-in</dt><dd style={{ margin: 0 }}>{admin.totp_enabled ? "On" : "Off"}</dd>
          </dl>
        </section>
        <section className="card card-pad">
          <h2>Change password</h2>
          <PasswordForm />
        </section>
        <section className="card card-pad">
          <h2>Sign-in protection</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Passwords are stored only as a salted Argon2id hash. No password exists in the code.</li>
            <li>Sign-in is rate limited per address and per login ID. {LOCK_AFTER} failures lock the account for {LOCK_MS / 60000} minutes.</li>
            <li>Sessions use secure, HTTP-only cookies with a CSRF token, end after {IDLE_MS / 60000} minutes idle and {ABSOLUTE_MS / 3600000} hours in total.</li>
            <li>Connector secrets are encrypted with AES-256-GCM using the key in NEXUS_SECRETS_KEY or NEXUS_SECRETS_KEY_FILE. Rotate it with npm run secrets:rotate.</li>
            <li>Single sign-on can be added later behind the same session layer.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
