import { spawn } from "node:child_process";
import process from "node:process";

const webPort = process.env.WEB_PORT ?? "4317";
const catalogPort = process.env.CATALOG_PORT ?? "4318";
process.env.CATALOG_PORT = catalogPort;
process.env.CATALOG_HOST = "127.0.0.1";
process.env.CATALOG_URL = process.env.CATALOG_URL ?? `http://127.0.0.1:${catalogPort}`;

const children = [];

function start(command, args, name) {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (signal || shuttingDown) return;
    console.error(`${name} exited (${code ?? "unknown"}). Stopping the demo.`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("");
console.log("Nexus Intelligence sandbox demo");
console.log(`  Site     http://127.0.0.1:${webPort}`);
console.log(`  Console  http://127.0.0.1:${webPort}/console`);
console.log(`  Catalog  http://127.0.0.1:${catalogPort}  (localhost only)`);
console.log("  The web process binds 0.0.0.0 so a local preview can reach it.");
console.log("  Diagnosis is rule-based. No model key and no Jira connection are used.");
console.log("");

start(process.execPath, ["services/catalog/server.mjs"], "catalog");
start(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--turbopack", "-H", "0.0.0.0", "-p", webPort],
  "web",
);
