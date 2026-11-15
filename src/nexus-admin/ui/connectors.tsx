"use client";

// Connector screens. Everything here renders from the registry's form models,
// so there is no per-tool code: a new definition file shows up automatically.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormModel, FormModelField } from "../connectors/form";
import type { Deployment, FieldValue, Values } from "../connectors/types";
import type { ToolPlan, ToolPlanEntry } from "../server/companies";
import type { CheckResult, CheckRow, PublicConnector } from "../server/connectors";
import { fmtTime } from "./chips";
import { adminFetch, useAdmin } from "./client";
import { IAlert, ICheck, IClock, ILock, IPlus, IRefresh, IShield, IX } from "./icons";

type Category = { id: string; title: string; blurb: string };

// ---------- status ----------

export function HealthChip({ c }: { c: Pick<PublicConnector, "status" | "planned" | "active" | "needsSecret"> }) {
  if (c.planned) return <span className="chip chip-neutral"><IClock />Coming soon</span>;
  if (c.needsSecret) return <span className="chip chip-warn"><IAlert />Re-enter secret</span>;
  if (c.status === "healthy") return <span className="chip chip-ok"><ICheck />Healthy</span>;
  if (c.status === "failing") return <span className="chip chip-bad"><IX />Failing</span>;
  return <span className="chip chip-neutral"><IClock />Never tested</span>;
}

export function HealthDots({ connectors }: { connectors: Pick<PublicConnector, "id" | "status" | "planned" | "displayName">[] }) {
  if (!connectors.length) return <span className="muted small">None</span>;
  return (
    <span className="dots" aria-label={connectors.map((c) => `${c.displayName}: ${c.planned ? "coming soon" : c.status.replace("_", " ")}`).join(", ")}>
      {connectors.map((c) => (
        <i key={c.id} className={c.planned ? "" : c.status === "healthy" ? "ok" : c.status === "failing" ? "bad" : "pending"} title={`${c.displayName}: ${c.planned ? "coming soon" : c.status.replace("_", " ")}`} />
      ))}
    </span>
  );
}

export function CheckResultView({ result }: { result: CheckResult }) {
  const tone = result.ok ? "ok" : result.supported ? "bad" : "warn";
  return (
    <div className={`callout ${tone}${result.ok ? " test-pass" : ""}`} role="status" aria-live="polite">
      {result.ok ? <ICheck /> : result.supported ? <IX /> : <IAlert />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <strong>
          {result.ok ? "Passed, read-only." : result.supported ? "Failed." : "Not testable yet."}{" "}
          <span className="muted small" style={{ fontWeight: 400 }}>
            {fmtTime(result.testedAt)} · {result.durationMs} ms{result.target === "pending" ? " · tested the pending change" : ""}
          </span>
        </strong>
        {result.reached.length ? (
          <>
            <p className="small" style={{ marginTop: 8 }}>Reached:</p>
            <ul className="small">{result.reached.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </>
        ) : null}
        {result.problems.length ? (
          <>
            <p className="small" style={{ marginTop: 8 }}>What to fix:</p>
            <ul className="small">{result.problems.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </>
        ) : null}
        {result.warnings.length ? (
          <>
            <p className="small" style={{ marginTop: 8 }}>Warnings:</p>
            <ul className="small">{result.warnings.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </>
        ) : null}
        {result.readOnlyProof.length ? (
          <p className="small" style={{ marginTop: 8 }}>
            <IShield className="i14" /> {result.readOnlyProof.join(" ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------- the generic form ----------

function initialValue(f: FormModelField, current: Values | undefined): FieldValue {
  const v = current?.[f.name];
  if (v !== undefined) return v;
  if (f.defaultValue !== undefined) return f.defaultValue;
  return f.type === "checkbox" ? false : f.type === "list" ? [] : "";
}

function FieldInput({
  f,
  value,
  onChange,
  error,
  idPrefix,
  saved,
}: {
  f: FormModelField;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  error?: string;
  idPrefix: string;
  saved?: { savedAt: string | null; lastOk: string | null };
}) {
  const id = `${idPrefix}-${f.name}`;
  const described = [f.help ? `${id}-help` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  const [replacing, setReplacing] = useState(!saved);
  if (f.type === "checkbox") {
    return (
      <div className="field full">
        <label className="check" htmlFor={id}>
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{f.label}</span>
        </label>
        {f.help ? <span className="help" id={`${id}-help`}>{f.help}</span> : null}
      </div>
    );
  }
  const wide = f.type === "list" || f.type === "certificate";
  return (
    <div className={`field${wide ? " full" : ""}`} data-invalid={Boolean(error)}>
      <label htmlFor={id}>
        {f.label}
        {f.required ? null : <span className="muted"> (optional)</span>}
      </label>
      {f.type === "secret" && saved && !replacing ? (
        <div className="secret-row">
          <span className="secret-mask">
            <ILock className="i14" /> Saved on {fmtTime(saved.savedAt)}
            {saved.lastOk ? `, last tested OK ${fmtTime(saved.lastOk)}` : ""}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplacing(true)}>
            Replace
          </button>
        </div>
      ) : f.type === "secret" ? (
        <input
          id={id}
          type="password"
          autoComplete="new-password"
          className="input"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={saved ? "Leave blank to keep the saved value" : f.placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={described}
        />
      ) : f.type === "select" ? (
        <select id={id} className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} aria-describedby={described}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.type === "list" || f.type === "certificate" ? (
        <textarea
          id={id}
          className="input"
          rows={f.type === "certificate" ? 5 : 3}
          style={f.type === "certificate" ? { fontFamily: "var(--font-code)", fontSize: 12 } : undefined}
          value={Array.isArray(value) ? value.join("\n") : String(value ?? "")}
          onChange={(e) => onChange(f.type === "list" ? e.target.value.split("\n") : e.target.value)}
          placeholder={f.placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={described}
        />
      ) : (
        <input
          id={id}
          type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
          className="input"
          value={String(value ?? "")}
          min={f.min}
          max={f.max}
          onChange={(e) => onChange(e.target.value)}
          placeholder={f.placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={described}
        />
      )}
      {f.type === "secret" ? (
        <span className="help">
          <ILock className="i14" /> {f.reminder ?? "Use a read-only account or token."}
          {f.help ? ` ${f.help}` : ""}
        </span>
      ) : f.help ? (
        <span className="help" id={`${id}-help`}>{f.help}</span>
      ) : null}
      {error ? <span className="err" id={`${id}-err`}>{error}</span> : null}
    </div>
  );
}

/** Credentials and scope for one connector. Creates it, or saves a change (held until tested when active). */
export function ConnectorForm({
  companyId,
  model,
  existing,
  planEntry,
  onSaved,
}: {
  companyId: number;
  model: FormModel;
  existing?: PublicConnector;
  planEntry?: ToolPlanEntry;
  onSaved?: (c: PublicConnector) => void;
}) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const source = existing?.pending ?? existing;
  const [deployment, setDeployment] = useState<Deployment>(source?.deployment ?? planEntry?.deployment ?? model.deployments[0]);
  const fields = model.fieldsByDeployment[deployment] ?? [];
  const [config, setConfig] = useState<Values>(() =>
    Object.fromEntries(model.deployments.flatMap((d) => model.fieldsByDeployment[d]).filter((f) => f.type !== "secret").map((f) => [f.name, initialValue(f, source?.config)])),
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<Values>(() => Object.fromEntries(model.scopeFields.map((f) => [f.name, initialValue(f, source?.scope)])));
  const [label, setLabel] = useState(existing?.label ?? planEntry?.label ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const idPrefix = `c${existing?.id ?? planEntry?.key ?? model.id}`;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMsg(null);
    const cleanScope = Object.fromEntries(Object.entries(scope).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => x.trim()).filter(Boolean) : v]));
    const payload = { registryId: model.id, deployment, label, config: { ...config, ...secrets }, scope: cleanScope, planKey: planEntry?.key };
    const r = existing
      ? await adminFetch<{ connector: PublicConnector }>(csrf, `/api/nexus-admin/companies/${companyId}/connectors/${existing.id}`, "PATCH", payload)
      : await adminFetch<{ connector: PublicConnector }>(csrf, `/api/nexus-admin/companies/${companyId}/connectors`, "POST", payload);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fields ?? {});
      setMsg({ tone: "bad", text: r.error });
      return;
    }
    setErrors({});
    setSecrets({});
    setMsg({
      tone: "ok",
      text: r.connector.pending ? "Saved as a pending change. The current values stay in use until this change passes a test." : "Saved. Test it to make it active.",
    });
    onSaved?.(r.connector);
    router.refresh();
  }

  const savedSecret = (name: string) => {
    const s = existing?.secrets.find((x) => x.field === name);
    return s?.saved && !existing?.needsSecret ? { savedAt: s.savedAt, lastOk: existing?.lastOkAt ?? null } : undefined;
  };

  return (
    <form className="form" onSubmit={save} noValidate>
      {model.status === "planned" ? (
        <p className="callout warn">
          <IClock />
          {model.displayName} is coming soon. You can record it for this company now; it cannot be tested or activated yet.
        </p>
      ) : null}
      {existing?.needsSecret ? (
        <p className="callout warn">
          <IAlert />
          This connector was carried over from the earlier screen. Re-enter its secret, then test it.
        </p>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${idPrefix}-label`}>Name for this connection <span className="muted">(optional)</span></label>
          <input id={`${idPrefix}-label`} className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="For example: API repositories" />
        </div>
        {model.deployments.length > 1 ? (
          <div className="field">
            <span className="label">Deployment</span>
            <div className="provider-pick" role="radiogroup" aria-label="Deployment">
              {model.deployments.map((d) => (
                <label key={d}>
                  <input type="radio" name={`${idPrefix}-deployment`} checked={deployment === d} onChange={() => setDeployment(d)} />
                  {d === "cloud" ? "Cloud" : "Self-hosted"}
                </label>
              ))}
            </div>
            {errors.deployment ? <span className="err">{errors.deployment}</span> : null}
          </div>
        ) : null}
        {fields.map((f) => (
          <FieldInput
            key={`${deployment}-${f.name}`}
            f={f}
            idPrefix={idPrefix}
            value={f.type === "secret" ? (secrets[f.name] ?? "") : config[f.name]}
            onChange={(v) => (f.type === "secret" ? setSecrets({ ...secrets, [f.name]: String(v) }) : setConfig({ ...config, [f.name]: v }))}
            error={errors[f.name]}
            saved={f.type === "secret" ? savedSecret(f.name) : undefined}
          />
        ))}
      </div>
      <fieldset className="card card-pad" style={{ margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600, padding: "0 6px" }}>Scope: what Nexus may read</legend>
        <div className="form-grid">
          {model.scopeFields.map((f) => (
            <FieldInput key={f.name} f={f} idPrefix={`${idPrefix}-scope`} value={scope[f.name]} onChange={(v) => setScope({ ...scope, [f.name]: v })} error={errors[`scope.${f.name}`]} />
          ))}
        </div>
        {errors.scope ? <p className="err small" style={{ marginTop: 8 }}>{errors.scope}</p> : null}
      </fieldset>
      {msg ? (
        <p className={`callout ${msg.tone}`} role={msg.tone === "bad" ? "alert" : "status"}>
          {msg.tone === "ok" ? <ICheck /> : <IX />}
          {msg.text}
        </p>
      ) : null}
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? <span className="spin" aria-hidden="true" /> : null}
          {existing ? (existing.active ? "Save change (applies after a passing test)" : "Save") : "Save connector"}
        </button>
        <span className="muted small">Nothing is written to {model.displayName}. Nexus only reads.</span>
      </div>
    </form>
  );
}

// ---------- a connector card with test, history, rotation and removal ----------

export function ConnectorCard({ companyId, connector, model, showForm = false }: { companyId: number; connector: PublicConnector; model?: FormModel; showForm?: boolean }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [result, setResult] = useState<CheckResult | null>(connector.lastResult);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<CheckRow[] | null>(null);
  const [editing, setEditing] = useState(showForm);
  const [rotate, setRotate] = useState<{ field: string; value: string } | null>(null);
  const [rotateMsg, setRotateMsg] = useState<string>("");
  const [help, setHelp] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function test() {
    setBusy("test");
    const r = await adminFetch<{ result: CheckResult; applied: boolean }>(csrf, `/api/nexus-admin/companies/${companyId}/connectors/${connector.id}/test`, "POST", {});
    setBusy(null);
    if (r.ok) setResult(r.result);
    else setResult({ ok: false, supported: true, target: "live", reached: [], problems: [r.error], warnings: [], readOnlyProof: [], testedAt: new Date().toISOString(), durationMs: 0 });
    setHistory(null);
    router.refresh();
  }
  async function loadHistory() {
    if (history) return setHistory(null);
    const r = await adminFetch<{ checks: CheckRow[] }>(csrf, `/api/nexus-admin/companies/${companyId}/connectors/${connector.id}/checks`);
    if (r.ok) setHistory(r.checks);
  }
  async function doRotate(event: React.FormEvent) {
    event.preventDefault();
    if (!rotate) return;
    setBusy("rotate");
    const r = await adminFetch<{ result: CheckResult; applied: boolean }>(csrf, `/api/nexus-admin/companies/${companyId}/connectors/${connector.id}/rotate`, "POST", rotate);
    setBusy(null);
    if (!r.ok) return setRotateMsg(r.error);
    setResult(r.result);
    setRotateMsg(r.applied ? "Replaced and tested. The new secret is now in use." : "The new secret failed its test, so the old one stays in use.");
    if (r.applied) setRotate(null);
    router.refresh();
  }
  async function discard() {
    setBusy("discard");
    await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/connectors/${connector.id}`, "PATCH", { action: "discard-pending" });
    setBusy(null);
    router.refresh();
  }
  async function remove() {
    setBusy("remove");
    await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/connectors/${connector.id}`, "DELETE");
    setBusy(null);
    router.refresh();
  }
  async function loadHelp() {
    if (help !== null) return setHelp(null);
    const r = await adminFetch<{ help: string }>(csrf, `/api/nexus-admin/companies/${companyId}/connectors/${connector.id}/setup-help`);
    setHelp(r.ok ? r.help : "");
  }

  const scopeText = Object.entries(connector.scope)
    .filter(([, v]) => (Array.isArray(v) ? v.length : v !== "" && v !== false))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");

  return (
    <section className="card card-pad stack" aria-label={`${connector.displayName} connector`}>
      <div className="spread">
        <div>
          <h3 style={{ margin: 0 }}>
            {connector.displayName}
            {connector.label ? <span className="muted"> · {connector.label}</span> : null}
          </h3>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            {connector.deployment === "cloud" ? "Cloud" : "Self-hosted"} · Scope: {scopeText || "none"}
          </p>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Last test {fmtTime(connector.lastTestedAt)} · last passed {fmtTime(connector.lastOkAt)}
            {connector.active ? ` · active since ${fmtTime(connector.activatedAt)}` : " · not active yet"}
          </p>
        </div>
        <HealthChip c={connector} />
      </div>
      {connector.lastError && connector.status === "failing" ? (
        <p className="callout bad small"><IX />Last error: {connector.lastError}</p>
      ) : null}
      {connector.pending ? (
        <div className="callout warn">
          <IClock />
          <div>
            <strong>A change is waiting for a passing test.</strong>
            <p className="small" style={{ margin: "4px 0 0" }}>
              Saved {fmtTime(connector.pending.since)}
              {connector.pending.secretFieldsChanged.length ? ` · new ${connector.pending.secretFieldsChanged.join(", ")}` : ""}. The current values stay in use until it passes.
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={discard} disabled={busy !== null}>Discard change</button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="row">
        <button type="button" className="btn btn-blue btn-sm" onClick={test} disabled={busy !== null || connector.planned}>
          {busy === "test" ? <span className="spin" aria-hidden="true" /> : <IRefresh />}
          {connector.pending ? "Test pending change" : connector.lastTestedAt ? "Retest" : "Test"}
        </button>
        {model ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(!editing)}>{editing ? "Close editor" : "Edit"}</button>
        ) : null}
        {connector.secrets.some((s) => s.saved) && connector.active ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRotate(rotate ? null : { field: connector.secrets.find((s) => s.saved)!.field, value: "" })}>
            <ILock /> Replace secret
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={loadHistory}>{history ? "Hide history" : "History"}</button>
        {model?.hasSetupHelp ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={loadHelp}>{help !== null ? "Hide setup help" : "Setup help"}</button>
        ) : null}
        {confirmRemove ? (
          <span className="row">
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={busy !== null}>Remove now</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(true)}>Remove</button>
        )}
      </div>
      {rotate ? (
        <form className="card card-pad form" onSubmit={doRotate}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor={`rot-field-${connector.id}`}>Secret to replace</label>
              <select id={`rot-field-${connector.id}`} className="input" value={rotate.field} onChange={(e) => setRotate({ ...rotate, field: e.target.value })}>
                {connector.secrets.map((s) => <option key={s.field} value={s.field}>{s.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`rot-value-${connector.id}`}>New value</label>
              <input id={`rot-value-${connector.id}`} type="password" autoComplete="new-password" className="input" value={rotate.value} onChange={(e) => setRotate({ ...rotate, value: e.target.value })} />
              <span className="help"><ILock className="i14" /> Use a read-only account or token. It is tested at once and used only if it passes.</span>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={busy !== null || !rotate.value}>
              {busy === "rotate" ? <span className="spin" aria-hidden="true" /> : null}Replace and test
            </button>
          </div>
        </form>
      ) : null}
      {rotateMsg ? <p className="callout small" role="status">{rotateMsg}</p> : null}
      {help !== null ? <pre className="card card-pad small" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-code)", margin: 0 }}>{help || "No setup help."}</pre> : null}
      {result ? <CheckResultView result={result} /> : null}
      {history ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Time</th>
                <th>Trigger</th>
                <th>Tested</th>
                <th>Result</th>
                <th>Status change</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={5} className="muted">No tests yet.</td></tr>
              ) : (
                history.map((h) => (
                  <tr key={h.id}>
                    <td className="muted small">{fmtTime(h.at)}</td>
                    <td>{h.trigger}</td>
                    <td>{h.target === "pending" ? "pending change" : "current values"}</td>
                    <td>{h.ok ? <span className="chip chip-ok"><ICheck />Passed</span> : <span className="chip chip-bad"><IX />Failed</span>}</td>
                    <td className="small">{h.statusBefore?.replace("_", " ")} → {h.statusAfter?.replace("_", " ")}{!h.ok && h.result.problems[0] ? <span className="muted"> · {h.result.problems[0]}</span> : null}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing && model ? <ConnectorForm companyId={companyId} model={model} existing={connector} onSaved={() => setEditing(false)} /> : null}
    </section>
  );
}

// ---------- test all ----------

export function TestAllButton({ companyId, disabled }: { companyId: number; disabled?: boolean }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState("");
  async function run() {
    setBusy(true);
    const r = await adminFetch<{ results: { result: CheckResult }[] }>(csrf, `/api/nexus-admin/companies/${companyId}/connectors/test-all`, "POST", {});
    setBusy(false);
    if (r.ok) {
      const passed = r.results.filter((x) => x.result.ok).length;
      setSummary(`${passed} of ${r.results.length} passed.`);
    } else setSummary(r.error);
    router.refresh();
  }
  return (
    <span className="row">
      <button type="button" className="btn btn-primary" onClick={run} disabled={busy || disabled}>
        {busy ? <span className="spin" aria-hidden="true" /> : <IRefresh />}
        Test all
      </button>
      {summary ? <span className="small" role="status">{summary}</span> : null}
    </span>
  );
}

// ---------- pick tools ----------

export function ToolPicker({ companyId, categories, models, plan, nextHref }: { companyId: number; categories: Category[]; models: FormModel[]; plan: ToolPlan; nextHref: string }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [state, setState] = useState<ToolPlan>({ entries: plan.entries, other: plan.other, none: plan.none });
  const [otherFor, setOtherFor] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "bad" | "busy"; text: string } | null>(null);
  const byId = new Map(models.map((m) => [m.id, m]));

  /** Every change is saved at once, so leaving the page never loses a pick. */
  async function persist(next: ToolPlan, note: string) {
    setState(next);
    setStatus({ tone: "busy", text: "Saving…" });
    const r = await adminFetch<{ toolPlan: ToolPlan }>(csrf, `/api/nexus-admin/companies/${companyId}`, "PATCH", { toolPlan: next });
    if (!r.ok) return setStatus({ tone: "bad", text: `Not saved: ${r.error}` });
    setState(r.toolPlan);
    setStatus({ tone: "ok", text: note });
    router.refresh();
  }

  function pick(category: string, value: string) {
    if (!value) return;
    if (value === "__other") {
      setOtherFor(category);
      setOtherText("");
      return;
    }
    if (value === "__none") {
      return persist({ ...state, none: [...new Set([...state.none, category])] }, "Saved: none for this area.");
    }
    const m = byId.get(value);
    if (!m) return;
    const entry: ToolPlanEntry = { key: Math.random().toString(36).slice(2, 10), category, registryId: m.id, deployment: m.deployments[0], label: "" };
    return persist({ ...state, entries: [...state.entries, entry], none: state.none.filter((n) => n !== category) }, `Saved: ${m.displayName} added.`);
  }

  return (
    <div className="stack">
      <p className="muted">
        For each area, choose what this company uses. A category can hold more than one tool, for example two code hosts. Each choice is saved as soon as you make it.
      </p>
      {categories.map((cat) => {
        const options = models.filter((m) => m.category === cat.id);
        const chosen = state.entries.filter((e) => e.category === cat.id);
        const others = state.other.filter((o) => o.category === cat.id);
        const isNone = state.none.includes(cat.id) && chosen.length === 0;
        return (
          <section key={cat.id} className="card card-pad stack" aria-labelledby={`cat-${cat.id}`}>
            <div className="spread">
              <div>
                <h3 id={`cat-${cat.id}`} style={{ margin: 0 }}>{cat.title}</h3>
                <p className="muted small" style={{ margin: "4px 0 0" }}>{cat.blurb}</p>
              </div>
              {isNone ? <span className="chip chip-neutral">None</span> : null}
            </div>
            {chosen.map((e) => {
              const m = byId.get(e.registryId);
              return (
                <div key={e.key} className="row" style={{ justifyContent: "space-between" }}>
                  <span>
                    <strong>{m?.displayName ?? e.registryId}</strong>
                    {m?.status === "planned" ? <span className="chip chip-neutral" style={{ marginLeft: 8 }}><IClock />Coming soon</span> : null}
                    {e.connectorId ? <span className="chip chip-ok" style={{ marginLeft: 8 }}><ICheck />Set up</span> : null}
                  </span>
                  <span className="row">
                    {m && m.deployments.length > 1 && !e.connectorId ? (
                      <select
                        className="input"
                        aria-label={`Deployment for ${m.displayName}`}
                        value={e.deployment}
                        onChange={(ev) =>
                          persist({ ...state, entries: state.entries.map((x) => (x.key === e.key ? { ...x, deployment: ev.target.value as Deployment } : x)) }, "Saved.")
                        }
                        style={{ width: "auto" }}
                      >
                        {m.deployments.map((d) => <option key={d} value={d}>{d === "cloud" ? "Cloud" : "Self-hosted"}</option>)}
                      </select>
                    ) : (
                      <span className="muted small">{e.deployment === "cloud" ? "Cloud" : "Self-hosted"}</span>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => persist({ ...state, entries: state.entries.filter((x) => x.key !== e.key) }, `Saved: ${m?.displayName ?? e.registryId} removed from the list.`)}
                      aria-label={`Remove ${m?.displayName ?? e.registryId}`}
                    >
                      Remove
                    </button>
                  </span>
                </div>
              );
            })}
            {others.map((o, i) => (
              <div key={`o-${i}`} className="row" style={{ justifyContent: "space-between" }}>
                <span>Other: <strong>{o.text}</strong> <span className="muted small">(noted for the roadmap)</span></span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => persist({ ...state, other: state.other.filter((x) => x !== o) }, "Saved.")}>Remove</button>
              </div>
            ))}
            <div className="row">
              <select
                className="input"
                style={{ width: "auto", minWidth: 260 }}
                aria-label={`Add a ${cat.title.toLowerCase()} tool`}
                value=""
                onChange={(e) => pick(cat.id, e.target.value)}
              >
                <option value="">{chosen.length ? "Add another…" : "Choose a tool…"}</option>
                <optgroup label="Available">
                  {options.filter((m) => m.status === "available").map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                </optgroup>
                <optgroup label="Coming soon">
                  {options.filter((m) => m.status === "planned").map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                </optgroup>
                <option value="__none">None</option>
                <option value="__other">Other (tell us)</option>
              </select>
              {otherFor === cat.id ? (
                <>
                  <input className="input" style={{ width: 220 }} aria-label="Which tool?" placeholder="Which tool?" value={otherText} onChange={(e) => setOtherText(e.target.value)} autoFocus />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!otherText.trim()}
                    onClick={() => {
                      setOtherFor(null);
                      void persist({ ...state, other: [...state.other, { category: cat.id, text: otherText.trim() }] }, "Saved.");
                    }}
                  >
                    <IPlus /> Add
                  </button>
                </>
              ) : null}
            </div>
          </section>
        );
      })}
      {status ? (
        <p className={`callout ${status.tone === "bad" ? "bad" : status.tone === "ok" ? "ok" : ""}`} role={status.tone === "bad" ? "alert" : "status"} aria-live="polite">
          {status.tone === "bad" ? <IX /> : status.tone === "ok" ? <ICheck /> : <span className="spin" aria-hidden="true" />}
          {status.text}
        </p>
      ) : null}
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => router.push(nextHref)}>
          Continue to credentials
        </button>
        <span className="muted small">Code and defects tools are required to create logins and go live.</span>
      </div>
    </div>
  );
}

// ---------- add a connector directly (company page) ----------

export function AddConnectorPanel({ companyId, categories, models }: { companyId: number; categories: Category[]; models: FormModel[] }) {
  const [chosen, setChosen] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const model = models.find((m) => m.id === chosen);
  return (
    <section className="card card-pad stack" aria-labelledby="add-connector">
      <div>
        <h2 id="add-connector" style={{ margin: 0 }}>Add a connector</h2>
        <p className="muted small" style={{ margin: "4px 0 0" }}>Pick a tool, enter its credentials and scope, save, then test it below.</p>
      </div>
      <div className="row">
        <label className="sr-only" htmlFor="add-connector-pick">Tool</label>
        <select
          id="add-connector-pick"
          className="input"
          style={{ width: "auto", minWidth: 300 }}
          value={chosen}
          onChange={(e) => {
            setChosen(e.target.value);
            setDone(null);
          }}
        >
          <option value="">Choose a tool…</option>
          {categories.map((cat) => (
            <optgroup key={cat.id} label={cat.title}>
              {models
                .filter((m) => m.category === cat.id)
                .sort((a, b) => (a.status === b.status ? a.displayName.localeCompare(b.displayName) : a.status === "available" ? -1 : 1))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.status === "planned" ? " (coming soon)" : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {chosen ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen("")}>Cancel</button> : null}
      </div>
      {done ? <p className="callout ok" role="status"><ICheck />{done} saved. Test it in its card below to make it active.</p> : null}
      {model ? (
        <ConnectorForm
          key={model.id}
          companyId={companyId}
          model={model}
          onSaved={() => {
            setDone(model.displayName);
            setChosen("");
          }}
        />
      ) : null}
    </section>
  );
}
