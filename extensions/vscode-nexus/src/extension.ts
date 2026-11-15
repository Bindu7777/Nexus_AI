// Nexus for VS Code: a thin client for the Nexus MCP server.
//
// It contains no investigation logic. It starts an investigation, asks the
// IDE's own chat agent to fetch the evidence Nexus requests (with the tools
// the engineer is signed into), shows live progress and the report, and sends
// the engineer's approvals. It never commits, pushes or opens a pull request.
import { randomBytes } from "node:crypto";
import path from "node:path";
import * as vscode from "vscode";
import type { IdeReport, Progress } from "../../../src/ide/machine";
import { ApplyFlow } from "./core/apply-flow";
import { validateMessage } from "./core/messages";
import { progressHtml, reportHtml, type ProgressModel } from "./core/render";
import { repoFromRemote, ticketFromBranch, ticketFromText } from "./core/ticket";
import { NexusClient, NexusError } from "./client";

type StartResult = { status: string; investigationId: string; report?: IdeReport; progress: Progress; requests?: { id: string }[] };

const SETUP = [
  { name: "Jira (Atlassian MCP)", url: "https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/" },
  { name: "GitHub MCP", url: "https://github.com/github/github-mcp-server" },
  { name: "a database MCP (read-only)", url: "https://github.com/modelcontextprotocol/servers" },
  { name: "Confluence or Notion", url: "https://modelcontextprotocol.io/examples" },
];

const nonce = () => randomBytes(18).toString("base64url");
const hideExcerpts = () => vscode.workspace.getConfiguration("nexus").get<boolean>("hideEvidenceExcerpts", false);

let client: NexusClient;
let log: vscode.OutputChannel;

// ---------- state shown in the UI ----------

let current: { id: string; ticketKey: string } | null = null;
let progress: ProgressModel = null;
let poller: NodeJS.Timeout | null = null;
const reports = new Map<string, IdeReport>();

// ---------- progress view ----------

class ProgressView implements vscode.WebviewViewProvider {
  view: vscode.WebviewView | null = null;
  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, enableCommandUris: false };
    view.webview.onDidReceiveMessage((raw) => {
      const m = validateMessage(raw, null);
      if (!m || !current) return;
      if (m.type === "openChat") void handOffToAgent(current.id, current.ticketKey);
      else if (m.type === "continueWithout") void continueWithout(current.id);
      else if (m.type === "openReport") void openReport(current.id);
    });
    this.render();
  }
  render() {
    if (!this.view) return;
    const showSetup = progress?.phase === "awaiting_evidence";
    this.view.webview.html = progressHtml(progress, { nonce: nonce(), cspSource: this.view.webview.cspSource, setup: showSetup ? SETUP : undefined });
  }
}
const progressView = new ProgressView();

// ---------- status bar ----------

let status: vscode.StatusBarItem;
function updateStatus() {
  if (!progress) {
    status.hide();
    return;
  }
  const running = progress.stages.find((s) => s.status === "running");
  const label = progress.phase === "awaiting_evidence" ? (running?.title ?? "Waiting for evidence") : progress.phase === "awaiting_approval" ? "Fix waiting for your approval" : "Report ready";
  status.text = `$(${progress.phase === "awaiting_evidence" ? "sync~spin" : "beaker"}) Nexus ${progress.ticketKey}: ${label}`;
  status.tooltip = "Open the Nexus panel";
  status.command = "nexus.showProgress";
  status.show();
}

// ---------- history ----------

type HistoryItem = { id: string; ticketKey: string; verdictLabel: string | null; status: string; createdAt: string };
class History implements vscode.TreeDataProvider<HistoryItem> {
  private changed = new vscode.EventEmitter<void>();
  onDidChangeTreeData = this.changed.event;
  refresh() {
    this.changed.fire();
  }
  getTreeItem(h: HistoryItem) {
    const item = new vscode.TreeItem(`${h.ticketKey}`, vscode.TreeItemCollapsibleState.None);
    item.description = h.verdictLabel ?? h.status.replace(/_/g, " ");
    item.tooltip = `${h.ticketKey} · ${new Date(h.createdAt).toLocaleString()}`;
    item.iconPath = new vscode.ThemeIcon(h.verdictLabel ? "notebook" : "sync");
    item.command = { command: "nexus.openReport", title: "Open report", arguments: [h.id] };
    return item;
  }
  async getChildren() {
    try {
      return await client.call<HistoryItem[]>("nexus_list_investigations", { limit: 30 });
    } catch (error) {
      log.appendLine(`History: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }
}
const history = new History();

// ---------- gutter markers on cited lines ----------

let citeDecoration: vscode.TextEditorDecorationType;
const highlightDecoration = vscode.window.createTextEditorDecorationType({ backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"), isWholeLine: true });

type Cite = { path: string; start: number; end: number; title: string; reason: string; excerpt: string | null };
function cites(r: IdeReport): Cite[] {
  const out: Cite[] = r.located.filter((l) => l.startLine).map((l) => ({ path: l.path, start: l.startLine!, end: l.endLine ?? l.startLine!, title: "Code location", reason: l.reason, excerpt: null }));
  for (const e of r.evidence) if (e.location?.path && e.location.startLine) out.push({ path: e.location.path, start: e.location.startLine, end: e.location.endLine ?? e.location.startLine, title: e.title, reason: `${e.observation === "observed" ? "Observed" : "Inferred"} · ${e.provenance}`, excerpt: e.excerpt });
  return out;
}

function workspacePath(rel: string): vscode.Uri | null {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return null;
  const uri = vscode.Uri.joinPath(folder.uri, rel);
  return uri.fsPath.startsWith(folder.uri.fsPath + path.sep) ? uri : null;
}

function relOf(doc: vscode.TextDocument) {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  return folder ? path.relative(folder.uri.fsPath, doc.uri.fsPath).split(path.sep).join("/") : null;
}

function activeCites(): Cite[] {
  const r = current ? reports.get(current.id) : null;
  return r ? cites(r) : [];
}

function decorate(editor: vscode.TextEditor | undefined) {
  if (!editor) return;
  const rel = relOf(editor.document);
  const ranges = activeCites()
    .filter((c) => c.path === rel)
    .map((c) => new vscode.Range(Math.max(0, c.start - 1), 0, Math.max(0, c.end - 1), 0));
  editor.setDecorations(citeDecoration, ranges);
}

// ---------- the investigation flow ----------

async function gitContext() {
  try {
    const api = vscode.extensions.getExtension<{ getAPI(v: 1): { repositories: { state: { HEAD?: { name?: string }; remotes: { fetchUrl?: string }[] } }[] } }>("vscode.git")?.exports?.getAPI(1);
    const repo = api?.repositories[0];
    return { branch: repo?.state.HEAD?.name ?? null, remote: repo?.state.remotes[0]?.fetchUrl ?? null };
  } catch {
    return { branch: null, remote: null };
  }
}

async function pickTicket(arg?: unknown): Promise<string | null> {
  if (typeof arg === "string" && ticketFromText(arg)) return ticketFromText(arg);
  const editor = vscode.window.activeTextEditor;
  const selected = editor && !editor.selection.isEmpty ? ticketFromText(editor.document.getText(editor.selection)) : null;
  const { branch } = await gitContext();
  const guess = selected ?? ticketFromBranch(branch);
  const typed = await vscode.window.showInputBox({
    title: "Nexus: Investigate defect",
    prompt: guess ? `Defect number (found ${guess} in your ${selected ? "selection" : "branch name"})` : "Defect number, for example PAY-1423 or owner/repo#12",
    value: guess ?? "",
    validateInput: (v) => (ticketFromText(v) ? null : "Use a key like PAY-1423 or owner/repo#12."),
  });
  return typed ? ticketFromText(typed) : null;
}

async function investigate(arg?: unknown) {
  const key = await pickTicket(arg);
  if (!key) return;
  const configured = vscode.workspace.getConfiguration("nexus").get<string[]>("repositories", []);
  const { remote } = await gitContext();
  const repos = (configured.length ? configured : [repoFromRemote(remote)]).filter((r): r is string => Boolean(r));
  try {
    const res = await client.call<StartResult>("nexus_start_investigation", { ticketRef: key, repos });
    current = { id: res.investigationId, ticketKey: key };
    await onStep(res);
    await vscode.commands.executeCommand("nexus.progress.focus");
    if (res.status === "needs_evidence") await handOffToAgent(res.investigationId, key);
  } catch (error) {
    void vscode.window.showErrorMessage(`Nexus: ${error instanceof Error ? error.message : error}`);
  }
}

async function onStep(res: { status: string; investigationId: string; report?: IdeReport; progress: Progress }) {
  progress = res.progress;
  progressView.render();
  updateStatus();
  if (res.report) {
    reports.set(res.investigationId, res.report);
    stopPolling();
    history.refresh();
    vscode.window.visibleTextEditors.forEach(decorate);
    await openReport(res.investigationId, res.report);
  } else {
    startPolling(res.investigationId);
  }
}

function stopPolling() {
  if (poller) clearInterval(poller);
  poller = null;
}

function startPolling(id: string) {
  stopPolling();
  poller = setInterval(async () => {
    try {
      const st = await client.call<Progress & { pending: { id: string }[] }>("nexus_get_status", { investigationId: id });
      progress = st;
      progressView.render();
      updateStatus();
      if (st.phase !== "awaiting_evidence") {
        stopPolling();
        const report = await client.call<IdeReport>("nexus_get_report", { investigationId: id });
        await onStep({ status: st.phase, investigationId: id, report, progress: st });
      }
    } catch (error) {
      log.appendLine(`Status: ${error instanceof Error ? error.message : error}`);
    }
  }, 1500);
}

/** Asks the IDE's chat agent to fetch the evidence. The message carries ids only, never ticket text. */
async function handOffToAgent(id: string, key: string) {
  const query = [
    `Use the Nexus MCP tools to supply evidence for Nexus investigation ${id} (ticket ${key}).`,
    `Call nexus_get_status with investigationId "${id}", fulfil each pending request with your connected tools, and call nexus_submit_evidence with the raw, unmodified output for each request id, or status "unavailable" with a reason.`,
    "Repeat until Nexus returns the report. Do not summarise or interpret the evidence and do not add a diagnosis of your own. Never call nexus_approve.",
  ].join(" ");
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query, mode: "agent" });
  } catch {
    const pick = await vscode.window.showInformationMessage(
      "No chat agent is available to fetch evidence. Connect Jira, GitHub, a database and docs tools to your IDE's chat, or continue with what is available.",
      "Show setup",
      "Continue with what is available",
    );
    if (pick === "Show setup") await vscode.commands.executeCommand("nexus.progress.focus");
    if (pick === "Continue with what is available") await continueWithout(id);
  }
}

/** Marks every open request unavailable, so the investigation ends honestly with what it has. */
async function continueWithout(id: string) {
  for (let i = 0; i < 6; i += 1) {
    const st = await client.call<Progress & { pending: { id: string }[] }>("nexus_get_status", { investigationId: id });
    if (st.phase !== "awaiting_evidence" || !st.pending.length) break;
    await client.call("nexus_submit_evidence", { investigationId: id, results: st.pending.map((p) => ({ id: p.id, status: "unavailable", reason: "No IDE agent or connected tool supplied this." })) });
  }
  const report = await client.call<IdeReport>("nexus_get_report", { investigationId: id });
  const st = await client.call<Progress>("nexus_get_status", { investigationId: id });
  if ((report as unknown as { verdict?: string }).verdict) await onStep({ status: st.phase, investigationId: id, report, progress: st });
}

// ---------- report panel ----------

const panels = new Map<string, vscode.WebviewPanel>();
const flows = new Map<string, ApplyFlow>();
const patched = new Map<string, string>();

class PatchedContent implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri) {
    return patched.get(uri.toString()) ?? "";
  }
}

async function openReport(id: string, given?: IdeReport) {
  let report = given ?? reports.get(id) ?? null;
  try {
    report ??= await client.call<IdeReport>("nexus_get_report", { investigationId: id });
  } catch (error) {
    void vscode.window.showErrorMessage(`Nexus: ${error instanceof Error ? error.message : error}`);
    return;
  }
  if (!(report as unknown as { verdict?: string }).verdict) {
    void vscode.window.showInformationMessage("Nexus: the report is not ready yet.");
    return;
  }
  reports.set(id, report);
  current = { id, ticketKey: report.ticketKey };
  let panel = panels.get(id);
  if (!panel) {
    panel = vscode.window.createWebviewPanel("nexus.report", `Nexus · ${report.ticketKey}`, vscode.ViewColumn.Beside, { enableScripts: true, enableCommandUris: false, retainContextWhenHidden: true });
    panels.set(id, panel);
    panel.onDidDispose(() => panels.delete(id));
    panel.webview.onDidReceiveMessage((raw) => void onReportMessage(id, raw));
  }
  panel.webview.html = reportHtml(report, { nonce: nonce(), cspSource: panel.webview.cspSource, hideExcerpts: hideExcerpts() });
  panel.reveal(undefined, true);
  vscode.window.visibleTextEditors.forEach(decorate);
}

function flowFor(id: string) {
  let f = flows.get(id);
  if (!f) {
    f = new ApplyFlow({
      readFile: async (rel) => {
        const uri = workspacePath(rel);
        if (!uri) return null;
        try {
          return (await vscode.workspace.openTextDocument(uri)).getText();
        } catch {
          return null;
        }
      },
      showDiff: async (rel, _original, after) => {
        const left = workspacePath(rel)!;
        const right = vscode.Uri.from({ scheme: "nexus-patch", path: `/${rel}`, query: id });
        patched.set(right.toString(), after);
        await vscode.commands.executeCommand("vscode.diff", left, right, `${rel}: working tree ↔ Nexus suggested fix`);
      },
      confirm: async (message) => (await vscode.window.showWarningMessage(message, { modal: true }, "Apply")) === "Apply",
      writeFile: async (rel, text) => {
        const uri = workspacePath(rel)!;
        const doc = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
        await vscode.workspace.applyEdit(edit);
        await doc.save();
      },
      record: async (action) => {
        await client.call("nexus_record_export", { investigationId: id, action });
      },
    });
    flows.set(id, f);
  }
  return f;
}

async function onReportMessage(id: string, raw: unknown) {
  const report = reports.get(id) ?? null;
  const m = validateMessage(raw, report);
  if (!m || !report) return;
  const fix = report.suggestedFix;
  try {
    switch (m.type) {
      case "openLocation": {
        const uri = workspacePath(m.path);
        if (!uri) return void vscode.window.showWarningMessage(`${m.path} is not in this workspace.`);
        const editor = await vscode.window.showTextDocument(uri, { preview: true });
        const range = new vscode.Range(m.start - 1, 0, m.end - 1, Number.MAX_SAFE_INTEGER);
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.setDecorations(highlightDecoration, [range]);
        decorate(editor);
        break;
      }
      case "openDiff":
        if (fix) {
          const r = await flowFor(id).preview(fix);
          if (!r.ok) void vscode.window.showWarningMessage(r.message);
        }
        break;
      case "apply":
        if (fix) {
          const r = await flowFor(id).apply(fix);
          void (r.ok ? vscode.window.showInformationMessage(r.message) : vscode.window.showWarningMessage(r.message));
        }
        break;
      case "approve": {
        // The engineer types the phrase. The extension never fills it in.
        const typed = await vscode.window.showInputBox({
          title: `Approve the suggested fix for ${report.ticketKey}`,
          prompt: "Type APPLY_SANDBOX_REMEDIATION to let Nexus apply the fix in its own sandbox and prove it. Nothing changes in your repository.",
          ignoreFocusOut: true,
        });
        if (!typed) return;
        const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Nexus is proving the fix in its sandbox…" }, () =>
          client.call<{ report: IdeReport }>("nexus_approve", { investigationId: id, confirmation: typed }),
        );
        reports.set(id, res.report);
        await openReport(id, res.report);
        break;
      }
      case "reject": {
        const reason = await vscode.window.showInputBox({ title: "Reject the suggested fix", prompt: "One line: why?", ignoreFocusOut: true });
        if (!reason) return;
        const res = await client.call<{ report: IdeReport }>("nexus_reject", { investigationId: id, reason });
        await openReport(id, res.report);
        break;
      }
      case "savePatch": {
        if (!fix?.exportable || !fix.diff) return;
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const target = await vscode.window.showSaveDialog({ defaultUri: folder ? vscode.Uri.joinPath(folder, `${report.ticketKey.replace(/[^\w-]/g, "_")}.patch`) : undefined, filters: { Patch: ["patch", "diff"] } });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, Buffer.from(fix.diff, "utf8"));
        await client.call("nexus_record_export", { investigationId: id, action: "save" });
        void vscode.window.showInformationMessage(`Patch saved to ${target.fsPath}. Apply it yourself with git apply when you are ready.`);
        break;
      }
      case "copyPatch":
        if (!fix?.exportable || !fix.diff) return;
        await vscode.env.clipboard.writeText(fix.diff);
        await client.call("nexus_record_export", { investigationId: id, action: "copy" });
        void vscode.window.showInformationMessage("Patch copied.");
        break;
      case "feedback":
        await client.call("nexus_feedback", { investigationId: id, correct: m.correct, note: m.note });
        void vscode.window.showInformationMessage("Thanks. Your feedback is in Nexus's accuracy record.");
        break;
      case "refresh":
        reports.delete(id);
        await openReport(id);
        break;
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Nexus: ${error instanceof NexusError || error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------- activation ----------

export function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel("Nexus");
  client = new NexusClient(context.secrets, log);
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  citeDecoration = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(context.extensionUri, "media", "cite.svg"),
    gutterIconSize: "contain",
    overviewRulerColor: new vscode.ThemeColor("charts.yellow"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  context.subscriptions.push(
    log,
    status,
    citeDecoration,
    highlightDecoration,
    vscode.window.registerWebviewViewProvider("nexus.progress", progressView),
    vscode.window.registerTreeDataProvider("nexus.history", history),
    vscode.workspace.registerTextDocumentContentProvider("nexus-patch", new PatchedContent()),
    vscode.commands.registerCommand("nexus.investigate", (arg?: unknown) => investigate(arg)),
    vscode.commands.registerCommand("nexus.openReport", (id?: string) => (id ?? current?.id ? openReport((id ?? current?.id)!) : undefined)),
    vscode.commands.registerCommand("nexus.showProgress", () => vscode.commands.executeCommand("nexus.progress.focus")),
    vscode.commands.registerCommand("nexus.refreshHistory", () => history.refresh()),
    vscode.commands.registerCommand("nexus.signOut", () => client.signOut()),
    vscode.window.onDidChangeActiveTextEditor(decorate),
    vscode.window.onDidChangeVisibleTextEditors((eds) => eds.forEach(decorate)),
    vscode.languages.registerHoverProvider({ scheme: "file" }, {
      provideHover(doc, pos) {
        const rel = relOf(doc);
        const hit = activeCites().filter((c) => c.path === rel && pos.line + 1 >= c.start && pos.line + 1 <= c.end);
        if (!hit.length) return null;
        const md = new vscode.MarkdownString();
        md.isTrusted = false;
        md.supportHtml = false;
        md.appendMarkdown("**Nexus evidence**\n\n");
        for (const c of hit.slice(0, 3)) {
          md.appendText(`${c.title} · ${c.reason}\n`);
          if (c.excerpt && !hideExcerpts()) md.appendCodeblock(c.excerpt.slice(0, 600));
        }
        return new vscode.Hover(md);
      },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("nexus.server")) void client.close();
      if (e.affectsConfiguration("nexus.hideEvidenceExcerpts") && current) void openReport(current.id);
    }),
    { dispose: () => { stopPolling(); void client.close(); } },
  );

  // @nexus /investigate PAY-1423 in chat.
  const participant = vscode.chat.createChatParticipant("nexus.engineer", async (request, _ctx, stream) => {
    const key = ticketFromText(request.prompt) ?? ticketFromBranch((await gitContext()).branch);
    if (!key) {
      stream.markdown("Give a defect number, for example `/investigate PAY-1423`.");
      return;
    }
    stream.progress(`Starting a Nexus investigation of ${key}`);
    await investigate(key);
    stream.markdown(`Nexus is investigating **${key}**. Progress is in the Nexus panel. Your chat agent is asked to fetch the evidence with your connected tools; Nexus decides what it means.`);
    stream.button({ command: "nexus.showProgress", title: "Show progress" });
  });
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "nexus.svg");
  context.subscriptions.push(participant);
}

export function deactivate() {
  stopPolling();
  return client?.close();
}
