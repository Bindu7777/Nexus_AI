# Nexus in your IDE

Investigate a defect without leaving the editor. You type a defect number;
Nexus decides what evidence it needs and what that evidence means; your IDE's
agent fetches each piece with the tools **you** are already signed into
(Jira, GitHub, a database, docs) and hands back the raw results.

**Nexus never needs your Jira, GitHub, database or docs credentials.** Your
IDE's tools sign in as you. Nexus has no setting for those credentials,
never asks for them, and never passes your token from one server to another.

Nexus is read-only toward your repository and tools. It never commits, pushes,
opens a pull request, or writes to Jira, a database or docs. A suggested fix is
a patch you look at in VS Code's diff view and apply yourself.

## The parts

| Part | What it is |
| --- | --- |
| `nexus-mcp` | The Nexus MCP server. Runs the investigation in code. stdio on your machine, or streamable HTTP inside your company's network. |
| `nexus-vscode-0.2.0.vsix` | The VS Code extension: live progress, the report, code links, the diff view, and your approvals. No investigation logic. |
| Your IDE's agent | Copilot, Cursor or Claude Code with your own MCP tools. It only fetches what Nexus asks for. |

## Build the packages (once)

From a clone of this repository, with Node.js 22 or newer:

```bash
npm ci
```

```bash
npm run ide-extension:package
```

```bash
npm run nexus-mcp:pack
```

That writes `nexus-vscode-0.2.0.vsix` and `nexus-mcp-0.2.0.tgz` to the
repository root. Both install from disk: no marketplace and no internet access
are needed once they are built.

Install the server command:

```bash
npm install -g ./nexus-mcp-0.2.0.tgz
```

Install the extension: in VS Code, open the Extensions view, choose
**… → Install from VSIX…** and pick `nexus-vscode-0.2.0.vsix`, or run:

```bash
code --install-extension nexus-vscode-0.2.0.vsix
```

Cursor installs the same file with `cursor --install-extension nexus-vscode-0.2.0.vsix`.

Install only one of this extension and the older demo extension
(`extensions/nexus-chat`): both use the `@nexus` chat name.

## Try it on the demo company

The seeded demo company runs Nexus's own sandbox: a local catalog service and
the rule engine. Use `--demo` (or `npm run dev:ide` inside this repository).

1. Add the server to your IDE (snippets below), with `nexus-mcp --demo`.
2. In the extension settings, keep `nexus.server.mode` on `stdio` and set
   `nexus.server.command` to `nexus-mcp` and `nexus.server.args` to `["--demo"]`
   (inside this repository the defaults, `npm run --silent dev:ide`, already work).
   The extension and your IDE's agent must use the same Nexus data folder,
   so keep `NEXUS_IDE_DB` the same in both, or leave it unset in both.
3. Run **Nexus: Investigate defect** and type `NEX-5`, or type
   `@nexus /investigate NEX-5` in chat. In VS Code with Copilot the server's
   prompt is also available as `/mcp.nexus.investigate`.
4. The Nexus panel lights up stage by stage. Your chat agent is asked to read
   NEX-5 with your Jira tool. Without one, choose **Continue with what is
   available**: Nexus says what is missing instead of guessing.
5. The report opens: *Diagnosed (not verified)*, lock contention, the evidence
   Nexus measured in its sandbox, and the suggested diff.
6. Choose **Approve…** and type the confirmation phrase. Nexus applies the fix in
   its own sandbox and runs the load again: *Diagnosed and verified*, with
   before and after numbers.
7. Now **Save patch file**, **Copy patch** or **Apply to working tree…**.
   Applying shows the diff first and needs a second click. Nothing is committed.

`NI-1042` needs no ticket tool at all: it is Nexus's own seeded example.

## Add Nexus to your IDE

### VS Code (with Copilot)

`.vscode/mcp.json` in your project, or your user `mcp.json`:

```json
{
  "servers": {
    "nexus": { "type": "stdio", "command": "nexus-mcp" }
  }
}
```

A Nexus server inside your network:

```json
{
  "servers": {
    "nexus": { "type": "http", "url": "https://nexus.example.internal/mcp" }
  }
}
```

VS Code signs you in to Nexus the first time (OAuth 2.1 with PKCE): with the
built-in pilot sign-in, or with your company's identity provider if it lets
VS Code register as a client (dynamic client registration, or a client your
admin registers for it).

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nexus": { "command": "nexus-mcp" }
  }
}
```

HTTP:

```json
{
  "mcpServers": {
    "nexus": { "url": "https://nexus.example.internal/mcp" }
  }
}
```

### Claude Code

```bash
claude mcp add nexus -- nexus-mcp
```

HTTP:

```bash
claude mcp add --transport http nexus https://nexus.example.internal/mcp
```

Or `.mcp.json` in the project:

```json
{
  "mcpServers": {
    "nexus": { "type": "stdio", "command": "nexus-mcp" }
  }
}
```

Inside this repository the `nexus-ide` entry in `.vscode/mcp.json`,
`.cursor/mcp.json` and `.mcp.json` already starts `npm run --silent dev:ide`.
The older `nexus` entry is the seven-tool demo server.

## Connect your own tools

Nexus asks for evidence by kind. Connect the MCP tools your IDE should use to
fetch it; each signs in as you, in your IDE, and Nexus never sees those tokens.

| Evidence | Connect | Setup |
| --- | --- | --- |
| Ticket | Jira (Atlassian's MCP server) or GitHub Issues | [Atlassian MCP](https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/) · [GitHub MCP](https://github.com/github/github-mcp-server) |
| Commits, code search, files, test runs | GitHub's MCP server, or your editor's own file and terminal tools | [GitHub MCP](https://github.com/github/github-mcp-server) |
| Schema, query statistics | A database MCP server connected with a **read-only** role | [MCP servers](https://github.com/modelcontextprotocol/servers) |
| Docs | Confluence (Atlassian MCP) or Notion | [Atlassian MCP](https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/) |
| Logs | Your log tool's MCP server (Datadog, Grafana, CloudWatch, Vercel) | your vendor's MCP page |

For VS Code, GitHub's hosted MCP server is:

```json
{
  "servers": {
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" }
  }
}
```

For a database, create a role that can only read (for Postgres:
`GRANT SELECT` on the schemas you allow, and `default_transaction_read_only = on`
for the role), and give that role to the database MCP server in your IDE. The
credentials stay in your IDE's configuration.

Anything not connected is shown plainly in the progress panel and in the
report, with what would help. Missing required evidence (the ticket) ends as
*Needs more information*; other gaps end as *Not enough evidence*. Neither is
a guess.

## How evidence is trusted

- Every piece of evidence carries where it came from: **From your IDE agent**
  (client-supplied), **Fetched by Nexus**, or **Run by Nexus** (in its sandbox).
- *Diagnosed and verified* is only ever reached on proof Nexus ran itself.
  Evidence your agent supplied can support a cause, but caps the result at
  *Diagnosed (not verified)*.
- Nexus stores a hash of each raw result and the tool name your agent reported,
  so a reviewer can audit what was submitted.
- Ticket text, logs, files and documents are data. They cannot add or change a
  request, a verdict, or an approval. Instruction-like lines are marked as data
  in the report.
- Approval is your action in the extension. Nexus accepts it only from the
  extension, with the phrase you type, and never in the same moment as an
  evidence submission.

## Run Nexus inside your company's network (HTTP mode)

```bash
nexus-mcp --http
```

Settings are in [`packages/nexus-mcp/.env.example`](../packages/nexus-mcp/.env.example).
The essentials:

- `NEXUS_PUBLIC_URL`: the https address your engineers' IDEs use. The MCP
  endpoint is `<NEXUS_PUBLIC_URL>/mcp`. Only that host name is answered.
- Your identity provider: `NEXUS_OIDC_ISSUER`, `NEXUS_OIDC_JWKS_URL`, and
  `NEXUS_OIDC_COMPANY` (or `NEXUS_OIDC_COMPANY_CLAIM`). Access tokens must name
  `<NEXUS_PUBLIC_URL>/mcp` as their audience and carry the scope
  `nexus.investigate`; approving needs `nexus.approve`. Signature, issuer,
  audience and expiry are checked on every call.
- Pilots without an identity provider yet: `NEXUS_PILOT_LOGIN=1`, then add users
  with `nexus-mcp user add <login> <company-id>` (you type the password; it is
  stored as an Argon2id hash). Five wrong passwords lock a login for 15 minutes.
  Access tokens last 10 minutes and are bound to this server.
- Every investigation belongs to the signed-in engineer's company. Engineers of
  one company never see another company's investigations.

Container image (from `packages/nexus-mcp` after `npm run nexus-mcp:build`):

```bash
docker build -t nexus-mcp:0.2.0 packages/nexus-mcp
```

```bash
docker run -p 4320:4320 -v nexus-data:/data -e NEXUS_PUBLIC_URL=https://nexus.example.internal -e NEXUS_OIDC_ISSUER=https://login.example.internal -e NEXUS_OIDC_COMPANY=acme nexus-mcp:0.2.0
```

A Helm chart stub is in [`deploy/helm/nexus-mcp`](../deploy/helm/nexus-mcp). It runs one
replica as a non-root user with a read-only root filesystem and has no secret,
because Nexus needs none of your source credentials.

In the extension, set `nexus.server.mode` to `http` and `nexus.server.url` to
the MCP endpoint. The extension signs in through your browser and keeps its
token in VS Code's secret storage.

## Extension settings

| Setting | Default | What it does |
| --- | --- | --- |
| `nexus.server.mode` | `stdio` | `stdio` starts a local server; `http` connects to one in your network. |
| `nexus.server.command`, `nexus.server.args`, `nexus.server.cwd`, `nexus.server.env` | `npm run --silent dev:ide` in the workspace | How the local server is started. Use the same command as your IDE's MCP entry. |
| `nexus.server.url`, `nexus.server.callbackPort` | `http://127.0.0.1:4320/mcp`, `37941` | HTTP server, and the loopback port for its sign-in redirect. |
| `nexus.repositories` | from the GitHub remote | Repositories, as `owner/name`, for commits and code. |
| `nexus.hideEvidenceExcerpts` | `false` | Hide evidence excerpts in the report and hovers, for screenshots. |

## Dependencies

Pinned versions. None of them sends data to an outside service, and nothing
here has telemetry.

| Package | Version | Where | Why |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.2 | bundled into `nexus-mcp` and the extension | MCP server and client |
| `zod` | 4.6.7 | bundled | input validation |
| `better-sqlite3` | 12.11.1 | `nexus-mcp` dependency | Nexus's own local storage |
| `@node-rs/argon2` | 2.2.2 | `nexus-mcp` dependency | pilot password hashing |

Build-time only: `esbuild` (bundling) and `@vscode/vsce` (packaging the `.vsix`).
`npm install` downloads the prebuilt native binaries for `better-sqlite3` and
`argon2` when the package is installed; at run time `nexus-mcp` makes no
outbound call except to the identity provider's key set you configure. The
extension connects only to the Nexus server you configure.

## Try the protocol without any real tool

A fixture "IDE agent" plays the agent's part from local JSON files:

```bash
npm run ide:fixture -- tests/ide/fixtures/pay-1423.json
```

```bash
npm run ide:fixture -- tests/ide/fixtures/nex-5.json
```

## Troubleshooting

- **The panel waits for evidence forever.** Your chat agent was not started or
  has no Nexus tools. Check that the `nexus` server is enabled in your IDE's MCP
  list, then choose **Ask the chat agent to continue**, or **Continue with what
  is available**.
- **The extension cannot find the investigation the agent is working on.** The
  extension and the IDE's MCP entry use different data folders. Use the same
  command and the same `NEXUS_IDE_DB` in both.
- **Approve is refused.** Approvals come only from the extension, with the
  phrase you type, a moment after the last evidence arrived. In HTTP mode the
  extension's sign-in must include the `nexus.approve` scope.
- **Apply is refused.** The file changed after you looked at the diff, or the
  fix has not been proven in Nexus's sandbox yet. Open the diff again.
