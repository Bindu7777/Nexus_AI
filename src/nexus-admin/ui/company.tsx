"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TestOutcome } from "../server/connections";
import type { PublicUser } from "../server/users";
import { adminFetch, useAdmin } from "./client";
import { fmtTime } from "./chips";
import { ICheck, ICopy, IPause, IRefresh, IX } from "./icons";
import { TestResult } from "./onboarding";

export function PauseResume({ companyId, paused }: { companyId: number; paused: boolean }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function run(action: "pause" | "resume") {
    setBusy(true);
    await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}`, "POST", { action });
    setBusy(false);
    setConfirm(false);
    router.refresh();
  }
  if (paused) {
    return (
      <button type="button" className="btn btn-blue" disabled={busy} onClick={() => run("resume")}>
        Resume company
      </button>
    );
  }
  return confirm ? (
    <span className="row">
      <span className="small">Pausing blocks every login and ends their sessions now.</span>
      <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => run("pause")}>
        Pause now
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
      <IPause />
      Pause company
    </button>
  );
}

export function Retest({ companyId, kind }: { companyId: number; kind: string }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <a className="btn btn-ghost btn-sm" href={`/nexus-admin/onboard/${companyId}/${kind === "service" ? "logs" : kind}`}>
          Edit
        </a>
        <button
          type="button"
          className="btn btn-blue btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await adminFetch<{ outcome: TestOutcome }>(csrf, `/api/nexus-admin/companies/${companyId}/connections/${kind}`, "POST", {});
            setBusy(false);
            if (r.ok) setOutcome(r.outcome);
            router.refresh();
          }}
        >
          {busy ? <span className="spin" aria-hidden="true" /> : <IRefresh />}
          Retest
        </button>
        {confirmRemove ? (
          <>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={async () => {
                await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/connections/${kind}`, "DELETE");
                router.refresh();
              }}
            >
              Confirm remove
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmRemove(true)}>
            Remove
          </button>
        )}
      </div>
      {outcome ? <TestResult outcome={outcome} /> : null}
    </div>
  );
}

function Reveal({ loginId, password, onDone }: { loginId: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="reveal" role="status">
      <strong>Temporary password for {loginId}</strong>
      <span className="small">Shown once. Copy it now and share it securely. They must choose a new password at first sign-in.</span>
      <div className="row">
        <code aria-label="Temporary password">{password}</code>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(password);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <ICheck /> : <ICopy />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
          I have saved it
        </button>
      </div>
    </div>
  );
}

export function UsersPanel({ companyId, companyCode, users, canCreate, paused }: { companyId: number; companyCode: string; users: PublicUser[]; canCreate: boolean; paused: boolean }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [role, setRole] = useState<"company_admin" | "employee">(users.some((u) => u.role === "company_admin") ? "employee" : "company_admin");
  const [loginId, setLoginId] = useState("");
  const [name, setName] = useState("");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState("");
  const [reveals, setReveals] = useState<{ loginId: string; temporaryPassword: string }[]>([]);
  const [skipped, setSkipped] = useState<{ loginId: string; reason: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!loginId.trim()) return setError(role === "company_admin" ? "Enter the admin's email." : "Enter an employee ID.");
    setBusy(true);
    const r = await adminFetch<{ loginId: string; temporaryPassword: string }>(csrf, `/api/nexus-admin/companies/${companyId}/users`, "POST", { role, loginId, displayName: name });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setReveals([{ loginId: r.loginId, temporaryPassword: r.temporaryPassword }]);
    setLoginId("");
    setName("");
    router.refresh();
  }

  async function bulk() {
    setError("");
    setBusy(true);
    const r = await adminFetch<{ created: { loginId: string; temporaryPassword: string }[]; skipped: { loginId: string; reason: string }[] }>(
      csrf,
      `/api/nexus-admin/companies/${companyId}/users`,
      "POST",
      { csv },
    );
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setReveals(r.created);
    setSkipped(r.skipped);
    setCsv("");
    router.refresh();
  }

  async function act(userId: number, action: "reset" | "disable" | "enable") {
    const r = await adminFetch<{ loginId?: string; temporaryPassword?: string }>(csrf, `/api/nexus-admin/companies/${companyId}/users/${userId}`, "POST", { action });
    if (r.ok && r.temporaryPassword && r.loginId) setReveals([{ loginId: r.loginId, temporaryPassword: r.temporaryPassword }]);
    router.refresh();
  }

  return (
    <div className="stack">
      {reveals.map((r) => (
        <Reveal key={r.loginId} loginId={r.loginId} password={r.temporaryPassword} onDone={() => setReveals((all) => all.filter((x) => x.loginId !== r.loginId))} />
      ))}
      {skipped.length ? (
        <div className="callout warn">
          <div>
            <strong>Some rows were skipped</strong>
            <ul className="small">{skipped.map((s) => <li key={s.loginId}>{s.loginId || "(blank)"}: {s.reason}</li>)}</ul>
          </div>
        </div>
      ) : null}

      {!canCreate || paused ? (
        <p className="callout warn">
          {paused ? "This company is paused, so its logins are blocked. Resume it to create logins." : "Test the code host and the ticket tool successfully before creating logins."}
        </p>
      ) : (
        <div className="grid-2">
          <form className="card card-pad form" onSubmit={create} noValidate>
            <h2>Create a login</h2>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small" style={{ fontWeight: 600, marginBottom: 8 }}>Role</legend>
              <div className="provider-pick">
                <label><input type="radio" checked={role === "company_admin"} onChange={() => setRole("company_admin")} /> Company admin</label>
                <label><input type="radio" checked={role === "employee"} onChange={() => setRole("employee")} /> Employee</label>
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="u-login">{role === "company_admin" ? "Email" : "Employee ID"}</label>
              <input id="u-login" className="input" value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder={role === "company_admin" ? "it-lead@acme.com" : "221272"} />
              <span className="help">They sign in with company code <strong>{companyCode}</strong> plus this {role === "company_admin" ? "email" : "ID"}.</span>
            </div>
            <div className="field">
              <label htmlFor="u-name">Name <span className="muted">(optional)</span></label>
              <input id="u-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error ? <p className="callout bad" role="alert"><IX />{error}</p> : null}
            <button className="btn btn-primary" disabled={busy}>Create login</button>
          </form>
          <div className="card card-pad form">
            <h2>Bulk add employees</h2>
            <div className="field">
              <label htmlFor="u-csv">CSV of employee IDs</label>
              <textarea id="u-csv" className="input" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"employee_id,name\n221272,A. Kumar\n221273,R. Shah"} />
              <span className="help">One per line, optional name after a comma. Each gets a one-time temporary password.</span>
            </div>
            <div className="row">
              <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                Choose CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setCsv((await file.text()).slice(0, 100_000));
                  }}
                />
              </label>
              <button type="button" className="btn btn-blue" disabled={busy || !csv.trim()} onClick={bulk}>
                Add employees
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Login</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last used</th>
                <th>Created</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">No logins yet.</td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.login_id}</strong>
                      {u.display_name ? <span className="muted small"> · {u.display_name}</span> : null}
                    </td>
                    <td>{u.role === "company_admin" ? "Company admin" : "Employee"}</td>
                    <td>
                      {u.disabled_at ? (
                        <span className="chip chip-bad"><IX />Disabled</span>
                      ) : u.must_change_password ? (
                        <span className="chip chip-warn"><IRefresh />Must set password</span>
                      ) : (
                        <span className="chip chip-ok"><ICheck />Active</span>
                      )}
                    </td>
                    <td className="muted small">{fmtTime(u.last_used_at)}</td>
                    <td className="muted small">{fmtTime(u.created_at)}</td>
                    <td>
                      <span className="row" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(u.id, "reset")}>Reset password</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(u.id, u.disabled_at ? "enable" : "disable")}>
                          {u.disabled_at ? "Enable" : "Disable"}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
