// The extension's connection to the Nexus MCP server. It only calls Nexus
// tools and shows what they return; there is no investigation logic here.
// Its client name, nexus-vscode, is what lets the engineer's approvals through.
import * as vscode from "vscode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { NexusOAuthProvider } from "./auth";

export const CLIENT_NAME = "nexus-vscode";

export class NexusError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export type ServerSettings =
  | { mode: "stdio"; command: string; args: string[]; cwd: string | undefined; env: Record<string, string> }
  | { mode: "http"; url: string; callbackPort: number };

export function readSettings(): ServerSettings {
  const c = vscode.workspace.getConfiguration("nexus.server");
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const sub = (s: string) => s.replaceAll("${workspaceFolder}", folder ?? "");
  if (c.get<string>("mode") === "http") return { mode: "http", url: c.get<string>("url") || "http://127.0.0.1:4320/mcp", callbackPort: c.get<number>("callbackPort") || 37941 };
  return {
    mode: "stdio",
    command: c.get<string>("command") || "npm",
    args: (c.get<string[]>("args") ?? ["run", "--silent", "dev:ide"]).map(sub),
    cwd: sub(c.get<string>("cwd") || "${workspaceFolder}") || undefined,
    env: Object.fromEntries(Object.entries(c.get<Record<string, string>>("env") ?? {}).map(([k, v]) => [k, sub(String(v))])),
  };
}

export class NexusClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  constructor(
    private secrets: vscode.SecretStorage,
    private log: vscode.OutputChannel,
  ) {}

  private async open(): Promise<Client> {
    const s = readSettings();
    const client = new Client({ name: CLIENT_NAME, version: "0.2.0" });
    if (s.mode === "stdio") {
      this.log.appendLine(`Starting Nexus: ${s.command} ${s.args.join(" ")} (in ${s.cwd ?? "."})`);
      const env = { ...(process.env as Record<string, string>), ...s.env };
      await client.connect(new StdioClientTransport({ command: s.command, args: s.args, cwd: s.cwd, env, stderr: "pipe" }));
      return client;
    }
    const provider = new NexusOAuthProvider(this.secrets, s.url, s.callbackPort);
    const make = () => new StreamableHTTPClientTransport(new URL(s.url), { authProvider: provider });
    const transport = make();
    try {
      await client.connect(transport);
      return client;
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
      // The browser is open on the Nexus sign-in page; wait for its redirect.
      const code = await provider.waitForCode();
      await transport.finishAuth(code);
      const again = new Client({ name: CLIENT_NAME, version: "0.2.0" });
      await again.connect(make());
      return again;
    }
  }

  async get(): Promise<Client> {
    if (this.client) return this.client;
    this.connecting ??= this.open()
      .then((c) => {
        this.client = c;
        c.onclose = () => {
          this.client = null;
        };
        return c;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  async call<T = Record<string, unknown>>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    const c = await this.get();
    const res = (await c.callTool({ name: tool, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean };
    const text = res.content?.find((x) => x.type === "text")?.text ?? "{}";
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new NexusError("Nexus returned something that is not JSON.", "invalid");
    }
    if (res.isError) {
      const v = value as { error?: string; code?: string };
      throw new NexusError(v.error ?? "Nexus refused the call.", v.code ?? "error");
    }
    return value as T;
  }

  async signOut() {
    const s = readSettings();
    if (s.mode === "http") await new NexusOAuthProvider(this.secrets, s.url, s.callbackPort).signOut();
    await this.close();
  }

  async close() {
    const c = this.client;
    this.client = null;
    await c?.close().catch(() => undefined);
  }
}
