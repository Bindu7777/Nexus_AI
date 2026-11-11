"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { PublicConnection, TestOutcome } from "../server/connections";
import { type ConnectionKind, type FieldDef, type ProviderDef, readOnlyRoleSql } from "../providers";
import { adminFetch, useAdmin } from "./client";
import { IAlert, IArrow, ICheck, ILock, IRefresh, IShield, IX } from "./icons";

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

// ---------- test result ----------
export function TestResult({ outcome }: { outcome: TestOutcome }) {
  const tone = outcome.ok ? "ok" : outcome.supported ? "bad" : "warn";
  return (
    <div className={`callout ${tone}${outcome.ok ? " test-pass" : ""}`} role="status" aria-live="polite">
      {outcome.ok ? <ICheck /> : outcome.supported ? <IX /> : <IAlert />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>{outcome.ok ? "Connection works, read-only." : outcome.supported ? "Nexus could not use this connection yet." : "Saved as pending."}</strong>
        {outcome.reached.length ? (
          <>
            <p className="small" style={{ marginTop: 8 }}>Nexus reached:</p>
            <ul className="small">{outcome.reached.map((r) => <li key={r}>{r}</li>)}</ul>
          </>
        ) : null}
        {outcome.problems.length ? (
          <>
            <p className="small" style={{ marginTop: 8 }}>What to fix:</p>
            <ul className="small">{outcome.problems.map((r) => <li key={r}>{r}</li>)}</ul>
          </>
        ) : null}
        {outcome.warnings.length ? (
          <ul className="small" style={{ color: "var(--amber-text)" }}>{outcome.warnings.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : null}
        {outcome.readOnly.length ? (
          <p className="small" style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <ILock className="i14" />
            <span>{outcome.readOnly.join(" ")}</span>
          </p>
        ) : null}
      </div>
      {outcome.ok ? (
        <svg className="burst" viewBox="0 0 34 34" aria-hidden="true">
          <circle cx="17" cy="17" r="15" />
          <path d="m10 17.5 4.5 4.5L24 12.5" />
        </svg>
      ) : null}
    </div>
  );
}

// ---------- one connection ----------
function initialValues(provider: ProviderDef, existing: PublicConnection | null) {
  const values: Record<string, string | number | boolean> = {};
  for (const f of provider.fields) {
    const saved = existing?.provider === provider.id ? existing.config[f.name] : undefined;
    values[f.name] = saved ?? f.defaultValue ?? (f.type === "checkbox" ? false : "");
  }
  return values;
}

function Field({ field, value, error, onChange, id }: { field: FieldDef; value: string | number | boolean; error?: string; onChange: (v: string | boolean) => void; id: string }) {
  if (field.type === "checkbox") {
    return (
      <div className="field full">
        <label className="check" htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>
            {field.label}
            {field.help ? <span className="help" style={{ display: "block" }}>{field.help}</span> : null}
          </span>
        </label>
      </div>
    );
  }
  return (
    <div className={`field${field.type === "textarea" ? " full" : ""}`} data-invalid={Boolean(error)}>
      <label htmlFor={id}>
        {field.label}
        {field.required ? "" : <span className="muted"> (optional)</span>}
      </label>
      {field.type === "textarea" ? (
        <textarea id={id} className="input" value={String(value)} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "select" ? (
        <select id={id} className="input" value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input id={id} className="input" type={field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "url" ? "url" : "text"} value={String(value)} min={field.min} max={field.max} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.help ? <span className="help">{field.help}</span> : null}
      {error ? <span className="err">{error}</span> : null}
    </div>
  );
}

export function ConnectionStep({
  companyId,
  kind,
  title,
  blurb,
  providers,
  existing,
  optional = false,
}: {
  companyId: number;
  kind: ConnectionKind;
  title: string;
  blurb: string;
  providers: ProviderDef[];
  existing: PublicConnection | null;
  optional?: boolean;
}) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [providerId, setProviderId] = useState(existing?.provider ?? (optional ? "" : providers[0].id));
  const provider = useMemo(() => providers.find((p) => p.id === providerId) ?? null, [providers, providerId]);
  const [values, setValues] = useState(() => (provider ? initialValues(provider, existing) : {}));
  const [secret, setSecret] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [saved, setSaved] = useState<PublicConnection | null>(existing);
  const [outcome, setOutcome] = useState<TestOutcome | null>(existing?.lastTest ?? null);
  const [busy, setBusy] = useState<"" | "save" | "test" | "remove">("");
  const [dirty, setDirty] = useState(false);

  function pick(id: string) {
    setProviderId(id);
    const p = providers.find((x) => x.id === id);
    setValues(p ? initialValues(p, existing) : {});
    setErrors({});
    setOutcome(null);
    setDirty(true);
  }

  function clientErrors() {
    const e: Record<string, string> = {};
    if (!provider) return e;
    for (const f of provider.fields) {
      const v = values[f.name];
      if (f.required && (v === "" || v == null)) e[f.name] = `${f.label} is required.`;
      if (f.type === "url" && v && !/^https?:\/\//.test(String(v))) e[f.name] = `${f.label} must start with https://.`;
    }
    const sameProvider = saved?.provider === provider.id && saved.hasSecret;
    if (provider.secret?.required && !secret && !sameProvider) e.__secret = `${provider.secret.label} is required.`;
    return e;
  }

  async function save(): Promise<boolean> {
    if (!provider) return false;
    const e = clientErrors();
    setErrors(e);
    if (Object.keys(e).length) return false;
    setBusy("save");
    setMsg("");
    const r = await adminFetch<{ connection: PublicConnection }>(csrf, `/api/nexus-admin/companies/${companyId}/connections/${kind}`, "PUT", {
      provider: provider.id,
      config: values,
      secret: secret || undefined,
    });
    setBusy("");
    if (!r.ok) {
      setErrors(r.fields ?? {});
      setMsg(r.error);
      return false;
    }
    setSaved(r.connection);
    setSecret("");
    setDirty(false);
    setOutcome(null);
    router.refresh();
    return true;
  }

  async function test() {
    if ((dirty || !saved) && !(await save())) return;
    setBusy("test");
    setOutcome(null);
    const r = await adminFetch<{ outcome: TestOutcome }>(csrf, `/api/nexus-admin/companies/${companyId}/connections/${kind}`, "POST", {});
    setBusy("");
    if (!r.ok) setMsg(r.error);
    else setOutcome(r.outcome);
    router.refresh();
  }

  async function remove() {
    setBusy("remove");
    const r = await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/connections/${kind}`, "DELETE");
    setBusy("");
    if (r.ok) {
      setSaved(null);
      setOutcome(null);
      setProviderId(optional ? "" : providers[0].id);
      router.refresh();
    }
  }

  const dbProvider = kind === "database" && provider ? provider.id : null;

  return (
    <section className="card card-pad stack" aria-labelledby={`h-${kind}`}>
      <div className="spread">
        <div>
          <h2 id={`h-${kind}`}>{title}</h2>
          <p className="muted small" style={{ marginTop: 4 }}>{blurb}</p>
        </div>
        <span className="chip chip-info"><IShield />Read-only</span>
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, marginBottom: 8 }}>Provider</legend>
        <div className="provider-pick">
          {optional ? (
            <label>
              <input type="radio" name={`p-${kind}`} checked={providerId === ""} onChange={() => pick("")} />
              None
            </label>
          ) : null}
          {providers.map((p) => (
            <label key={p.id}>
              <input type="radio" name={`p-${kind}`} checked={providerId === p.id} onChange={() => pick(p.id)} />
              {p.label}
              {!p.implemented ? <small>· test not available yet</small> : null}
            </label>
          ))}
        </div>
      </fieldset>

      {provider ? (
        <>
          <div className="form-grid">
            {provider.fields.map((f) => (
              <Field
                key={`${provider.id}-${f.name}`}
                id={`${kind}-${f.name}`}
                field={f}
                value={values[f.name] ?? ""}
                error={errors[f.name]}
                onChange={(v) => {
                  setValues({ ...values, [f.name]: v });
                  setDirty(true);
                }}
              />
            ))}
            {provider.secret ? (
              <div className="field full" data-invalid={Boolean(errors.__secret)}>
                <label htmlFor={`${kind}-secret`}>{provider.secret.label}</label>
                {saved?.hasSecret && saved.provider === provider.id ? (
                  <div className="secret-row small">
                    <span className="secret-mask" aria-label="Saved secret, hidden">{saved.secretMask}</span>
                    <span className="muted">Saved and encrypted. It is never shown again. Type a new value to replace it.</span>
                  </div>
                ) : null}
                <input
                  id={`${kind}-secret`}
                  className="input mono"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secret}
                  placeholder={saved?.hasSecret && saved.provider === provider.id ? "Leave blank to keep the saved value" : ""}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    setDirty(true);
                  }}
                />
                <span className="help">{provider.secret.help}</span>
                {errors.__secret ? <span className="err">{errors.__secret}</span> : null}
              </div>
            ) : null}
          </div>

          {dbProvider ? (
            <details className="card" style={{ boxShadow: "none" }}>
              <summary className="card-pad" style={{ cursor: "pointer", fontWeight: 600 }}>
                How to create a read-only role for {provider.label}
              </summary>
              <div style={{ padding: "0 20px 20px" }}>
                <pre className="sql">{readOnlyRoleSql(dbProvider, String(values.database || "your_db"), String(values.schemas || "public"))}</pre>
              </div>
            </details>
          ) : null}

          {msg ? <p className="callout bad" role="alert"><IX />{msg}</p> : null}
          {outcome ? <TestResult outcome={outcome} /> : null}

          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={save} disabled={busy !== ""}>
              {busy === "save" ? <span className="spin" aria-hidden="true" /> : null}
              Save
            </button>
            <button type="button" className="btn btn-blue" onClick={test} disabled={busy !== ""}>
              {busy === "test" ? <span className="spin" aria-hidden="true" /> : <IRefresh />}
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
            {saved ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={busy !== ""}>
                Remove
              </button>
            ) : null}
            {dirty ? <span className="muted small">Unsaved changes</span> : saved ? <span className="muted small">Saved</span> : null}
          </div>
        </>
      ) : (
        <p className="muted small">No {title.toLowerCase()} for this company. You can add one later.</p>
      )}
    </section>
  );
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
