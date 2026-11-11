import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["extensions/nexus-chat/src/extension.ts"],
  outfile: "extensions/nexus-chat/dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
});
