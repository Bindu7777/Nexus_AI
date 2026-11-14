// HTML for the progress panel and the report case file. Pure functions: they
// only turn what the Nexus server returned into markup.
//
// All ticket, log, file and document text is escaped and shown as plain text.
// Instruction-like lines are marked as data. Colour never carries meaning on
// its own: every state also has an icon and a word.
import type { IdeReport, Progress } from "../../../../src/ide/machine";
import { neutraliseForDisplay } from "../../../../src/ide/redact";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type RenderOptions = { nonce: string; cspSource: string; hideExcerpts?: boolean };

function shell(title: string, body: string, o: RenderOptions) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${o.cspSource} 'nonce-${o.nonce}'; script-src 'nonce-${o.nonce}'; img-src ${o.cspSource} data:;">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style nonce="${o.nonce}">${CSS}</style></head><body>${body}
<script nonce="${o.nonce}">${SCRIPT}</script></body></html>`;
}

// Nexus palette. Dark themes get the midnight canvas; light and high-contrast
// themes keep VS Code's own colours, with the accents mapped to theme tokens.
const CSS = `
:root{--nx-canvas:var(--vscode-editor-background);--nx-panel:var(--vscode-sideBar-background,var(--vscode-editor-background));--nx-text:var(--vscode-foreground);--nx-muted:var(--vscode-descriptionForeground);--nx-line:var(--vscode-panel-border,rgba(128,128,128,.35));
--nx-action:var(--vscode-button-background);--nx-action-text:var(--vscode-button-foreground);--nx-live:var(--vscode-charts-blue,#2bb8d9);--nx-cite:var(--vscode-charts-yellow,#d9a23b);--nx-verified:var(--vscode-charts-green,#2fa58e);--nx-honest:var(--vscode-charts-orange,#e8806f)}
body.vscode-dark{--nx-canvas:#0d1426;--nx-panel:#131c33;--nx-text:#e6ebf5;--nx-muted:#9aa6c2;--nx-line:#26324f;--nx-action:#2f6bff;--nx-action-text:#fff;--nx-live:#38d0f0;--nx-cite:#f0b54a;--nx-verified:#2ec4a6;--nx-honest:#ff8a78}
body.vscode-high-contrast{--nx-canvas:var(--vscode-editor-background);--nx-panel:var(--vscode-editor-background);--nx-line:var(--vscode-contrastBorder)}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--nx-canvas);color:var(--nx-text);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);line-height:1.5}
h1{font-size:1.35em;margin:0 0 4px}h2{font-size:1.05em;margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--nx-line)}
.muted{color:var(--nx-muted)}.small{font-size:.9em}
.card{background:var(--nx-panel);border:1px solid var(--nx-line);border-radius:8px;padding:12px 14px;margin:8px 0}
.verdict{border-left:4px solid var(--nx-line)}.verdict .label{font-size:1.2em;font-weight:600}
.v-verified{border-left-color:var(--nx-verified)}.v-verified .label{color:var(--nx-verified)}
.v-diagnosed{border-left-color:var(--nx-action)}
.v-honest{border-left-color:var(--nx-honest)}.v-honest .label{color:var(--nx-honest)}
.v-failed{border-left-color:var(--nx-muted)}
.badge{display:inline-block;border:1px solid var(--nx-line);border-radius:999px;padding:0 8px;font-size:.85em;margin-right:6px;white-space:nowrap}
.b-observed{border-color:var(--nx-cite);color:var(--nx-cite)}.b-inferred{border-style:dashed}
.b-client{border-style:dotted}.b-executed{border-color:var(--nx-verified);color:var(--nx-verified)}
pre{white-space:pre-wrap;word-break:break-word;margin:6px 0 0;padding:8px;background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.12));border-radius:6px;max-height:260px;overflow:auto;font-family:var(--vscode-editor-font-family);font-size:.92em}
.cite{border-left:3px solid var(--nx-cite);padding-left:10px;margin:10px 0}
button,.btn{font:inherit;cursor:pointer;border:1px solid var(--nx-line);border-radius:6px;padding:4px 10px;background:transparent;color:var(--nx-text);margin:4px 6px 4px 0}
button.primary{background:var(--nx-cite);color:#1b1300;border-color:var(--nx-cite);font-weight:600}
button.action{background:var(--nx-action);color:var(--nx-action-text);border-color:var(--nx-action)}
button:disabled{opacity:.5;cursor:not-allowed}
button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
a.loc{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:underline;background:none;border:0;padding:0;margin:0}
ul{padding-left:20px;margin:4px 0}li{margin:2px 0}
.stage{display:flex;gap:8px;align-items:flex-start;padding:4px 0}.stage .icon{width:1.4em;text-align:center;flex:none}
.s-running .icon{color:var(--nx-live);animation:pulse 1.2s ease-in-out infinite}.s-done .icon{color:var(--nx-verified)}.s-failed .icon{color:var(--nx-honest)}.s-skipped .icon,.s-pending .icon{color:var(--nx-muted)}
.src{display:flex;gap:8px}.src-unavailable,.src-dropped,.src-rejected{color:var(--nx-honest)}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
.readonly{margin-top:18px;font-size:.9em;color:var(--nx-muted);border-top:1px solid var(--nx-line);padding-top:10px}
textarea{width:100%;font:inherit;color:var(--nx-text);background:transparent;border:1px solid var(--nx-line);border-radius:6px;padding:6px}
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  if (a === "openLocation") vscode.postMessage({ type: a, path: el.dataset.path, start: Number(el.dataset.start), end: Number(el.dataset.end) });
  else if (a === "feedback") vscode.postMessage({ type: a, correct: el.dataset.correct === "true", note: (document.getElementById("fb-note") || {}).value || "" });
  else vscode.postMessage({ type: a });
});
`;

const STAGE_ICON: Record<string, [string, string]> = {
  pending: ["○", "Waiting"],
  running: ["◉", "Running"],
  done: ["✓", "Done"],
  skipped: ["–", "Skipped"],
  failed: ["✕", "Failed"],
};

const SOURCE_ICON: Record<string, string> = { pending: "…", ok: "✓", unavailable: "⊘", rejected: "↻", dropped: "⊘" };

// ---------- progress ----------

export type ProgressModel = (Progress & { pending?: { id: string }[] }) | null;

export function progressHtml(p: ProgressModel, o: RenderOptions & { agentHint?: boolean; setup?: { name: string; url: string }[] }) {
  if (!p) {
    return shell(
      "Nexus",
      `<h1>Nexus</h1><p class="muted">Run <b>Nexus: Investigate defect</b> or type <code>/investigate PAY-1423</code> in chat.</p>
<p class="small muted">Nexus is read-only toward your repository and tools.</p>`,
      o,
    );
  }
  const waiting = p.phase === "awaiting_evidence";
  const stages = p.stages
    .map((s) => {
      const [icon, word] = STAGE_ICON[s.status] ?? ["?", s.status];
      const time = s.durationMs != null ? ` · ${(s.durationMs / 1000).toFixed(1)} s` : "";
      return `<div class="stage s-${esc(s.status)}"><span class="icon" aria-hidden="true">${icon}</span><div><b>${esc(s.title)}</b> <span class="muted small">${word}${time}</span>${s.summary ? `<div class="small">${esc(s.summary)}</div>` : ""}</div></div>`;
    })
    .join("");
  const sources = p.sources.length
    ? p.sources.map((s) => `<div class="src src-${esc(s.status)}"><span aria-hidden="true">${SOURCE_ICON[s.status] ?? "·"}</span><span>${esc(s.line)}</span></div>`).join("")
    : `<p class="muted small">No evidence requested yet.</p>`;
  const hint = waiting
    ? `<div class="card"><b>Waiting for evidence</b><p class="small">Your chat agent fetches each request with your connected tools and sends the raw results to Nexus.</p>
<button class="action" data-action="openChat">Ask the chat agent to continue</button><button data-action="continueWithout">Continue with what is available</button>
${o.setup?.length ? `<p class="small muted">No agent or tools connected? Connect: ${o.setup.map((t) => `<a class="loc" href="${esc(t.url)}">${esc(t.name)}</a>`).join(", ")}.</p>` : ""}</div>`
    : `<button class="action" data-action="openReport">Open the report</button>`;
  return shell(
    `Nexus · ${p.ticketKey}`,
    `<h1>${esc(p.ticketKey)}</h1><p class="muted small">Round ${p.round} of at most ${p.maxRounds} · ${esc(p.phase.replace(/_/g, " "))}</p>
<h2>Stages</h2>${stages}<h2>Evidence sources</h2>${sources}${hint}`,
    o,
  );
}

// ---------- report ----------

const VERDICT_STYLE: Record<string, [string, string]> = {
  diagnosed_verified: ["v-verified", "✓"],
  diagnosed: ["v-diagnosed", "◆"],
  not_reproduced: ["v-honest", "◌"],
  not_enough_evidence: ["v-honest", "◌"],
  needs_more_information: ["v-honest", "?"],
  failed: ["v-failed", "⚠"],
};

const PROVENANCE: Record<string, [string, string]> = {
  "client-supplied": ["b-client", "◇ From your IDE agent"],
  "nexus-fetched": ["", "Fetched by Nexus"],
  "nexus-executed": ["b-executed", "● Run by Nexus"],
};

function evidenceBlock(e: IdeReport["evidence"][number], o: RenderOptions) {
  const [pcls, pword] = PROVENANCE[e.provenance] ?? ["", e.provenance];
  const obs = e.observation === "observed" ? `<span class="badge b-observed">Observed</span>` : `<span class="badge b-inferred">Inferred</span>`;
  const loc = e.location?.path
    ? ` <button class="loc" data-action="openLocation" data-path="${esc(e.location.path)}" data-start="${esc(e.location.startLine ?? 1)}" data-end="${esc(e.location.endLine ?? e.location.startLine ?? 1)}">${esc(e.location.path)}${e.location.startLine ? `:${esc(e.location.startLine)}` : ""}</button>`
    : "";
  const text = o.hideExcerpts ? `<p class="muted small">Excerpt hidden (nexus.hideEvidenceExcerpts).</p>` : `<pre>${esc(neutraliseForDisplay(e.excerpt).text)}</pre>`;
  const tool = e.reportedTool ? ` <span class="muted small">via ${esc(e.reportedTool)}</span>` : "";
  return `<div class="cite">${obs}<span class="badge ${pcls}">${esc(pword)}</span><b>${esc(e.title)}</b>${tool}${loc}${text}</div>`;
}

export function reportHtml(r: IdeReport, o: RenderOptions & { canAct?: boolean }) {
  const [vcls, vicon] = VERDICT_STYLE[r.verdict] ?? ["v-failed", "·"];
  const date = new Date(r.generatedAt).toLocaleString();
  const honest = vcls === "v-honest";
  const head = `<div class="card verdict ${vcls}" role="status"><div class="label"><span aria-hidden="true">${vicon}</span> ${esc(r.verdictLabel)}</div>
<p>${esc(r.reason)}</p><p class="muted small">${esc(r.ticketKey)}${r.ticket?.title ? ` · ${esc(r.ticket.title)}` : ""} · ${esc(date)}</p>
${honest ? `<p class="small">An honest “not enough” is a correct outcome: Nexus claims only what the evidence supports. What would help is listed below.</p>` : ""}
<p class="muted small">Sources used: ${r.sourcesUsed.length ? r.sourcesUsed.map(esc).join(" · ") : "none"}</p></div>`;
  const prov = r.provenanceNote ? `<div class="card small">◇ ${esc(r.provenanceNote)}</div>` : "";
  const causes = r.causes.length
    ? r.causes
        .map(
          (c) => `<div class="card"><b>#${c.rank} ${esc(c.cause)}</b> <span class="badge">${c.kind === "cause" ? "Cause" : "Weak lead"}</span><span class="muted small">score ${esc(c.score.toFixed(2))} of threshold ${esc(c.threshold)}</span>
${c.restsOnlyOnClientEvidence ? `<p class="small">◇ This rests only on evidence your IDE agent supplied, so it cannot be verified.</p>` : ""}
<p class="muted small">Rule: ${esc(c.rule)}</p>${c.evidence.slice(0, 8).map((e) => evidenceBlock(e, o)).join("")}</div>`,
        )
        .join("")
    : `<p class="muted">No cause is claimed.</p>`;
  const located = r.located.length
    ? `<ul>${r.located.map((l) => `<li><button class="loc" data-action="openLocation" data-path="${esc(l.path)}" data-start="${esc(l.startLine ?? 1)}" data-end="${esc(l.endLine ?? l.startLine ?? 1)}">${esc(l.path)}${l.startLine ? `:${esc(l.startLine)}-${esc(l.endLine ?? l.startLine)}` : ""}</button> <span class="muted small">${esc(l.reason)}</span></li>`).join("")}</ul>`
    : `<p class="muted">No code location was tied to the defect.</p>`;
  const list = (xs: string[], empty: string) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`);
  const missing = r.missingInformation.length ? `<h2>Needs more information</h2>${list(r.missingInformation, "")}` : "";
  const fix = r.suggestedFix;
  const proven = Boolean(fix?.exportable);
  const fixHtml = fix
    ? `<div class="card"><b>${esc(fix.title)}</b><p>${esc(fix.summary)}</p><p class="muted small">${esc(fix.boundary)}</p>
${fix.diff ? `<pre>${esc(fix.diff)}</pre><button data-action="openDiff">Open in diff view</button>` : `<p class="muted">No code patch is drafted.</p>`}
${r.approval.status === "awaiting" && o.canAct !== false ? `<div><button class="primary" data-action="approve">Approve…</button><button data-action="reject">Reject…</button></div>` : ""}
${r.approval.status === "approved" ? `<p class="small">✓ Approved ${esc(new Date(r.approval.at ?? r.generatedAt).toLocaleString())}.</p>` : ""}
${r.approval.status === "rejected" ? `<p class="small">✕ Rejected: ${esc(r.approval.reason)}</p>` : ""}
${fix.diff ? `<div><button data-action="savePatch" ${proven ? "" : "disabled"}>Save patch file</button><button data-action="copyPatch" ${proven ? "" : "disabled"}>Copy patch</button><button data-action="apply" ${proven ? "" : "disabled"}>Apply to working tree…</button>
${proven ? "" : `<p class="muted small">Save, copy and apply unlock after you approve and Nexus proves the fix in its sandbox.</p>`}</div>` : ""}
</div>`
    : `<p class="muted">No fix is suggested.</p>`;
  const v = r.validation;
  const validation =
    v.status === "not_validated"
      ? `<p class="muted">Not validated yet.</p>`
      : `<div class="card ${v.status === "validated" ? "v-verified verdict" : ""}"><b>${v.status === "validated" ? "✓ Validated in Nexus's sandbox" : "◌ Inconclusive"}</b><p>${esc(v.statement)}</p>
${v.before && v.after ? `<p class="small">Before: ${esc(summaryLine(v.before))}<br>After: ${esc(summaryLine(v.after))}</p>` : ""}</div>`;
  const timeline = `<ul>${r.timeline.map((s) => `<li>${(STAGE_ICON[s.status] ?? ["·"])[0]} ${esc(s.title)}: ${esc(STAGE_ICON[s.status]?.[1] ?? s.status)}${s.durationMs != null ? ` (${(s.durationMs / 1000).toFixed(1)} s)` : ""}${s.summary ? ` <span class="muted small">${esc(s.summary)}</span>` : ""}</li>`).join("")}</ul>`;
  const feedback = `<div class="card"><b>Was the cause right?</b><textarea id="fb-note" rows="2" maxlength="500" placeholder="Optional note"></textarea>
<button data-action="feedback" data-correct="true">✓ Cause was correct</button><button data-action="feedback" data-correct="false">✕ Cause was wrong</button></div>`;
  const evidence = r.evidence.length ? r.evidence.slice(0, 40).map((e) => evidenceBlock(e, o)).join("") : `<p class="muted">No evidence was collected.</p>`;
  return shell(
    `Nexus report · ${r.ticketKey}`,
    `${head}${prov}${missing}<h2>Likely causes</h2>${causes}<h2>Code locations</h2>${located}
<h2>What could not be verified</h2>${list(r.couldNotVerify, "Nothing.")}<h2>What would help</h2>${list(r.whatWouldHelp, "Nothing more is needed.")}
<h2>Suggested fix</h2>${fixHtml}<h2>Validation</h2>${validation}<h2>Timeline</h2>${timeline}<h2>All evidence</h2>${evidence}<h2>Feedback</h2>${feedback}
<p class="readonly">${esc(r.readOnlyNote)}</p>`,
    o,
  );
}

function summaryLine(s: unknown) {
  const x = s as { requests?: number; errors?: number; latencyMs?: { p95?: number } | null; lockWaitMs?: { p95?: number } | null };
  return `${x.requests ?? "?"} requests, ${x.errors ?? 0} errors, p95 ${x.latencyMs?.p95 ?? "?"} ms, lock wait p95 ${x.lockWaitMs?.p95 ?? "?"} ms`;
}
