"use client";

// Live investigation view and report. All ticket, log and document text is
// rendered as plain text by React: it is never interpreted as HTML.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { InvestigationView } from "../server/investigations";

type Report = NonNullable<InvestigationView["report"]>;
type Step = InvestigationView["steps"][number];

const I = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="m7 7 10 10M17 7 7 17" />,
  skip: <path d="M6 12h12" />,
  alert: <><path d="M12 3.5 21 19H3L12 3.5Z" /><path d="M12 10v4M12 16.8v.2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.2" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.6" /></>,
  bulb: <><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3Z" /></>,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
};
function Icon({ name, className }: { name: keyof typeof I; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {I[name]}
    </svg>
  );
}

const VERDICT_TONE: Record<string, { tone: "verified" | "abstain" | "neutral"; icon: keyof typeof I }> = {
  diagnosed_verified: { tone: "verified", icon: "check" },
  diagnosed: { tone: "verified", icon: "check" },
  not_reproduced: { tone: "abstain", icon: "info" },
  not_enough_evidence: { tone: "abstain", icon: "info" },
  needs_more_information: { tone: "abstain", icon: "info" },
  failed: { tone: "neutral", icon: "alert" },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const dur = (ms: number | null) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

async function post(url: string, csrf: string, body: unknown) {
  try {
    const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify(body) });
    return (await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }))) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "The Nexus server could not be reached." };
  }
}

export function LiveInvestigation({ initial, csrf }: { initial: InvestigationView; csrf: string }) {
  const [view, setView] = useState(initial);
  const [lost, setLost] = useState(false);
  const live = view.status === "queued" || view.status === "running";

  useEffect(() => {
    if (!live) return;
    const es = new EventSource(`/api/investigations/${initial.id}/events`);
    es.addEventListener("update", (e) => {
      setLost(false);
      setView(JSON.parse((e as MessageEvent).data) as InvestigationView);
    });
    es.addEventListener("end", () => es.close());
    es.onerror = () => setLost(true);
    return () => es.close();
  }, [initial.id, live]);

  const gather = view.steps.find((s) => s.stage === "gather");
  const sources = ((gather?.detail as { sources?: Report["sources"] })?.sources ?? view.report?.sources ?? []) as Report["sources"];

  return (
    <div className="inv">
      <Link href="/portal" className="inv-back"><Icon name="back" />Investigate another defect</Link>
      <header className="inv-head">
        <div>
          <p className="muted small">
            {view.ticketSource === "jira" ? "Jira" : "GitHub Issues"} · started {fmt(view.createdAt)}
            {view.owner ? ` by ${view.owner.name || view.owner.employeeId}` : ""}
          </p>
          <h1 className="inv-key mono">{view.ticketKey}</h1>
          {view.report?.ticket?.title ? <p className="inv-title">{view.report.ticket.title}</p> : null}
        </div>
        <div className="inv-state">
          {view.status === "queued" ? <span className="tag tag-live"><span className="pulse" />Queued{view.queuePosition ? `, position ${view.queuePosition}` : ""}</span> : null}
          {view.status === "running" ? <span className="tag tag-live"><span className="pulse" />Investigating</span> : null}
          {view.status === "cancelled" ? <span className="tag tag-neutral">Cancelled</span> : null}
          {live ? <CancelButton id={view.id} csrf={csrf} /> : null}
          {view.report?.ticket?.url ? (
            <a className="btn btn-ghost btn-sm" href={view.report.ticket.url} target="_blank" rel="noopener noreferrer">Open in {view.ticketSource === "jira" ? "Jira" : "GitHub"}</a>
          ) : null}
        </div>
      </header>
      {lost && live ? <p className="note warn small"><Icon name="alert" />Live updates paused. They resume automatically; the investigation keeps running on the server.</p> : null}

      <section className="stages" aria-label="Progress" aria-live="polite">
        <ol>
          {view.steps.map((s) => (
            <StageRow key={s.stage} step={s} sources={s.stage === "gather" ? sources : []} />
          ))}
        </ol>
      </section>

      {view.report && view.status !== "cancelled" ? <ReportView view={view} report={view.report} csrf={csrf} /> : null}
    </div>
  );
}

function StageRow({ step, sources }: { step: Step; sources: Report["sources"] }) {
  const icon = step.status === "done" ? "check" : step.status === "failed" ? "x" : step.status === "skipped" ? "skip" : null;
  return (
    <li className={`stage ${step.status}`}>
      <span className="stage-dot" aria-hidden="true">{icon ? <Icon name={icon} /> : step.position}</span>
      <div className="stage-body">
        <div className="stage-line">
          <strong>{step.title}</strong>
          <span className="stage-status">
            {step.status === "running" ? "Working…" : step.status === "pending" ? "Waiting" : step.status === "done" ? "Done" : step.status === "skipped" ? "Skipped" : "Failed"}
            {step.durationMs != null && step.status !== "skipped" ? ` · ${dur(step.durationMs)}` : ""}
          </span>
        </div>
        {step.summary ? <p className="stage-summary">{step.summary}</p> : null}
        {sources.length ? (
          <ul className="srcs">
            {sources.map((s) => (
              <li key={s.name} className={`src ${s.status}`}>
                <span className="src-mark" aria-hidden="true">{s.status === "ok" ? "●" : s.status === "failed" ? "×" : "○"}</span>
                <strong>{s.name}</strong>
                <span className="muted">{s.status === "ok" ? s.message : s.status === "empty" ? "Nothing matched" : s.status === "failed" ? `Could not read: ${s.message}` : s.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function CancelButton({ id, csrf }: { id: string; csrf: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post(`/api/investigations/${id}/cancel`, csrf, {});
      }}
    >
      {busy ? "Cancelling…" : "Cancel"}
    </button>
  );
}

function ReportView({ view, report, csrf }: { view: InvestigationView; report: Report; csrf: string }) {
  const t = VERDICT_TONE[report.verdict] ?? VERDICT_TONE.failed;
  const causes = report.findings.filter((f) => f.kind === "cause");
  const leads = report.findings.filter((f) => f.kind === "weak_lead");
  const bySource = new Map<string, InvestigationView["evidence"]>();
  for (const e of view.evidence) {
    const key = e.source;
    bySource.set(key, [...(bySource.get(key) ?? []), e]);
  }
  return (
    <article className="report" aria-label="Report">
      <section className={`verdict ${t.tone}`}>
        <span className="verdict-icon"><Icon name={t.icon} /></span>
        <div>
          <p className="verdict-label">{report.verdictLabel}</p>
          <p className="verdict-reason">{report.reason}</p>
          <p className="verdict-meta">
            {report.verdictDescription} Finished {fmt(view.finishedAt)} · {report.sources.filter((s) => s.status === "ok").map((s) => s.name).join(", ") || "no sources"} read.
          </p>
        </div>
      </section>

      {report.missingInformation.length ? (
        <section className="block">
          <h2>What to add to {view.ticketKey}</h2>
          <ol className="missing">{report.missingInformation.map((m) => <li key={m}>{m}</li>)}</ol>
          <p className="muted small">Update the ticket, then start the investigation again.</p>
        </section>
      ) : null}

      {report.spec && !report.missingInformation.length ? (
        <section className="block">
          <h2>The defect, as read from the ticket</h2>
          <dl className="spec">
            <dt>Steps</dt>
            <dd><ol>{report.spec.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></dd>
            <dt>Expected</dt>
            <dd>{report.spec.expected}</dd>
            <dt>Actual</dt>
            <dd>{report.spec.actual}</dd>
            {report.spec.environment ? (<><dt>Environment</dt><dd>{report.spec.environment}</dd></>) : null}
            {report.spec.errorMessages.length ? (<><dt>Error text</dt><dd className="mono">{report.spec.errorMessages.join(" · ")}</dd></>) : null}
          </dl>
          <p className="muted small"><span className="tag tag-neutral">Inferred</span> Summarised from the ticket by fixed rules. The ticket itself is listed under evidence.</p>
        </section>
      ) : null}

      {report.reproduction ? <ReproductionView id={view.id} repro={report.reproduction} /> : null}
      {report.liveLogs?.length ? (
        <section className="block">
          <h2>Live server logs during the reproduction</h2>
          <ul className="leads">
            {report.liveLogs.map((l) => (
              <li key={l.source}>
                <span className={`tag ${l.status === "failed" ? "tag-abstain" : l.serverErrors ? "tag-abstain" : "tag-neutral"}`}>{l.source}</span> {l.message}
              </li>
            ))}
          </ul>
          <p className="muted small"><span className="tag tag-neutral">Observed</span> The lines themselves are listed under evidence, from the Reproduce stage.</p>
        </section>
      ) : null}

      {report.missingInformation.length ? null : (
      <section className="block">
        <h2>Likely causes</h2>
        {causes.length ? (
          <ol className="causes">
            {causes.map((f) => (
              <li key={`${f.detectorId}-${f.rank}`} className="cause">
                <div className="spread">
                  <strong>{f.cause}</strong>
                  <span className="tag tag-ok"><Icon name="check" />Score {f.score.toFixed(2)} · {f.detectorId}</span>
                </div>
                <p className="muted small">Rule: {f.rule}{f.tiedWith.length ? ` · tied with ${f.tiedWith.join(", ")}` : ""}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="abstain-note"><Icon name="info" />No cause passed its threshold. Nexus does not guess: the evidence it read and what it could not verify are below.</p>
        )}
        {leads.length ? (
          <ul className="leads">{leads.map((f) => <li key={`${f.detectorId}-${f.rank}`}>Weak lead, not a cause: {f.cause} (score {f.score.toFixed(2)}, needs {f.threshold.toFixed(2)})</li>)}</ul>
        ) : null}
      </section>
      )}

      {report.located.length ? (
        <section className="block">
          <h2>Code tied to the ticket</h2>
          <ul className="located">
            {report.located.map((l) => (
              <li key={l.path}>
                <code>{l.path}{l.startLine ? `:${l.startLine}${l.endLine && l.endLine !== l.startLine ? `-${l.endLine}` : ""}` : ""}</code>
                <span className="muted small">{l.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="block">
        <h2>Evidence <span className="muted small">({view.evidence.length})</span></h2>
        {view.evidence.length === 0 ? <p className="muted">No evidence was collected.</p> : null}
        {[...bySource.entries()].map(([source, items]) => (
          <div key={source} className="ev-group">
            <h3>{source}</h3>
            <ul className="ev-list">
              {items.map((e) => (
                <li key={e.id}>
                  <details>
                    <summary>
                      <span className="tag tag-evidence"><Icon name="eye" />{e.observation === "observed" ? "Observed" : "Inferred"}</span>
                      <span className="ev-title">{e.title}</span>
                      <span className="ev-time muted small">{fmt(e.timestamp)}</span>
                    </summary>
                    <p className="ev-ref mono small">{e.ref}{e.location?.url ? <> · <a href={e.location.url} target="_blank" rel="noopener noreferrer">open original</a></> : null}</p>
                    {e.excerpt ? <pre className="ev-excerpt">{e.excerpt}</pre> : null}
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {report.couldNotVerify.length ? (
        <section className="block">
          <h2>What could not be verified</h2>
          <ul className="gaps">{report.couldNotVerify.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </section>
      ) : null}

      <section className="block two">
        <div>
          <h2>Suggested fix</h2>
          <p className="muted"><Icon name="bulb" className="i16" /> None. {report.findings.some((f) => f.kind === "cause") ? "A cause was found, but no model endpoint is configured to draft a patch." : "Nexus suggests a fix only when the evidence supports a cause."} Nothing is ever applied without a person approving it.</p>
        </div>
        <div>
          <h2>Validation</h2>
          <p className="muted">{report.validation}</p>
        </div>
      </section>

      {report.notDrafted.length ? <p className="muted small">{report.notDrafted.join(" ")}</p> : null}

      <section className="block">
        <h2>Timeline</h2>
        <ol className="timeline">
          {view.steps.map((s) => (
            <li key={s.stage}><span>{s.title}</span><span className="muted">{s.status}{s.durationMs != null && s.status !== "skipped" ? ` · ${dur(s.durationMs)}` : ""}</span></li>
          ))}
        </ol>
      </section>

      {view.status === "done" ? <Feedback id={view.id} csrf={csrf} given={view.feedback.map((f) => f.kind)} /> : null}
    </article>
  );
}

function Feedback({ id, csrf, given }: { id: string; csrf: string; given: string[] }) {
  const [sent, setSent] = useState<string | null>(given.find((g) => g.startsWith("cause_")) ?? null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  async function send(kind: string) {
    const r = await post(`/api/investigations/${id}/feedback`, csrf, { kind, note });
    if (r.ok) setSent(kind);
    else setErr(r.error ?? "Not saved.");
  }
  return (
    <section className="block feedback">
      <h2>Was this right?</h2>
      {sent ? (
        <p className="muted"><Icon name="check" className="i16" /> Thanks. Recorded as “{sent === "cause_correct" ? "cause was correct" : "cause was wrong"}”. This feeds Nexus’s accuracy record.</p>
      ) : (
        <>
          <label className="sr-only" htmlFor="fb-note">Note (optional)</label>
          <input id="fb-note" className="input" placeholder="Optional note, for example what the real cause was" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => send("cause_correct")}><Icon name="check" className="i16" />Cause was correct</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => send("cause_wrong")}><Icon name="x" className="i16" />Cause was wrong</button>
          </div>
          {err ? <p className="small" role="alert">{err}</p> : null}
        </>
      )}
    </section>
  );
}

function ReproductionView({ id, repro }: { id: string; repro: NonNullable<Report["reproduction"]> }) {
  if (repro.status === "skipped") {
    return (
      <section className="block">
        <h2>Reproduction</h2>
        <p className="abstain-note"><Icon name="info" />{repro.reason}</p>
      </section>
    );
  }
  const host = new URL(repro.target).hostname;
  return (
    <section className="block">
      <div className="spread">
        <h2>Reproduction</h2>
        <span className={`tag ${repro.reproduced ? "tag-ok" : "tag-abstain"}`}>
          <Icon name={repro.reproduced ? "check" : "info"} />
          {repro.reproduced ? `Reproduced ${repro.reproducedRuns}/${repro.totalRuns}` : repro.inconclusive ? "Inconclusive · needs sign-in" : `Not reproduced 0/${repro.totalRuns}`}
          {repro.flaky ? " · flaky" : ""}
        </span>
      </div>
      <p className="small">
        {repro.summary} On <strong>{host}</strong> as {repro.loggedIn ? "the test account" : "an anonymous visitor"} ·{" "}
        <span className="tag tag-neutral">{repro.mode === "production-read-only" ? "Production · read-only" : "Read-only"}</span>
      </p>
      <details className="repro-basis">
        <summary className="small">How the steps were chosen ({repro.reproduction.basis.length})</summary>
        <ul className="gaps">{repro.reproduction.basis.map((b, i) => <li key={i}>{b}</li>)}</ul>
      </details>
      <div className="repro-runs">
        {repro.runs.map((run) => (
          <div key={run.index} className={`repro-run ${run.reproduced ? "hit" : ""}`}>
            <div className="spread">
              <strong>Run {run.index}</strong>
              <span className="muted small">
                {run.error ? `Did not complete: ${run.error}` : run.reproduced ? "Defect showed up" : "Defect did not show up"} · {dur(run.durationMs)} · {run.requestsSent} requests
              </span>
            </div>
            {run.login ? <p className="muted small">{run.login.message}</p> : null}
            <table className="checks">
              <thead><tr><th>Page</th><th>Check</th><th>Expected</th><th>Actual</th></tr></thead>
              <tbody>
                {run.assertions.map((a, i) => (
                  <tr key={i} className={a.showsDefect ? "defect" : a.passed ? "ok" : ""}>
                    <td className="mono">{a.page}</td>
                    <td>{a.showsDefect ? "✗ " : a.passed ? "✓ " : "· "}{a.name}</td>
                    <td>{a.expected}</td>
                    <td>{a.actual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {run.screenshot ? (
              <a href={`/api/investigations/${id}/artifacts/${run.screenshot}`} target="_blank" rel="noopener noreferrer" className="shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/investigations/${id}/artifacts/${run.screenshot}`} alt={`What the page showed at the end of run ${run.index}`} loading="lazy" />
              </a>
            ) : null}
          </div>
        ))}
      </div>
      {repro.allowedWritesSent?.length ? (
        <div className="small">
          <p><Icon name="info" className="i16" /> Sent {repro.allowedWritesSent.length} save{repro.allowedWritesSent.length === 1 ? "" : "s"} the admin allowed for the test account:</p>
          <ul className="leads">
            {repro.allowedWritesSent.slice(0, 6).map((w, i) => (
              <li key={i} className="mono">
                {w.method} {new URL(w.url).host}{new URL(w.url).pathname} → {w.status ?? "no answer"}{w.contentType ? ` ${w.contentType}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {repro.blockedWrites.length ? (
        <p className="muted small"><Icon name="info" className="i16" /> Blocked {repro.blockedWrites.length} request{repro.blockedWrites.length === 1 ? "" : "s"} that would have saved data, for example {repro.blockedWrites[0].method} {new URL(repro.blockedWrites[0].url).pathname}.</p>
      ) : null}
      {repro.blockedHosts.length ? <p className="muted small"><Icon name="info" className="i16" /> Blocked hosts not on the allow list: {repro.blockedHosts.join(", ")}.</p> : null}
    </section>
  );
}
