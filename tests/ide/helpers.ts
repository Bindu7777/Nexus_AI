// Shared test wiring: an in-process Nexus MCP server and clients with chosen names.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createIdeMcpServer } from "../../services/mcp/ide-server.ts";
import { loadFixture, type Fixture } from "../../src/ide/fixture-agent.ts";
import type { IdeDeps } from "../../src/ide/machine.ts";
import type { Sandbox } from "../../src/ide/sandbox-demo.ts";
import { IdeStore, type Caller } from "../../src/ide/store.ts";

export const fixture = (name: string): Fixture => loadFixture(path.join(process.cwd(), "tests/ide/fixtures", name));

export function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-ide-test-"));
  return { store: new IdeStore(path.join(dir, "ide.sqlite")), dir };
}

export const ACME: Caller = { companyId: "acme", engineerId: "sam", engineerLabel: "Sam" };
export const GLOBEX: Caller = { companyId: "globex", engineerId: "ann", engineerLabel: "Ann" };

export async function connect(deps: IdeDeps, caller: Caller, clientName = "test-agent") {
  const server = createIdeMcpServer(deps, () => caller);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: clientName, version: "1.0.0" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const value = JSON.parse(res.content[0].text);
    return res.isError ? { __error: true, ...value } : value;
  };
  return { client, call, close: () => client.close() };
}

export function deps(store: IdeStore, extra: Partial<IdeDeps> = {}): IdeDeps {
  return { store, sandbox: null, approverClients: ["nexus-vscode"], ...extra };
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export type { Sandbox };
