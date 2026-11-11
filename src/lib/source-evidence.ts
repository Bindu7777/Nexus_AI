import fs from "node:fs";
import path from "node:path";

export function readSourceRegion(region = "readProduct", projectRoot = process.cwd()) {
  const relativePath = "services/catalog/server.mjs";
  const filePath = path.join(projectRoot, relativePath);
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(`nexus-source-start: ${region}`));
  const end = lines.findIndex((line) => line.includes(`nexus-source-end: ${region}`));
  if (start < 0 || end < start) {
    throw new Error(`Source region ${region} was not found in ${relativePath}.`);
  }
  return {
    path: relativePath,
    startLine: start + 1,
    endLine: end + 1,
    excerpt: lines.slice(start, end + 1).join("\n"),
  };
}
