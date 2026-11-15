// Bundles the Nexus VS Code extension (extensions/vscode-nexus) with esbuild.
// Everything, including the MCP client SDK, is bundled; only "vscode" stays external.
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["extensions/vscode-nexus/src/extension.ts"],
  outfile: "extensions/vscode-nexus/dist/extension.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
  minify: false,
  legalComments: "none",
  logLevel: "info",
});
