import path from "node:path";
import * as vscode from "vscode";
import {
  applySandboxRemediation,
  collectEvidence,
  CONFIRMATION_PHRASE,
  diagnoseRun,
  measureService,
  proposeRemediation,
  validateRemediation,
  type DiagnosisView,
} from "../../../src/lib/engine";
import { checkNarrative, narrativePrompt } from "../../../src/lib/narrative";

let lastRunId: string | undefined;

function projectRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

function ticketIdFrom(prompt: string) {
  const match = prompt.match(/\b(?:NEX-\d+|NI-\d+)\b/);
  return match?.[0] ?? "NI-1042";
}

async function modelNarrative(
  request: vscode.ChatRequest,
  view: DiagnosisView,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
) {
  if (!request.model) {
    stream.markdown(
      "No language model is selected in Copilot Chat. The text below is the rule-based sandbox result only.\n\n",
    );
    return;
  }
  stream.markdown(`Narrative from the model selected in Copilot Chat (\`${request.model.name}\`):\n\n`);
  let written = "";
  try {
    const response = await request.model.sendRequest(
      [vscode.LanguageModelChatMessage.User(narrativePrompt(view))],
      {},
      token,
    );
    for await (const part of response.text) {
      written += part;
      stream.markdown(part);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The model request failed.";
    stream.markdown(
      `\n\nThe selected model could not be called (${message}). Falling back to the rule-based result.\n\n`,
    );
    return;
  }
  const guard = checkNarrative(written, view);
  stream.markdown("\n\n### Rule-based guardrail\n\n");
  if (guard.aligned) {
    stream.markdown("The narrative was checked against the sandbox rules. No conflicting claim was found.\n\n");
  } else {
    stream.markdown(
      `The narrative is not accepted as the diagnosis. ${guard.notes.join(" ")}\n\nThe rule-based result stands:\n\n${view.hypothesis}\n\n`,
    );
  }
}

export async function activate(context: vscode.ExtensionContext) {
  const participant = vscode.chat.createChatParticipant("nexus.investigate", async (request, _context, stream, token) => {
    const root = projectRoot();
    const command = request.command ?? "investigate";
    if (command !== "investigate") {
      stream.markdown("Use `@nexus /investigate` with a ticket id such as NI-1042 or NEX-4.");
      return;
    }
    const ticketId = ticketIdFrom(request.prompt);
    stream.progress(`Reading ticket ${ticketId}`);
    const scenario = /\boutage\b/i.test(request.prompt) ? "outage" : "lock";
    stream.progress(scenario === "outage" ? "Measuring the catalog outage path" : "Measuring the sandbox catalog");
    const measured = await measureService({ ticketId, scenario, projectRoot: root });
    if (!measured.ok || !measured.run) {
      stream.markdown(measured.message ?? measured.ticket?.disclaimer ?? "The measurement did not start.");
      return;
    }
    lastRunId = measured.run.id;
    stream.markdown(`Ticket source: **${measured.ticket?.source ?? "none"}**. ${measured.ticket?.disclaimer ?? ""}\n\n`);
    stream.progress("Collecting evidence");
    const evidence = collectEvidence(measured.run.id, undefined, root);
    stream.markdown("### Evidence\n\n");
    for (const item of evidence.evidence.filter((record) => measured.run?.diagnosis?.citations.some((citation) => citation.evidenceId === record.id) || record.type === "source").slice(0, 8)) {
      if (item.type === "source" && item.path && item.startLine) {
        const uri = vscode.Uri.file(path.join(root, item.path));
        const position = new vscode.Position(Math.max(0, item.startLine - 1), 0);
        stream.anchor(new vscode.Location(uri, new vscode.Range(position, position)), item.title);
        stream.markdown("\n\n");
      } else {
        stream.markdown(`- ${item.type}: ${item.title} (\`${item.id}\`)\n`);
      }
    }
    stream.progress("Evaluating sandbox rules");
    const diagnosed = diagnoseRun(measured.run.id, undefined, root);
    const view = diagnosed.diagnosis;
    stream.markdown(`### Rule-based diagnosis\n\n${view.hypothesis}\n\nConfidence: **${view.confidence}**. Abstain: **${view.abstain ? "yes" : "no"}**.\n\n`);
    if (view.abstainReason) stream.markdown(`${view.abstainReason}\n\n`);
    await modelNarrative(request, view, stream, token);
    const proposal = proposeRemediation(measured.run.id);
    if (proposal.proposal) {
      stream.markdown(`### Sandbox proposal, not applied\n\n${proposal.proposal.summary}\n\n${proposal.message}\n\n`);
      stream.button({
        command: "nexus.applySandboxRemediation",
        title: "Apply in sandbox and validate",
        arguments: [measured.run.id],
      });
    } else {
      stream.markdown("No sandbox remediation is proposed.\n\n");
    }
  });
  participant.iconPath = new vscode.ThemeIcon("beaker");
  context.subscriptions.push(participant);

  context.subscriptions.push(
    vscode.commands.registerCommand("nexus.applySandboxRemediation", async (runId?: string) => {
      const id = runId ?? lastRunId;
      if (!id) {
        void vscode.window.showWarningMessage("There is no sandbox run to change.");
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        "Apply the remediated behavior on the local catalog and rerun the load? This does not write to Jira or any other system.",
        { modal: true },
        "Apply and validate",
      );
      if (choice !== "Apply and validate") return;
      const applied = await applySandboxRemediation({
        runId: id,
        approvalToken: CONFIRMATION_PHRASE,
      });
      if (!applied.applied) {
        void vscode.window.showErrorMessage(applied.message);
        return;
      }
      const validated = await validateRemediation({ runId: id });
      void vscode.window.showInformationMessage(validated.ok ? validated.message : validated.message);
    }),
  );
}

export function deactivate() {}
