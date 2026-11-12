"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { AppDoc, AppInfo, AppUrl } from "../server/application";
import { fmtTime } from "./chips";
import { adminFetch, useAdmin } from "./client";
import { IAlert, ICheck, IDownload, IPlus, IX } from "./icons";

type App = { info: AppInfo; urls: AppUrl[]; docs: AppDoc[] };

const ENV_LABEL: Record<string, string> = { production: "Production", staging: "Staging", development: "Development", other: "Other" };
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.markdown,.txt,.csv,.png,.jpg,.jpeg,.mp4";

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return (
    <p className={`callout ${m.ok ? "ok" : "bad"}`} role={m.ok ? "status" : "alert"}>
      {m.ok ? <ICheck /> : <IX />}
      {m.text}
    </p>
  );
}

const fmtSize = (n: number | null) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function ApplicationPanel({ companyId, app }: { companyId: number; app: App }) {
  return (
    <div className="stack">
      <DetailsCard companyId={companyId} info={app.info} />
      <UrlsCard companyId={companyId} urls={app.urls} />
      <DocsCard
        companyId={companyId}
        docs={app.docs}
        section="docs"
        heading="Project documentation"
        blurb="Links to existing documents, or files uploaded to the Nexus server. Stored only on this server."
      />
      <KtCard companyId={companyId} docs={app.docs} />
    </div>
  );
}

/** Knowledge-transfer material: handover decks, recordings, runbooks, spreadsheets. */
export function KtCard({ companyId, docs }: { companyId: number; docs: AppDoc[] }) {
  return (
    <DocsCard
      companyId={companyId}
      docs={docs}
      section="kt"
      heading="KT files"
      blurb="Knowledge-transfer material: handover documents, slide decks, spreadsheets, runbooks or short recordings. Stored only on this server."
    />
  );
}

function DetailsCard({ companyId, info }: { companyId: number; info: AppInfo }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [v, setV] = useState({ name: info.name, description: info.description });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return setErrors({ name: "Enter the application's name." });
    setBusy(true);
    const r = await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/application`, "PUT", v);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fields ?? {});
      return setMsg({ ok: false, text: r.error });
    }
    setErrors({});
    setMsg({ ok: true, text: "Saved." });
    router.refresh();
  }
  return (
    <section className="card card-pad" aria-labelledby="app-details">
      <h2 id="app-details">Application</h2>
      <form className="form" onSubmit={save} noValidate>
        <div className="form-grid">
          <div className="field" data-invalid={Boolean(errors.name)}>
            <label htmlFor="app-name">Application name</label>
            <input id="app-name" className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="For example: Happy Moments" />
            {errors.name ? <span className="err">{errors.name}</span> : null}
          </div>
          <div className="field full">
            <label htmlFor="app-desc">What it does <span className="muted">(optional)</span></label>
            <textarea id="app-desc" className="input" rows={3} style={{ fontFamily: "var(--font-body)" }} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Who uses it, the main features, anything an engineer should know first." />
          </div>
        </div>
        <Msg m={msg} />
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spin" aria-hidden="true" /> : null}Save</button>
          {info.updatedAt ? <span className="muted small">Last saved {fmtTime(info.updatedAt)}</span> : null}
        </div>
      </form>
    </section>
  );
}

function UrlsCard({ companyId, urls }: { companyId: number; urls: AppUrl[] }) {
  const { csrf } = useAdmin();
  const router = useRouter();
  const [v, setV] = useState({ label: "", url: "", environment: "production", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/application/urls`, "POST", v);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fields ?? {});
      return setMsg({ ok: false, text: r.error });
    }
    setErrors({});
    setMsg({ ok: true, text: "Address added." });
    setV({ label: "", url: "", environment: v.environment, notes: "" });
    router.refresh();
  }
  async function remove(id: number) {
    await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/application/urls/${id}`, "DELETE");
    router.refresh();
  }
  return (
    <section className="card card-pad stack" aria-labelledby="app-urls">
      <div>
        <h2 id="app-urls" style={{ marginBottom: 4 }}>Application URLs</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Where the application runs, for reference. Nexus never sends traffic to these addresses. To let Nexus send limited load to a staging service, add a
          &quot;Service under test&quot; connector.
        </p>
      </div>
      {urls.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Environment</th><th>Name</th><th>Address</th><th>Notes</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {urls.map((u) => (
                <tr key={u.id}>
                  <td><span className={`chip ${u.environment === "production" ? "chip-warn" : "chip-info"}`}>{ENV_LABEL[u.environment]}</span></td>
                  <td>{u.label || <span className="muted">—</span>}</td>
                  <td className="mono small" style={{ wordBreak: "break-all" }}>
                    <a href={u.url} target="_blank" rel="noopener noreferrer">{u.url}</a>
                  </td>
                  <td className="small">{u.notes}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(u.id)} aria-label={`Remove ${u.url}`}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>No addresses yet.</p>
      )}
      <form className="form" onSubmit={add} noValidate>
        <div className="form-grid">
          <div className="field" data-invalid={Boolean(errors.url)}>
            <label htmlFor="url-url">Address</label>
            <input id="url-url" type="url" className="input" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://app.example.com" />
            {errors.url ? <span className="err">{errors.url}</span> : null}
          </div>
          <div className="field" data-invalid={Boolean(errors.environment)}>
            <label htmlFor="url-env">Environment</label>
            <select id="url-env" className="input" value={v.environment} onChange={(e) => setV({ ...v, environment: e.target.value })}>
              {Object.entries(ENV_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            {errors.environment ? <span className="err">{errors.environment}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="url-label">Name <span className="muted">(optional)</span></label>
            <input id="url-label" className="input" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Web app, Admin panel, API" />
          </div>
          <div className="field">
            <label htmlFor="url-notes">Notes <span className="muted">(optional)</span></label>
            <input id="url-notes" className="input" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          </div>
        </div>
        <Msg m={msg} />
        <div className="row">
          <button className="btn btn-blue" disabled={busy}><IPlus />Add address</button>
        </div>
      </form>
    </section>
  );
}

function DocsCard({
  companyId,
  docs: allDocs,
  section,
  heading,
  blurb,
}: {
  companyId: number;
  docs: AppDoc[];
  section: "docs" | "kt";
  heading: string;
  blurb: string;
}) {
  const docs = allDocs.filter((d) => (d.section ?? "docs") === section);
  const pfx = `${section}-`;
  const { csrf } = useAdmin();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState({ title: "", url: "", notes: "" });
  const [linkErrors, setLinkErrors] = useState<Record<string, string>>({});
  const [upTitle, setUpTitle] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy("link");
    const r = await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/application/docs`, "POST", { ...link, section });
    setBusy(null);
    if (!r.ok) {
      setLinkErrors(r.fields ?? {});
      return setMsg({ ok: false, text: r.error });
    }
    setLinkErrors({});
    setLink({ title: "", url: "", notes: "" });
    setMsg({ ok: true, text: "Link added." });
    router.refresh();
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const files = fileRef.current?.files;
    if (!files?.length) return setMsg({ ok: false, text: "Choose a file to upload." });
    setBusy("upload");
    let added = 0;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.set("file", file);
      form.set("section", section);
      if (files.length === 1 && upTitle.trim()) form.set("title", upTitle.trim());
      try {
        const response = await fetch(`/api/nexus-admin/companies/${companyId}/application/docs`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-csrf-token": csrf },
          body: form,
        });
        if (response.status === 401) {
          window.location.href = "/nexus-admin/login";
          return;
        }
        const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!data.ok) {
          setBusy(null);
          return setMsg({ ok: false, text: `${file.name}: ${data.error ?? `HTTP ${response.status}`}` });
        }
        added += 1;
      } catch {
        setBusy(null);
        return setMsg({ ok: false, text: `${file.name}: the upload did not reach the server.` });
      }
    }
    setBusy(null);
    setUpTitle("");
    if (fileRef.current) fileRef.current.value = "";
    setMsg({ ok: true, text: `${added} file${added === 1 ? "" : "s"} uploaded.` });
    router.refresh();
  }

  async function remove(id: number) {
    await adminFetch(csrf, `/api/nexus-admin/companies/${companyId}/application/docs/${id}`, "DELETE");
    setConfirm(null);
    router.refresh();
  }

  return (
    <section className="card card-pad stack" aria-labelledby={`${pfx}heading`}>
      <div>
        <h2 id={`${pfx}heading`} style={{ marginBottom: 4 }}>{heading}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {blurb} Accepted: PDF, Word, Excel, PowerPoint, Markdown, text, CSV, images and MP4, up to 50 MB each.
        </p>
      </div>
      {docs.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Document</th><th>Type</th><th>Added</th><th><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.kind === "link" ? (
                      <a href={d.url ?? "#"} target="_blank" rel="noopener noreferrer">{d.title}</a>
                    ) : (
                      <strong>{d.title}</strong>
                    )}
                    {d.kind === "file" && d.fileName !== d.title ? <span className="muted small"> · {d.fileName}</span> : null}
                    {d.notes ? <div className="muted small">{d.notes}</div> : null}
                  </td>
                  <td className="small">{d.kind === "link" ? "Link" : `File · ${fmtSize(d.sizeBytes)}`}</td>
                  <td className="muted small">{fmtTime(d.createdAt)} · {d.createdBy}</td>
                  <td>
                    <span className="row" style={{ justifyContent: "flex-end" }}>
                      {d.kind === "file" ? (
                        <a className="btn btn-ghost btn-sm" href={`/api/nexus-admin/companies/${companyId}/application/docs/${d.id}`}><IDownload />Download</a>
                      ) : null}
                      {confirm === d.id ? (
                        <>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(d.id)}>Delete now</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(d.id)}>Remove</button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>{section === "kt" ? "No KT files yet." : "No documentation yet."}</p>
      )}
      <Msg m={msg} />
      <div className="grid-2">
        <form className="card card-pad form" onSubmit={upload} noValidate>
          <h3 style={{ margin: 0 }}>Upload files</h3>
          <div className="field">
            <label htmlFor={`${pfx}doc-file`}>Files</label>
            <input id={`${pfx}doc-file`} ref={fileRef} type="file" className="input" accept={ACCEPT} multiple />
            <span className="help">You can choose several files at once.</span>
          </div>
          <div className="field">
            <label htmlFor={`${pfx}doc-up-title`}>Title <span className="muted">(optional, single file only)</span></label>
            <input id={`${pfx}doc-up-title`} className="input" value={upTitle} onChange={(e) => setUpTitle(e.target.value)} placeholder="Defaults to the file name" />
          </div>
          <div className="row">
            <button className="btn btn-blue" disabled={busy !== null}>{busy === "upload" ? <span className="spin" aria-hidden="true" /> : <IPlus />}Upload</button>
          </div>
        </form>
        <form className="card card-pad form" onSubmit={addLink} noValidate>
          <h3 style={{ margin: 0 }}>Add a link</h3>
          <div className="field" data-invalid={Boolean(linkErrors.title)}>
            <label htmlFor={`${pfx}doc-title`}>Title</label>
            <input id={`${pfx}doc-title`} className="input" value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} placeholder="Architecture overview" />
            {linkErrors.title ? <span className="err">{linkErrors.title}</span> : null}
          </div>
          <div className="field" data-invalid={Boolean(linkErrors.url)}>
            <label htmlFor={`${pfx}doc-url`}>Link</label>
            <input id={`${pfx}doc-url`} type="url" className="input" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://docs.google.com/…" />
            {linkErrors.url ? <span className="err">{linkErrors.url}</span> : null}
          </div>
          <div className="row">
            <button className="btn btn-blue" disabled={busy !== null}><IPlus />Add link</button>
          </div>
        </form>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        <IAlert className="i14" /> Nexus does not fetch linked documents. To have Nexus read documentation as evidence, connect a docs tool in Connection health.
      </p>
    </section>
  );
}
