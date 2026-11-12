"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adminFetch, useAdmin } from "./client";
import { IArrow, IX } from "./icons";

// ---------- company details ----------
type Details = { name: string; short_code: string; contact_name: string; contact_email: string; country: string; notes: string };

export function DetailsForm({ companyId, initial, nextHref }: { companyId?: number; initial?: Partial<Details>; nextHref?: string }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [v, setV] = useState<Details>({ name: "", short_code: "", contact_name: "", contact_email: "", country: "", notes: "", ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = "Enter the company name.";
    if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,15}$/.test(v.short_code.trim())) e.short_code = "Use 2 to 16 letters, digits or dashes, for example ACME.";
    if (!v.contact_name.trim()) e.contact_name = "Enter a primary contact.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.contact_email.trim())) e.contact_email = "Enter a valid email address.";
    return e;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const r = companyId
      ? await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}`, "PATCH", v)
      : await adminFetch<{ id: number }>(csrf, "/api/nexus-admin/companies", "POST", v);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fields ?? {});
      setMsg(r.error);
      return;
    }
    const id = companyId ?? (r as { id: number }).id;
    router.push(nextHref ?? `/nexus-admin/onboard/${id}/code`);
    router.refresh();
  }

  const f = (key: keyof Details, label: string, type = "text", full = false) => (
    <div className={`field${full ? " full" : ""}`} data-invalid={Boolean(errors[key])}>
      <label htmlFor={`d-${key}`}>{label}</label>
      {key === "notes" ? (
        <textarea id={`d-${key}`} className="input" style={{ fontFamily: "var(--font-body)" }} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
      ) : (
        <input id={`d-${key}`} type={type} className="input" value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `d-${key}-err` : undefined} />
      )}
      {errors[key] ? <span className="err" id={`d-${key}-err`}>{errors[key]}</span> : null}
    </div>
  );

  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="form-grid">
        {f("name", "Company name")}
        {f("short_code", "Short code (used at sign-in)")}
        {f("contact_name", "Primary contact name")}
        {f("contact_email", "Primary contact email", "email")}
        {f("country", "Country")}
        {f("notes", "Notes", "text", true)}
      </div>
      {msg ? <p className="callout bad" role="alert"><IX />{msg}</p> : null}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spin" aria-hidden="true" /> : null}
          {companyId ? "Save and continue" : "Create draft and continue"}
          <IArrow />
        </button>
        <span className="muted small">Saved as a draft. You can leave and come back.</span>
      </div>
    </form>
  );
}

// ---------- remember the step ----------
export function RememberStep({ companyId, step }: { companyId: number; step: string }) {
  const { csrf } = useAdmin();
  useEffect(() => {
    void adminFetch(csrf, `/api/nexus-admin/companies/${companyId}`, "PATCH", { step });
  }, [csrf, companyId, step]);
  return null;
}

export function NextStep({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <div className="row" style={{ marginTop: 16 }}>
      <button type="button" className="btn btn-primary" onClick={() => router.push(href)}>
        {label}
        <IArrow />
      </button>
    </div>
  );
}
