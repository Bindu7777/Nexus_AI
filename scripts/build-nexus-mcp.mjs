// Builds the nexus-mcp package (packages/nexus-mcp): one bundled command plus
// the demo sandbox catalog it can start. Native modules stay as dependencies.
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

const out = "packages/nexus-mcp";
const result = await esbuild.build({
  entryPoints: ["services/mcp/cli.ts"],
  outfile: `${out}/dist/nexus-mcp.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["better-sqlite3", "@node-rs/argon2"],
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __nexusRequire } from \"node:module\";\nconst require = __nexusRequire(import.meta.url);" },
  sourcemap: false,
  legalComments: "none",
  metafile: true,
  logLevel: "info",
});
// The engineer-facing server must not carry the web app, the browser
// automation or any database driver for customer systems.
const forbidden = /node_modules\/(next|react|playwright|pg|mysql2?|undici)\//;
const bad = Object.keys(result.metafile.inputs).filter((f) => forbidden.test(f));
if (bad.length) {
  console.error(`nexus-mcp must not bundle: ${[...new Set(bad.map((f) => f.match(forbidden)[1]))].join(", ")}`);
  process.exit(1);
}
fs.chmodSync(`${out}/dist/nexus-mcp.mjs`, 0o755);
for (const f of ["services/catalog/server.mjs", "services/scenario.json"]) {
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(f, path.join(out, f));
}
console.log(`Built ${out}: dist/nexus-mcp.mjs and the demo catalog.`);
