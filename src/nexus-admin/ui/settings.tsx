"use client";

import { useState } from "react";
import { adminFetch, useAdmin } from "./client";
import { ICheck, IX } from "./icons";

export function PasswordForm() {
  const { csrf } = useAdmin();
  const [v, setV] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (v.next.length < 12) return setMsg({ ok: false, text: "Use at least 12 characters." });
    if (v.next !== v.confirm) return setMsg({ ok: false, text: "The new passwords do not match." });
    setBusy(true);
    const r = await adminFetch(csrf, "/api/nexus-admin/auth/password", "POST", v);
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Password changed. Other sessions were signed out." } : { ok: false, text: r.error });
    if (r.ok) setV({ current: "", next: "", confirm: "" });
  }
  const field = (key: keyof typeof v, label: string, autoComplete: string) => (
    <div className="field">
      <label htmlFor={`pw-${key}`}>{label}</label>
      <input id={`pw-${key}`} type="password" className="input" autoComplete={autoComplete} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
    </div>
  );
  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="form-grid">
        {field("current", "Current password", "current-password")}
        <span />
        {field("next", "New password (at least 12 characters)", "new-password")}
        {field("confirm", "Type it again", "new-password")}
      </div>
      {msg ? (
        <p className={`callout ${msg.ok ? "ok" : "bad"}`} role={msg.ok ? "status" : "alert"}>
          {msg.ok ? <ICheck /> : <IX />}
          {msg.text}
        </p>
      ) : null}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>Change password</button>
      </div>
    </form>
  );
}
