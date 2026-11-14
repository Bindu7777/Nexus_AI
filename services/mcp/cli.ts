// nexus-mcp: the Nexus MCP server for engineers.
//
//   nexus-mcp                       stdio, for a local install (your IDE starts it)
//   nexus-mcp --http                streamable HTTP, for a server inside your network
//   nexus-mcp --demo                stdio against the seeded demo company
//   nexus-mcp user add <login> <company-id> [name]   pilot sign-in user (asks for the password)
//   nexus-mcp user revoke <login>
//
// Settings come from the environment; see .env.example. Nexus never needs
// Jira, GitHub, database or docs credentials in this mode.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// In the package, this file is dist/nexus-mcp.mjs; the demo catalog sits next to dist/.
process.env.NEXUS_PROJECT_ROOT ??= path.resolve(here, "..");

const VERSION = "0.2.0";
const args = process.argv.slice(2);

async function main() {
  if (args.includes("--version")) return console.log(VERSION);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`nexus-mcp ${VERSION}
  nexus-mcp            stdio (default)
  nexus-mcp --http     streamable HTTP (NEXUS_HTTP_HOST, NEXUS_HTTP_PORT, NEXUS_PUBLIC_URL)
  nexus-mcp --demo     stdio against the seeded demo company
  nexus-mcp user add <login> <company-id> [name]
  nexus-mcp user revoke <login>
Data: NEXUS_IDE_DB (default ~/.nexus/ide.sqlite).`);
    return;
  }
  if (args.includes("--demo")) {
    process.env.NEXUS_IDE_DEMO = "1";
    process.env.NEXUS_IDE_COMPANY ??= "demo";
  }
  if (args[0] === "user") {
    const { runUserCommand } = await import("./ide-user-cli");
    process.exitCode = await runUserCommand(args.slice(1));
    return;
  }
  if (args.includes("--http")) {
    const { startHttpFromEnv } = await import("./ide-http");
    await startHttpFromEnv();
    return;
  }
  const { startStdio } = await import("./ide-server");
  await startStdio();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
