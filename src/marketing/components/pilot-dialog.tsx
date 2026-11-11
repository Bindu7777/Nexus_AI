"use client";

import { useEffect, useRef, useState } from "react";
import { pilotForm } from "../content";
import { PILOT_EVENT } from "../hooks";
import { IconCheck, IconClose } from "./icons";

type Values = { name: string; email: string; company: string; role: string; teamSize: string; bugs: string; website: string };
const EMPTY: Values = { name: "", email: "", company: "", role: "", teamSize: "", bugs: "", website: "" };

// Light client-side checks. The server validates again with the full schema.
function validate(v: Values) {
  const errors: Partial<Record<keyof Values, string>> = {};
  if (!v.name.trim()) errors.name = "Please enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) errors.email = "Please enter a valid work email.";
  if (!v.company.trim()) errors.company = "Please enter your company.";
  if (!v.role.trim()) errors.role = "Please enter your role.";
  if (!pilotForm.teamSizes.includes(v.teamSize)) errors.teamSize = "Please choose a team size.";
  if (v.bugs.length > 2000) errors.bugs = "Please keep this under 2,000 characters.";
  return errors;
}

export function PilotDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const open = () => {
      const dialog = ref.current;
      if (!dialog || dialog.open) return;
      dialog.showModal();
      window.setTimeout(() => firstRef.current?.focus(), 30);
    };
    window.addEventListener(PILOT_EVENT, open);
    return () => window.removeEventListener(PILOT_EVENT, open);
  }, []);

  function close() {
    ref.current?.close();
    if (status === "done") {
      setValues(EMPTY);
      setStatus("idle");
    }
  }

  function field<K extends keyof Values>(key: K) {
    return {
      id: `pilot-${key}`,
      name: key,
      value: values[key],
      "aria-invalid": errors[key] ? true : undefined,
      "aria-describedby": errors[key] ? `pilot-${key}-err` : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setValues((prev) => ({ ...prev, [key]: event.target.value }));
        if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
      },
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    setFormError("");
    const firstBad = Object.keys(found)[0];
    if (firstBad) {
      document.getElementById(`pilot-${firstBad}`)?.focus();
      return;
    }
    setStatus("sending");
    try {
      const response = await fetch("/api/pilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: Record<string, string> };
      if (response.ok && data.ok) {
        setStatus("done");
        return;
      }
      if (data.fields) setErrors(data.fields as typeof errors);
      setFormError(data.error ?? "Please check the highlighted fields.");
      setStatus("error");
    } catch {
      setFormError("The request could not be sent. Please try again.");
      setStatus("error");
    }
  }

  const err = (key: keyof Values) =>
    errors[key] ? (
      <span className="err" id={`pilot-${key}-err`}>
        {errors[key]}
      </span>
    ) : null;

  return (
    <dialog ref={ref} className="pilot-dialog" aria-labelledby="pilot-title" onClose={() => status === "done" && setStatus("idle")}>
      <div className="pilot-head">
        <div>
          <h2 id="pilot-title">{pilotForm.title}</h2>
          {status !== "done" ? <p>{pilotForm.intro}</p> : null}
        </div>
        <button type="button" className="icon-btn" onClick={close} aria-label="Close">
          <IconClose />
        </button>
      </div>

      {status === "done" ? (
        <div className="pilot-done" role="status">
          <span className="mark mark--verified">
            <IconCheck /> Request saved
          </span>
          <p style={{ fontSize: "var(--fs-lead)" }}>{pilotForm.success}</p>
          <button type="button" className="btn btn--ghost" onClick={close}>
            Close
          </button>
        </div>
      ) : (
        <form className="pilot-form" onSubmit={submit} noValidate>
          <div className="field" data-invalid={!!errors.name}>
            <label htmlFor="pilot-name">{pilotForm.fields.name}</label>
            <input ref={firstRef} type="text" autoComplete="name" required {...field("name")} />
            {err("name")}
          </div>
          <div className="field" data-invalid={!!errors.email}>
            <label htmlFor="pilot-email">{pilotForm.fields.email}</label>
            <input type="email" autoComplete="email" inputMode="email" required {...field("email")} />
            {err("email")}
          </div>
          <div className="field" data-invalid={!!errors.company}>
            <label htmlFor="pilot-company">{pilotForm.fields.company}</label>
            <input type="text" autoComplete="organization" required {...field("company")} />
            {err("company")}
          </div>
          <div className="field" data-invalid={!!errors.role}>
            <label htmlFor="pilot-role">{pilotForm.fields.role}</label>
            <input type="text" autoComplete="organization-title" required {...field("role")} />
            {err("role")}
          </div>
          <div className="field field--full" data-invalid={!!errors.teamSize}>
            <label htmlFor="pilot-teamSize">{pilotForm.fields.teamSize}</label>
            <select required {...field("teamSize")}>
              <option value="">Choose one</option>
              {pilotForm.teamSizes.map((size) => (
                <option key={size} value={size}>
                  {size} engineers
                </option>
              ))}
            </select>
            {err("teamSize")}
          </div>
          <div className="field field--full" data-invalid={!!errors.bugs}>
            <label htmlFor="pilot-bugs">
              {pilotForm.fields.bugs} <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea maxLength={2000} {...field("bugs")} />
            {err("bugs")}
          </div>
          <div className="hp" aria-hidden="true">
            <label htmlFor="pilot-website">Leave this empty</label>
            <input type="text" tabIndex={-1} autoComplete="off" {...field("website")} />
          </div>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="pilot-actions">
            <small>Stored on our own server. Not shared with third parties.</small>
            <button type="submit" className="btn btn--primary" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : pilotForm.submit}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
