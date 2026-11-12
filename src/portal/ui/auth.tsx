"use client";

import { useEffect, useRef, useState } from "react";
import { ICheck, IX, NexusMark } from "@/nexus-admin/ui/icons";

async function postJson(url: string, payload: unknown, csrf?: string) {
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: JSON.stringify(payload),
    });
    return (await res.json().catch(() => ({ ok: false, error: `The server answered HTTP ${res.status}.` }))) as {
      ok: boolean;
      error?: string;
      mustChangePassword?: boolean;
    };
  } catch {
    return { ok: false, error: "The Nexus server could not be reached. Check your connection and try again." };
  }
}

export function SignInForm() {
  const [code, setCode] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState<{ state: "idle" | "found" | "unknown"; name?: string }>({ state: "idle" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const c = code.trim();
    if (c.length < 2) return setCompany({ state: "idle" });
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/portal/auth/company?code=${encodeURIComponent(c)}`, { credentials: "same-origin" });
        const data = (await r.json()) as { ok: boolean; name?: string | null };
        setCompany(data.ok && data.name ? { state: "found", name: data.name } : { state: "unknown" });
      } catch {
        setCompany({ state: "idle" });
      }
    }, 350);
  }, [code]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!code.trim() || !employeeId.trim() || !password) return setError("Enter your company code, employee ID and password.");
    setBusy(true);
    const r = await postJson("/api/portal/auth/login", { companyCode: code, employeeId, password });
    setBusy(false);
    if (!r.ok) {
      setPassword("");
      return setError(r.error ?? "Sign-in failed.");
    }
    window.location.href = r.mustChangePassword ? "/portal/change-password" : "/portal";
  }

  return (
    <form className="card pad stack auth-card" onSubmit={submit} noValidate aria-labelledby="signin-title">
      <span className="p-brand"><NexusMark />Nexus</span>
      <div>
        <h1 id="signin-title">Sign in to investigate</h1>
        <p className="muted">Use the company code and employee ID from your company admin.</p>
      </div>
      <div className="field">
        <label htmlFor="si-code">Company code</label>
        <input id="si-code" className="input" autoComplete="organization" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HM" aria-describedby="si-code-echo" />
        <div id="si-code-echo" className="company-echo" aria-live="polite">
          {company.state === "found" ? (
            <span className="tag tag-ok"><ICheck />{company.name}</span>
          ) : company.state === "unknown" ? (
            <span className="muted small">No live company found for this code yet. Check it with your company admin.</span>
          ) : null}
        </div>
      </div>
      <div className="field">
        <label htmlFor="si-id">Employee ID</label>
        <input id="si-id" className="input" autoComplete="username" inputMode="text" spellCheck={false} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="221272" />
      </div>
      <div className="field">
        <label htmlFor="si-pw">Password</label>
        <input id="si-pw" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error ? <p className="note bad" role="alert"><IX />{error}</p> : null}
      <button className="btn btn-main" disabled={busy}>
        {busy ? <span className="spin" aria-hidden="true" /> : null}
        Sign in
      </button>
      <p className="faint small">Every sign-in is recorded. Five wrong passwords lock the account for 15 minutes.</p>
    </form>
  );
}

export function ChangePasswordForm({ csrf, temporary, employeeId }: { csrf: string; temporary: boolean; employeeId: string }) {
  const [v, setV] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (v.next.length < 12) return setMsg({ ok: false, text: "Use at least 12 characters." });
    if (v.next.trim() === employeeId.trim()) return setMsg({ ok: false, text: "Do not use your employee ID as the password." });
    if (v.next !== v.confirm) return setMsg({ ok: false, text: "The new passwords do not match." });
    setBusy(true);
    const r = await postJson("/api/portal/auth/password", v, csrf);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "The password was not changed." });
    setMsg({ ok: true, text: "Password changed." });
    window.location.href = "/portal";
  }
  const f = (key: keyof typeof v, label: string, auto: string) => (
    <div className="field">
      <label htmlFor={`pw-${key}`}>{label}</label>
      <input id={`pw-${key}`} type="password" className="input" autoComplete={auto} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
    </div>
  );
  return (
    <form className="card pad stack auth-card" onSubmit={submit} noValidate aria-labelledby="pw-title">
      <span className="p-brand"><NexusMark />Nexus</span>
      <div>
        <h1 id="pw-title">{temporary ? "Choose your own password" : "Change password"}</h1>
        <p className="muted">
          {temporary ? "You signed in with a temporary password. Choose a new one to continue." : "Other devices will be signed out."} At least 12 characters, and not your employee ID.
        </p>
      </div>
      {f("current", temporary ? "Temporary password" : "Current password", "current-password")}
      {f("next", "New password", "new-password")}
      {f("confirm", "New password again", "new-password")}
      {msg ? <p className={`note ${msg.ok ? "ok" : "bad"}`} role={msg.ok ? "status" : "alert"}>{msg.ok ? <ICheck /> : <IX />}{msg.text}</p> : null}
      <button className="btn btn-main" disabled={busy}>{busy ? <span className="spin" aria-hidden="true" /> : null}Save password</button>
    </form>
  );
}

export function SignOutButton({ csrf }: { csrf: string }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await postJson("/api/portal/auth/logout", {}, csrf);
        window.location.href = "/portal/sign-in";
      }}
    >
      Sign out
    </button>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"), []);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("nexus-portal-theme", next);
        } catch {
          /* ignore */
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
      )}
    </button>
  );
}
