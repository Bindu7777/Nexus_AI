// A strict unified-diff applier for the patch Nexus suggests. It applies only
// when every context and removed line matches the working tree exactly, so a
// patch never lands on code that changed since Nexus read it.

export type Hunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] };
export type FilePatch = { path: string; hunks: Hunk[] };

export function parseUnifiedDiff(diff: string): FilePatch[] {
  const files: FilePatch[] = [];
  let current: FilePatch | null = null;
  let hunk: Hunk | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim().replace(/^b\//, "");
      if (!/^(?!\/)(?!.*\.\.)[A-Za-z0-9_./@+-]{1,300}$/.test(p)) throw new Error(`The patch names a path outside the repository: ${p}`);
      current = { path: p, hunks: [] };
      files.push(current);
      hunk = null;
      continue;
    }
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      if (!current) throw new Error("The patch has a hunk before a file header.");
      hunk = { oldStart: Number(h[1]), oldCount: h[2] === undefined ? 1 : Number(h[2]), newStart: Number(h[3]), newCount: h[4] === undefined ? 1 : Number(h[4]), lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk && /^[ +-]/.test(line)) hunk.lines.push(line);
  }
  if (!files.length || files.some((f) => !f.hunks.length)) throw new Error("The patch is empty.");
  return files;
}

export type ApplyResult = { ok: true; text: string } | { ok: false; message: string };

export function applyFilePatch(original: string, patch: FilePatch): ApplyResult {
  const lines = original.split("\n");
  const out: string[] = [];
  let cursor = 0;
  for (const h of patch.hunks) {
    const start = h.oldStart - 1;
    if (start < cursor) return { ok: false, message: "The patch hunks overlap." };
    out.push(...lines.slice(cursor, start));
    let i = start;
    for (const l of h.lines) {
      const body = l.slice(1);
      if (l[0] === "+") {
        out.push(body);
        continue;
      }
      if (lines[i] !== body) return { ok: false, message: `${patch.path} line ${i + 1} differs from what Nexus read. The working tree changed; the patch was not applied.` };
      if (l[0] === " ") out.push(body);
      i += 1;
    }
    cursor = i;
  }
  out.push(...lines.slice(cursor));
  return { ok: true, text: out.join("\n") };
}
