// Storage for IDE-mode investigations: one SQLite file under the engineer's
// profile (local stdio mode) or the server's data folder (HTTP mode).
//
// This is Nexus's own storage. Nothing here writes to Jira, a code host, a
// database or a docs tool. Every read is scoped to the caller's company.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Caller = { companyId: string; engineerId: string; engineerLabel: string };

export function defaultIdeDbPath() {
  return process.env.NEXUS_IDE_DB ?? path.join(os.homedir(), ".nexus", "ide.sqlite");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  engineer_id TEXT NOT NULL,
  ticket_key TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS investigations_company ON investigations (company_id, created_at);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investigation_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  reported_tool TEXT,
  raw_sha256 TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_inv ON submissions (investigation_id);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  company_id TEXT NOT NULL,
  engineer_id TEXT NOT NULL,
  ticket_key TEXT,
  investigation_id TEXT,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investigation_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  engineer_id TEXT NOT NULL,
  correct INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;

export type InvestigationRowIde = {
  id: string;
  company_id: string;
  engineer_id: string;
  ticket_key: string;
  status: string;
  verdict: string | null;
  state_json: string;
  created_at: string;
  updated_at: string;
};

export class IdeStore {
  readonly db: Database.Database;
  constructor(file = defaultIdeDbPath()) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  insert(row: InvestigationRowIde) {
    this.db
      .prepare("INSERT INTO investigations (id, company_id, engineer_id, ticket_key, status, verdict, state_json, created_at, updated_at) VALUES (@id, @company_id, @engineer_id, @ticket_key, @status, @verdict, @state_json, @created_at, @updated_at)")
      .run(row);
  }

  update(id: string, companyId: string, patch: { status: string; verdict: string | null; state_json: string }) {
    this.db
      .prepare("UPDATE investigations SET status = ?, verdict = ?, state_json = ?, updated_at = ? WHERE id = ? AND company_id = ?")
      .run(patch.status, patch.verdict, patch.state_json, new Date().toISOString(), id, companyId);
  }

  /** Only the caller's company. A row from another company reads as not found. */
  get(caller: Caller, id: string): InvestigationRowIde | null {
    return (this.db.prepare("SELECT * FROM investigations WHERE id = ? AND company_id = ?").get(id, caller.companyId) as InvestigationRowIde | undefined) ?? null;
  }

  list(caller: Caller, limit = 20): InvestigationRowIde[] {
    return this.db
      .prepare("SELECT * FROM investigations WHERE company_id = ? AND engineer_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(caller.companyId, caller.engineerId, Math.max(1, Math.min(limit, 100))) as InvestigationRowIde[];
  }

  recordSubmission(s: { investigationId: string; round: number; requestId: string; kind: string; status: string; tool: string | null; rawSha256: string | null; bytes: number; summary: string }) {
    this.db
      .prepare("INSERT INTO submissions (investigation_id, round, request_id, kind, status, reported_tool, raw_sha256, bytes, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(s.investigationId, s.round, s.requestId, s.kind, s.status, s.tool, s.rawSha256, s.bytes, s.summary.slice(0, 300), new Date().toISOString());
  }

  submissions(investigationId: string) {
    return this.db.prepare("SELECT * FROM submissions WHERE investigation_id = ? ORDER BY id").all(investigationId) as {
      round: number;
      request_id: string;
      kind: string;
      status: string;
      reported_tool: string | null;
      raw_sha256: string | null;
      bytes: number;
      summary: string;
    }[];
  }

  /**
   * Audit event. Detail holds ids, counts and hashes only: callers never pass
   * ticket bodies or secrets, and the detail is size-capped as a backstop.
   */
  audit(caller: Caller, action: string, e: { ticketKey?: string | null; investigationId?: string | null; detail?: Record<string, unknown> }) {
    const detail = JSON.stringify(e.detail ?? {}).slice(0, 4000);
    this.db
      .prepare("INSERT INTO audit (at, action, company_id, engineer_id, ticket_key, investigation_id, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), action, caller.companyId, caller.engineerId, e.ticketKey ?? null, e.investigationId ?? null, detail);
  }

  auditFor(caller: Caller, investigationId?: string) {
    return (
      investigationId
        ? this.db.prepare("SELECT * FROM audit WHERE company_id = ? AND investigation_id = ? ORDER BY id").all(caller.companyId, investigationId)
        : this.db.prepare("SELECT * FROM audit WHERE company_id = ? ORDER BY id").all(caller.companyId)
    ) as { action: string; ticket_key: string | null; investigation_id: string | null; detail_json: string; engineer_id: string }[];
  }

  addFeedback(caller: Caller, investigationId: string, correct: boolean, note: string) {
    this.db
      .prepare("INSERT INTO feedback (investigation_id, company_id, engineer_id, correct, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(investigationId, caller.companyId, caller.engineerId, correct ? 1 : 0, note.slice(0, 500), new Date().toISOString());
  }

  close() {
    this.db.close();
  }
}
