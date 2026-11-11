// Plain log file or folder. Reads only; never opens a file for writing.
// Refs are confined to the configured root, so a ref taken from ticket or log
// text cannot read a file outside it (no "..", no absolute paths, no symlink
// escape).
import fs from "node:fs";
import path from "node:path";
import { clip, type Connector, type EvidenceItem, emptyTestResult, nowIso, type SearchQuery } from "../types";

const LOG_EXT = /\.(log|jsonl|ndjson|txt|out)$/i;
const MAX_FILES = 500;
const MAX_BYTES_PER_FILE = 50 * 1024 * 1024;

export type FileLogConfig = { id?: string; path: string; maxLinesPerFile?: number };

/** Pull a timestamp out of a log line: a JSON time field, or a leading ISO-8601 stamp. */
export function lineTimestamp(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ["timestamp", "time", "ts", "@timestamp", "at", "date"]) {
        const v = obj[key];
        if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
        if (typeof v === "number") return new Date(v > 1e12 ? v : v * 1000).toISOString();
      }
    } catch {
      // not JSON; fall through
    }
  }
  const m = trimmed.match(/^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);
  if (m) {
    const parsed = Date.parse(m[1].replace(" ", "T").replace(",", "."));
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

export function createFileLogConnector(config: FileLogConfig): Connector & {
  listFiles(): string[];
  readLines(relPath: string, startLine: number, endLine: number): EvidenceItem;
} {
  const id = config.id ?? "logs-file";
  const root = path.resolve(config.path);

  function realRoot() {
    return fs.realpathSync(root);
  }
  function isDir() {
    return fs.statSync(root).isDirectory();
  }

  /** Resolve a relative path inside the root, or throw. */
  function confined(rel: string) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
      throw new Error(`Refused log path "${rel}": it must stay inside the configured log location.`);
    }
    const base = realRoot();
    const target = isDir() ? path.join(base, rel) : base;
    const real = fs.realpathSync(target);
    if (real !== base && !real.startsWith(`${base}${path.sep}`)) {
      throw new Error(`Refused log path "${rel}": it resolves outside the configured log location.`);
    }
    return real;
  }

  function listFiles(): string[] {
    if (!isDir()) return [path.basename(root)];
    const base = realRoot();
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= MAX_FILES) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && LOG_EXT.test(entry.name)) out.push(path.relative(base, full));
      }
    };
    walk(base);
    return out.sort();
  }

  function readFileLines(rel: string) {
    const file = confined(rel);
    const size = fs.statSync(file).size;
    if (size > MAX_BYTES_PER_FILE) {
      const fd = fs.openSync(file, "r");
      try {
        const buf = Buffer.alloc(MAX_BYTES_PER_FILE);
        fs.readSync(fd, buf, 0, MAX_BYTES_PER_FILE, size - MAX_BYTES_PER_FILE);
        return { lines: buf.toString("utf8").split(/\r?\n/), offset: null as number | null, truncated: true };
      } finally {
        fs.closeSync(fd);
      }
    }
    return { lines: fs.readFileSync(file, "utf8").split(/\r?\n/), offset: 0, truncated: false };
  }

  function item(rel: string, start: number, end: number, lines: string[], retrievedAt: string): EvidenceItem {
    const excerpt = lines.slice(start - 1, end).join("\n");
    return {
      source: id,
      kind: "logs",
      ref: `log:file:${rel}#L${start}${end !== start ? `-L${end}` : ""}`,
      timestamp: lineTimestamp(lines[start - 1] ?? ""),
      retrievedAt,
      title: `${rel}:${start}${end !== start ? `-${end}` : ""}`,
      excerpt: clip(excerpt, 8000),
      observation: "observed",
      location: { path: rel, startLine: start, endLine: end },
    };
  }

  function readLines(rel: string, startLine: number, endLine: number) {
    const { lines } = readFileLines(rel);
    const start = Math.max(1, startLine);
    const end = Math.min(lines.length, Math.max(start, endLine));
    return item(rel, start, end, lines, nowIso());
  }

  return {
    id,
    kind: "logs",
    readOnly: true,
    implemented: true,
    description: `Log files under ${root}. Read-only.`,
    listFiles,
    readLines,
    async test() {
      const result = emptyTestResult();
      try {
        fs.accessSync(root, fs.constants.R_OK);
        const files = listFiles();
        if (files.length === 0) {
          result.problems.push(`${root} has no .log, .jsonl, .ndjson, .txt or .out files.`);
        } else {
          result.ok = true;
          result.reached.push(`${files.length} log file${files.length === 1 ? "" : "s"} under ${root}`);
          const sample = readFileLines(files[0]).lines.find((l) => l.trim());
          if (sample) {
            result.reached.push(`${files[0]}: ${lineTimestamp(sample) ? "lines carry timestamps" : "no timestamp found on the first line"}`);
          }
        }
      } catch (error) {
        result.problems.push(`Cannot read ${root}. ${error instanceof Error ? error.message : ""}`.trim());
      }
      return result;
    },
    async search(query: SearchQuery) {
      const needle = query.text.toLowerCase();
      const limit = query.limit ?? 50;
      const since = query.since ? Date.parse(query.since) : null;
      const files = query.scope ? [query.scope] : listFiles();
      const retrievedAt = nowIso();
      const out: EvidenceItem[] = [];
      for (const rel of files) {
        const { lines } = readFileLines(rel);
        const cap = config.maxLinesPerFile ?? 200_000;
        for (let i = 0; i < Math.min(lines.length, cap) && out.length < limit; i += 1) {
          if (!lines[i].toLowerCase().includes(needle)) continue;
          if (since != null) {
            const ts = lineTimestamp(lines[i]);
            if (ts && Date.parse(ts) < since) continue;
          }
          out.push(item(rel, i + 1, i + 1, lines, retrievedAt));
        }
        if (out.length >= limit) break;
      }
      return out;
    },
    async fetch(ref: string) {
      const m = ref.match(/^log:file:(.+?)#L(\d+)(?:-L(\d+))?$/);
      if (!m) return null;
      return readLines(m[1], Number(m[2]), Number(m[3] ?? m[2]));
    },
  };
}
