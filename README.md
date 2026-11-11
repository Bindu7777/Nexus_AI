# Nexus Intelligence

Nexus Intelligence is an AI defect-investigation agent. It is sold as two-week onsite pilots. The agent reads a defect ticket, measures a service, cites the evidence it actually collected, and proposes a remediation only when its rules fire. An engineer approves any change. The product line is **more time for product**.

This repository is the defect-investigation demo: a Next.js web console, one shared engine, a Nexus MCP stdio server with seven tools, built-in agent files for VS Code Copilot, Cursor, and Claude Code, an optional VS Code `@nexus` extension, and a read-only Jira adapter for project `NEX`.

## Status

This is a demo and a prototype.

- The sandbox and simulated data are labeled in the product. Ticket `NI-1042` is a seeded example. Jira issues `NEX-5`, `NEX-6`, and `NEX-7` carry the label `nexus-demo` and are simulated sandbox data, not customer incidents.
- The IDE agent files and the MCP server have not been run inside a real Copilot, Cursor, or Claude chat session. They were checked for frontmatter and for the shared MCP command, and a script client ran the MCP workflow against the local catalog.
- Live Jira is untested. The adapter is implemented as read-only HTTP GET and is covered by tests that stub the HTTP client. No live call to `https://nexusintelligence.atlassian.net` has been made from this demo.
- `npm ci` reports a known PostCSS security advisory that arrives through Next.js 15.5.29. That Next.js major upgrade was not applied.

Nothing in the offline demo reads a private machine, a model credential, or a customer system. Nothing writes outside the local sandbox.

## Quick start

Requires Node.js 22 or newer (this includes npm). No API keys are required for the offline example.

Mac, Linux, and Windows (PowerShell, Command Prompt, or Git Bash):

```bash
git clone https://github.com/Raviteja-14-str/nexus-intelligence.git && cd nexus-intelligence && npm ci && npm run demo
```

Open http://127.0.0.1:4317. Leave that process running while you use the console or an IDE. Stop it with Ctrl+C.

`npm run demo` starts two processes:

- Web console on port 4317, bound to `0.0.0.0` so a local preview can reach it. Use http://127.0.0.1:4317 in the browser.
- Catalog on port 4318, bound to `127.0.0.1` only. The web server calls it. The browser does not.

`WEB_PORT` and `CATALOG_PORT` override the ports. `CATALOG_URL` overrides where the web server looks for the catalog.

Other commands:

```bash
npm test                 # engine, Jira mapping, MCP stdio client, live catalog investigation
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run build            # next build
npm run mcp              # Nexus MCP stdio server
npm run mcp:inspect
npm run agents:build     # regenerate IDE agent files from agent/workflow.md
npm run extension:package
npm run catalog          # catalog process alone
npm run dev              # web process alone; expects the catalog on 4318
```

## Use Nexus in your IDE

The default path is each IDE's built-in custom agent. All three call the same Nexus MCP stdio server (`npx tsx services/mcp/server.ts`) and the same seven tools. The model is the one you pick in that IDE. This repo does not hardcode a model. The `@nexus` vsix is optional.

Edit `agent/workflow.md`, then run `npm run agents:build`. Do not hand-edit the generated IDE files.

| IDE | Files | Invoke | Model |
| --- | --- | --- | --- |
| VS Code Copilot | `.github/agents/nexus-investigator.agent.md`, `.github/prompts/investigate.prompt.md`, `.vscode/mcp.json` | Select the Nexus investigator agent, or run the `investigate` prompt. Examples: `NI-1042`, `NEX-5`, `NEX-6`, `NEX-7` | The model selected in the Copilot picker. No model is set in the agent file. |
| Cursor | `.cursor/rules/nexus-investigation.mdc`, `.cursor/commands/investigate.md`, `.cursor/mcp.json` | `/investigate NI-1042`, `/investigate NEX-5`, `/investigate NEX-6`, `/investigate NEX-7` | The model selected in Cursor. |
| Claude Code | `.claude/agents/nexus-investigator.md`, `.claude/skills/nexus-investigate/SKILL.md`, `.claude/commands/investigate.md`, `.mcp.json` | `/investigate NEX-5` or mention the nexus-investigator subagent | Claude Code's selected model. The agent file does not pin one. |

Offline example, no Jira credentials: `/investigate NI-1042`. That seeded ticket runs the lock scenario.

The catalog from `npm run demo` must be running before an IDE agent measures the service. The MCP server is started by the IDE and talks to that catalog.

## Live Jira

The adapter reads one issue with HTTP GET. It never creates, edits, or transitions an issue. Project key `NEX` (project name NEXUS) at https://nexusintelligence.atlassian.net. Issue type name: `Defect test`. Label `nexus-demo` marks simulated sandbox data.

Copy the template and fill in the account email and API token. Leave the file uncommitted. `.gitignore` ignores `.env*` and keeps `.env.example`.

```bash
cp .env.example .env
```

`.env.example` contains:

```bash
JIRA_BASE_URL=https://nexusintelligence.atlassian.net
JIRA_EMAIL=
JIRA_API_TOKEN=
JIRA_PROJECT_KEY=NEX
```

The Next.js console reads `.env` on its own. The MCP stdio server does not. It inherits the environment of the process that launches it, so export the same variables in that shell before you start the IDE (or start the IDE from a shell where they are already set).

Mac and Linux:

```bash
export JIRA_BASE_URL="https://nexusintelligence.atlassian.net"
export JIRA_EMAIL="you@example.com"
export JIRA_API_TOKEN="paste-a-token-here"
export JIRA_PROJECT_KEY="NEX"
```

Windows PowerShell:

```powershell
$env:JIRA_BASE_URL = "https://nexusintelligence.atlassian.net"
$env:JIRA_EMAIL = "you@example.com"
$env:JIRA_API_TOKEN = "paste-a-token-here"
$env:JIRA_PROJECT_KEY = "NEX"
```

Windows Command Prompt:

```bat
set JIRA_BASE_URL=https://nexusintelligence.atlassian.net
set JIRA_EMAIL=you@example.com
set JIRA_API_TOKEN=paste-a-token-here
set JIRA_PROJECT_KEY=NEX
```

Create an Atlassian API token for the email you set. Do not commit the token.

Then, with the demo running:

- `/investigate NEX-5` maps to the lock scenario. Expected: the rules find the sandbox cause.
- `/investigate NEX-6` maps to the outage scenario. Expected: abstain and escalate. Not a lock finding.
- `/investigate NEX-7` is thin evidence about cart totals. Expected: ask for traces or a reproduction. No cart numbers are invented.

If `JIRA_EMAIL` or `JIRA_API_TOKEN` is empty, a `NEX-*` key stops with an unconfigured message. The agent is instructed not to invent the issue body. Live calls to the Jira site have not been exercised yet. See Status.

## Optional VS Code extension

`@nexus` is an extra Copilot Chat participant. The built-in IDE agents do not need it. The packaged `.vsix` is not committed. Build it locally:

```bash
npm run extension:package
```

That compiles `extensions/nexus-chat` and writes `extensions/nexus-chat/nexus-defect-chat.vsix`. Install it with:

```bash
code --install-extension extensions/nexus-chat/nexus-defect-chat.vsix
```

Then, with `npm run demo` already running, `@nexus /investigate NI-1042`. The extension uses the model selected in Copilot Chat and checks that narrative against the rule-based diagnosis.

## Architecture

One engine, in `src/lib`, does the work. `src/lib/engine.ts` is the API. `src/lib/investigate.ts` runs the load. `src/lib/diagnosis.ts` is the rule set. The Next.js console, the MCP server, and the optional extension all call that engine. They do not each carry a copy of the rules.

The MCP server (`services/mcp/server.ts`) is the enforcement point for IDE agents. It exposes seven tools over stdio:

1. `get_ticket`
2. `measure_service`
3. `collect_evidence`
4. `diagnose`
5. `propose_remediation`
6. `apply_sandbox_remediation`
7. `validate`

Agents are instructed to use only those tools, in that order. The server refuses an unimplemented target (the OpenTelemetry Astronomy Shop entry is a placeholder and is not started). It abstains when the rules do not fire or the ticket text is too thin. It will not validate until the sandbox apply step has succeeded.

Connectors are read-only. The Jira adapter (`src/lib/tickets/jira.ts`) sends HTTP GET for one issue and maps the text onto a labeled sandbox scenario. It does not write to Jira, git, Slack, or any other remote system. Measurements come from the local catalog process in `services/catalog/server.mjs`.

`APPLY_SANDBOX_REMEDIATION` is the approval token. `apply_sandbox_remediation` switches only the local catalog into remediated mode, and only when that exact token is supplied. Any other value is refused. The web console sends the same phrase from `POST /api/validate` after the engineer checks the box and confirms the dialog. The catalog admin port is not exposed to the browser.

Audit is the in-memory run record. Each investigation stores a timestamped timeline, the samples and evidence it collected (traces, logs, metric aggregates, and source excerpts with path and line numbers), the rule results, and the proposal status (`not_applied` or `applied_in_sandbox`). Reset or a process restart drops that record. There is no separate durable audit log in this demo.

## What the console does

1. Read ticket **NI-1042**. The badge says it is a seeded example.
2. Choose **Run investigation**. The app clears the catalog, runs the baseline load, switches the catalog to incident mode, and runs the same load again.
3. Read the baseline and incident table. Open any cited trace, log, metric aggregate, or source excerpt stored from this run.
4. Read the rules, including the ones that fired, and the uncertainties. A lock finding appears only when the latency rule, the lock-wait rule, and the queue rule all fire.
5. If the lock rules fire, review the proposal. Check the engineer box and confirm the dialog. Only then does the sandbox switch to remediated mode and repeat the load.
6. **Reset scenario** returns the catalog to baseline and drops the session’s stored runs.
7. **Simulate catalog outage** makes the catalog return HTTP 503. The rules then report an unavailable service and do not propose the lock change.

The scenario is fixed in `services/scenario.json`: 32 requests, concurrency 8, client timeout 5000 ms, read timer 80 ms. Baseline and the remediated sandbox place that timer outside the lock. Incident mode places it inside the lock. The 80 ms read is a timer standing in for an expensive critical section. Client latency is `performance.now()` around each real HTTP call. Lock wait, lock hold, and queue depth are measured on the catalog’s mutex. Tests assert those relationships, not one run’s exact milliseconds.

The catalog is a small local process. It is not the OpenTelemetry Astronomy Shop, and that shop is not started. The remediated mode is a sandbox stand-in for the proposal. It is not a patch applied to a production repository. Do not claim a production fix, a time saving, or a percentage improvement from this demo.

No authentication is included. Do not expose this demo to an untrusted network.

## Repo layout

```
agent/workflow.md                         Source of the IDE agent instructions
.github/                                  VS Code Copilot agent, prompt, and instructions
.cursor/                                  Cursor rule, command, and MCP config
.claude/                                  Claude Code agent, command, and skill
.vscode/mcp.json                          Copilot MCP server entry
.mcp.json                                 Claude Code MCP server entry
services/mcp/server.ts                    Nexus MCP stdio server (seven tools)
services/catalog/server.mjs               Local catalog, mutex, logs, and traces
services/scenario.json                    Products, load profile, and read timer
src/lib/engine.ts                         Shared engine used by the console, MCP, and extension
src/lib/investigate.ts                    Load orchestration and in-memory timeline
src/lib/diagnosis.ts                      Rules, validation comparison, and approval gate
src/lib/tickets/jira.ts                   Read-only Jira adapter
src/app/                                  Next.js console and API routes
src/components/demo/                      Buyer-demo UI
extensions/nexus-chat/                    Optional @nexus VS Code extension source
scripts/                                  demo, agent rebuild, extension package, MCP inspect
tests/                                    Rules, engine, Jira mapping, MCP, and live catalog
config/targets.json                       sandbox-catalog (active) and the Astronomy Shop placeholder
.env.example                              Jira variable names only; no secrets
```
