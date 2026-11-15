"use client";

import { useState } from "react";

export function LoginForm() {
  const [stage, setStage] = useState<"password" | "code">("password");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(url: string, payload: unknown) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
    return (await res.json().catch(() => ({ ok: false, error: "The server could not be reached." }))) as { ok: boolean; error?: string; totpRequired?: boolean };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (stage === "password") {
        if (!loginId.trim() || !password) {
          setError("Enter your login ID and password.");
          return;
        }
        const r = await post("/api/nexus-admin/auth/login", { loginId, password });
        if (!r.ok) {
          setError(r.error ?? "Sign-in failed.");
          return;
        }
        setPassword("");
        if (r.totpRequired) {
          setStage("code");
          return;
        }
      } else {
        const r = await post("/api/nexus-admin/auth/verify-code", { code });
        if (!r.ok) {
          setError(r.error ?? "That code did not match.");
          return;
        }
      }
      window.location.href = "/nexus-admin";
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {stage === "password" ? (
        <>
          <div className="field">
            <label htmlFor="login-id">Login ID</label>
            <input id="login-id" className="input" autoComplete="username" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="field">
          <label htmlFor="code">Code from your authenticator app</label>
          <input id="code" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </div>
      )}
      {error ? (
        <p className="callout bad" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? <span className="spin" aria-hidden="true" /> : null}
        {stage === "password" ? "Sign in" : "Verify code"}
      </button>
    </form>
  );
}
