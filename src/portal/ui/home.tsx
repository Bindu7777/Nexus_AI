"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type HomeSource = { id: number; name: string; category: string; categoryTitle: string; state: "healthy" | "failing" | "untested" };
export type RecentRun = { id: string; ticketKey: string; status: string; verdict: string | null; verdictLabel: string | null; createdAt: string; queuePosition: number | null };
export type HomeProps = {
  csrf: string;
  recent: RecentRun[];
  firstName: string;
  company: { name: string; code: string; liveSince: string | null; website: string | null };
  sources: HomeSource[];
  defect: { where: string[]; examples: string[]; ready: boolean };
};

type Check = { state: "idle" | "checking" | "ok" | "bad"; key?: string; where?: string; message?: string };

const ICONS: Record<string, React.ReactNode> = {
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  defects: <path d="M9 5.5a3 3 0 0 1 6 0M7 9h10l-1 9a3 3 0 0 1-3 2.5h-2A3 3 0 0 1 8 18L7 9Zm-3 1 3 1m13-1-3 1M4 15h3m10 0h3M12 9v11" />,
  database: <path d="M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3Zm0 0v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />,
  logs: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
  docs: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />,
  tests: <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9" />,
  design: <path d="M4 20 15 9l-4-4L0 16M14 4l6 6M17 7l3-3" />,
  services: <path d="M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Zm0 0h16M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16" />,
};

function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {ICONS[name] ?? ICONS.services}
    </svg>
  );
}

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
const Alert = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5 21 19H3L12 3.5Z" /><path d="M12 10v4M12 16.8v.2" /></svg>
);
const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

function monogram(name: string) {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, " ").trim().split(/\s+/);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const caps = name.match(/[A-Z]/g);
  return (caps && caps.length > 1 ? caps.slice(0, 2).join("") : name.slice(0, 2)).toUpperCase();
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const fmtShort = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function PortalHome({ csrf, recent, firstName, company, sources, defect }: HomeProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [starting, setStarting] = useState(false);
  const [earlier, setEarlier] = useState<{ id: string; key: string; message: string } | null>(null);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [submitted, setSubmitted] = useState<Check | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function validate(text: string): Promise<Check> {
    try {
      const r = await fetch("/api/investigations/check", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ defect: text }),
      });
      if (r.status === 401) {
        window.location.href = "/portal/sign-in";
        return { state: "idle" };
      }
      const data = (await r.json()) as { ok: boolean; key?: string; where?: string; error?: string };
      return data.ok ? { state: "ok", key: data.key, where: data.where } : { state: "bad", message: data.error };
    } catch {
      return { state: "bad", message: "The Nexus server could not be reached. Check your connection." };
    }
  }

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setSubmitted(null);
    const t = value.trim();
    if (!t) return setCheck({ state: "idle" });
    setCheck({ state: "checking" });
    timer.current = setTimeout(async () => setCheck(await validate(t)), 280);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    const t = value.trim();
    if (!t) {
      inputRef.current?.focus();
      return setSubmitted({ state: "bad", message: "Enter a defect number first." });
    }
    const result = await validate(t);
    setCheck(result);
    setSubmitted(result.state === "bad" ? result : null);
    if (result.state === "ok") await launch(t, false);
  }

  async function launch(t: string, force: boolean) {
    setStarting(true);
    setEarlier(null);
    try {
      const r = await fetch("/api/investigations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({ defect: t, force }),
      });
      const data = (await r.json()) as { ok: boolean; id?: string; error?: string; recent?: { id: string } | null };
      if (data.ok && data.id) {
        router.push(`/portal/investigations/${data.id}`);
        return;
      }
      if (r.status === 409 && data.recent) setEarlier({ id: data.recent.id, key: check.key ?? t, message: data.error ?? "" });
      else setSubmitted({ state: "bad", message: data.error ?? "The investigation could not start." });
    } catch {
      setSubmitted({ state: "bad", message: "The Nexus server could not be reached. Check your connection." });
    }
    setStarting(false);
  }

  const healthy = sources.filter((s) => s.state === "healthy").length;
  const failing = sources.filter((s) => s.state === "failing");

  return (
    <div className="home">
      <section className="co-hero" aria-labelledby="co-name">
        <div className="co-id">
          <span className="co-mark" aria-hidden="true">{monogram(company.name)}</span>
          <div>
            <p className="co-kicker">{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</p>
            <h1 id="co-name" className="co-name">{company.name}</h1>
            <p className="co-meta">
              <span className="tag tag-ok"><Check />Live on Nexus</span>
              <span>Company code <strong className="mono">{company.code}</strong></span>
              {company.liveSince ? <span>since {fmtDate(company.liveSince)}</span> : null}
              {company.website ? (
                <a href={company.website} target="_blank" rel="noopener noreferrer">{company.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
              ) : null}
            </p>
          </div>
        </div>
        <div className="co-health" aria-label="Source health">
          <span className="co-health-n">{healthy}<span>/{sources.length}</span></span>
          <span className="muted small">sources healthy</span>
        </div>
      </section>

      <form className="cmd" onSubmit={start} aria-labelledby="cmd-title" noValidate>
        <h2 id="cmd-title" className="cmd-title">Investigate a defect</h2>
        <div className={`cmd-bar ${check.state}`}>
          <span className="cmd-prompt" aria-hidden="true">#</span>
          <label className="sr-only" htmlFor="defect">Defect number</label>
          <input
            id="defect"
            ref={inputRef}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={defect.examples[0] ? `Enter a defect number, for example ${defect.examples[0]}` : "Enter a defect number"}
            aria-describedby="cmd-status cmd-hint"
            aria-invalid={check.state === "bad"}
          />
          <button className="btn btn-main" type="submit" disabled={starting}>
            {starting ? <span className="spin" aria-hidden="true" /> : null}
            {starting ? "Starting…" : <>Start investigation <Arrow /></>}
          </button>
        </div>
        <div id="cmd-status" className="cmd-status" aria-live="polite">
          {check.state === "checking" ? <span className="muted"><span className="spin" aria-hidden="true" /> Checking…</span> : null}
          {check.state === "ok" ? <span className="cmd-ok"><Check /> <strong className="mono">{check.key}</strong> · {check.where}</span> : null}
          {check.state === "bad" ? <span className="cmd-bad"><Alert /> {check.message}</span> : null}
        </div>
        <p id="cmd-hint" className="cmd-hint">
          {defect.ready ? (
            <>
              Reads from {defect.where.join(" and ")}. Press <kbd>Enter</kbd> to start.
              {defect.examples.length ? <> Examples: {defect.examples.map((x) => <code key={x}>{x}</code>)}</> : null}
            </>
          ) : (
            "Your company has no working defect connector yet. Your company admin connects Jira or GitHub Issues."
          )}
        </p>

        {earlier ? (
          <div className="ready" role="status">
            <p>{earlier.message}</p>
            <div className="row">
              <Link className="btn btn-blue btn-sm" href={`/portal/investigations/${earlier.id}`}>Open the earlier report</Link>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => launch(value.trim(), true)} disabled={starting}>Run it again</button>
            </div>
          </div>
        ) : null}
        {submitted?.state === "bad" && check.state !== "bad" ? <p className="cmd-bad small"><Alert /> {submitted.message}</p> : null}
      </form>

      <section aria-labelledby="src-title">
        <div className="spread sec-head">
          <h2 id="src-title">Connected sources</h2>
          {failing.length ? <span className="tag tag-evidence"><Alert />{failing.length} failing, evidence may be incomplete</span> : null}
        </div>
        {sources.length === 0 ? (
          <div className="card empty-state">No sources are connected yet. Your company admin connects them.</div>
        ) : (
          <ul className="src-grid">
            {sources.map((s) => (
              <li key={s.id} className={`src-card ${s.state}`}>
                <span className="src-icon"><Icon name={s.category} /></span>
                <span className="src-text">
                  <strong>{s.name}</strong>
                  <span className="muted small">{s.categoryTitle}</span>
                </span>
                <span className={`src-state ${s.state}`}>
                  {s.state === "healthy" ? <><Check />Healthy</> : s.state === "failing" ? <><Alert />Failing</> : "Not tested"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent-title">
        <div className="spread sec-head">
          <h2 id="recent-title">Your recent investigations</h2>
          {recent.length ? <Link href="/portal/investigations" className="small">See all</Link> : null}
        </div>
        {recent.length === 0 ? (
          <div className="card recent-empty">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <rect x="8" y="6" width="26" height="34" rx="4" />
              <path d="M14 15h14M14 21h14M14 27h8" />
              <circle cx="33" cy="32" r="7" />
              <path d="m38 37 5 5" />
            </svg>
            <div>
              <strong>No investigations yet</strong>
              <p className="muted small">Each report you run lists the evidence it read, what it could not verify, and any suggested fix waiting for your approval.</p>
            </div>
          </div>
        ) : (
          <ul className="hist-list">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/portal/investigations/${r.id}`} className="hist-row">
                  <span className="mono hist-key">{r.ticketKey}</span>
                  <span className={`hist-verdict v-${r.verdict ?? r.status}`}>
                    {r.verdictLabel ?? (r.status === "queued" ? `Queued${r.queuePosition ? ` · #${r.queuePosition}` : ""}` : r.status === "running" ? "Investigating…" : r.status === "cancelled" ? "Cancelled" : r.status)}
                  </span>
                  <span className="muted small">{fmtShort(r.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
