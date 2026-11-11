// Shared connector contract.
//
// Every source Nexus reads from (code host, database, ticket tool, logs, docs,
// and the demo catalog) implements Connector. Connectors only read. There is
// no write method on this interface, and `readOnly` is the literal `true`, so a
// connector that could write does not type-check.

export type ConnectorKind = "code" | "database" | "tickets" | "logs" | "docs" | "sandbox";

/** One piece of evidence as a connector observed it. */
export type EvidenceItem = {
  /** Connector id that produced it, e.g. "github". */
  source: string;
  kind: ConnectorKind;
  /**
   * Stable reference. Passing it back to the same connector's fetch() returns
   * the same record. Examples: "github:file:owner/repo@<sha>:src/a.ts#L10-L40",
   * "db:table:public.moments", "log:file:app.log#L120", "doc:file:docs/setup.md#L1-L30".
   */
  ref: string;
  /** When the underlying record was produced (commit date, log time), if known. */
  timestamp: string | null;
  /** When Nexus read it. */
  retrievedAt: string;
  title: string;
  /** Raw excerpt as read. Never paraphrased. May be truncated, never rewritten. */
  excerpt: string;
  /**
   * "observed": read directly from the source.
   * "inferred": derived by Nexus from observed items (for example, which code
   * file mentions which table). Inferred items must list what they were derived from.
   */
  observation: "observed" | "inferred";
  derivedFrom?: string[];
  location?: { path?: string; startLine?: number; endLine?: number; url?: string; revision?: string };
  /** Set when an excerpt holds sampled row data. Reports must hide it unless sampling is reportable. */
  containsSampledData?: boolean;
  meta?: Record<string, unknown>;
};

export type ConnectorTestResult = {
  ok: boolean;
  /** Plain statements of what was reached, e.g. "Repository acme/app (default branch main)". */
  reached: string[];
  /** What to fix, in plain words. Empty when ok. */
  problems: string[];
  /** Non-blocking notes, e.g. "token also has write scope; a read-only token is recommended". */
  warnings: string[];
};

export type SearchQuery = {
  text: string;
  limit?: number;
  /** Connector-specific narrowing, e.g. a repo, a table, a log file, a path prefix. */
  scope?: string;
  /** ISO time; only return records at or after it, where the source has times. */
  since?: string;
};

export interface Connector {
  readonly id: string;
  readonly kind: ConnectorKind;
  /** Declared capability. Always true; there is no write path. */
  readonly readOnly: true;
  /** False for placeholders. Stubs refuse search() and fetch(). */
  readonly implemented: boolean;
  readonly description: string;
  test(): Promise<ConnectorTestResult>;
  search(query: SearchQuery): Promise<EvidenceItem[]>;
  fetch(ref: string): Promise<EvidenceItem | null>;
}

export class NotImplementedConnectorError extends Error {
  constructor(id: string) {
    super(`${id} is a placeholder connector and is not implemented yet.`);
    this.name = "NotImplementedConnectorError";
  }
}

export class ReadOnlyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyViolationError";
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function emptyTestResult(): ConnectorTestResult {
  return { ok: false, reached: [], problems: [], warnings: [] };
}

/** Truncate an excerpt without rewriting it. */
export function clip(text: string, max = 4000) {
  return text.length <= max ? text : `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]`;
}
