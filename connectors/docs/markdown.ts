// Shared Markdown helpers for the docs connectors.

export const DOC_EXT = /\.(md|mdx|markdown)$/i;

/** Split a Markdown file into sections at headings, with 1-based line ranges. */
export function sections(text: string) {
  const lines = text.split(/\r?\n/);
  const out: { heading: string; level: number; startLine: number; endLine: number }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    const m = !inFence && lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      if (out.length) out[out.length - 1].endLine = i;
      out.push({ heading: m[2], level: m[1].length, startLine: i + 1, endLine: lines.length });
    }
  }
  if (out.length === 0 || out[0].startLine > 1) {
    out.unshift({ heading: "(top of file)", level: 0, startLine: 1, endLine: out.length ? out[0].startLine - 1 : lines.length });
  }
  return { lines, sections: out.filter((s) => s.endLine >= s.startLine) };
}

/** Sections whose heading or body contains the needle. */
export function matchingSections(text: string, needle: string) {
  const n = needle.toLowerCase();
  const { lines, sections: all } = sections(text);
  return all
    .filter((s) => lines.slice(s.startLine - 1, s.endLine).join("\n").toLowerCase().includes(n))
    .map((s) => ({ ...s, body: lines.slice(s.startLine - 1, s.endLine).join("\n") }));
}
