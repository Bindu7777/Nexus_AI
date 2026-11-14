// npm run dev:ide — the Nexus MCP server in stdio mode against the seeded
// demo company (sandbox catalog + frozen engine), with data in .data/ide.
// Point your IDE's mcp.json at this command (see docs/ide-setup.md).
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const child = spawn(process.execPath, ["--import", "tsx", path.join(root, "services/mcp/ide-server.ts")], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXUS_IDE_DEMO: "1",
    NEXUS_IDE_COMPANY: process.env.NEXUS_IDE_COMPANY ?? "demo",
    NEXUS_IDE_DB: process.env.NEXUS_IDE_DB ?? path.join(root, ".data", "ide", "ide.sqlite"),
    NEXUS_PROJECT_ROOT: root,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
