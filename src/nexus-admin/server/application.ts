// The customer's application as the Nexus admin describes it: name, what it
// does, where it runs (URLs), and its documentation (links or uploaded files).
// URLs are reference only. Nexus never sends traffic to them; limited load goes
// only to a "Service under test" connector with its own safeguards.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { audit, type Actor } from "./audit";
import { getDb, nowIso } from "./db";

export const ENVIRONMENTS = ["production", "staging", "development", "other"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Extension → MIME type, and how to recognise the file's real content. */
export const ALLOWED_UPLOADS: Record<string, { mime: string; magic?: number[] }> = {
  ".md": { mime: "text/markdown" },
  ".markdown": { mime: "text/markdown" },
  ".txt": { mime: "text/plain" },
  ".pdf": { mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [0x50, 0x4b, 0x03, 0x04] }, // zip
  ".png": { mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  ".jpg": { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  ".jpeg": { mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
};

export type AppInfo = { name: string; description: string; updatedAt: string | null };
export type AppUrl = { id: number; label: string; url: string; environment: Environment; notes: string; createdAt: string };
export type AppDoc = {
  id: number;
  kind: "link" | "file";
  title: string;
  url: string | null;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  notes: string;
  createdAt: string;
  createdBy: string;
};

export function uploadsDir(companyId: number) {
  const base = process.env.NEXUS_UPLOADS_DIR ?? path.join(process.cwd(), ".data", "uploads");
  return path.join(base, String(companyId));
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function checkUrl(raw: string, field: string): string | null {
  if (!raw) return `${field} is required.`;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return `${field} must start with https:// or http://.`;
    if (u.username || u.password) return `Do not put a username or password in ${field}.`;
  } catch {
    return `${field} must be a full address, for example https://app.example.com.`;
  }
  return null;
}

// ---------- reading ----------

export function getApplication(companyId: number) {
  const db = getDb();
  const info = db.prepare("SELECT name, description, updated_at FROM company_applications WHERE company_id = ?").get(companyId) as
    | { name: string; description: string; updated_at: string }
    | undefined;
  const urls = (db.prepare("SELECT * FROM company_app_urls WHERE company_id = ? ORDER BY id").all(companyId) as {
    id: number;
    label: string;
    url: string;
    environment: Environment;
    notes: string;
    created_at: string;
  }[]).map((r) => ({ id: r.id, label: r.label, url: r.url, environment: r.environment, notes: r.notes, createdAt: r.created_at }));
  const docs = (db.prepare("SELECT * FROM company_docs WHERE company_id = ? ORDER BY id DESC").all(companyId) as {
    id: number;
    kind: "link" | "file";
    title: string;
    url: string | null;
    file_name: string | null;
    mime: string | null;
    size_bytes: number | null;
    notes: string;
    created_at: string;
    created_by: string;
  }[]).map(
    (r): AppDoc => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      url: r.url,
      fileName: r.file_name,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      notes: r.notes,
      createdAt: r.created_at,
      createdBy: r.created_by,
    }),
  );
  return {
    info: { name: info?.name ?? "", description: info?.description ?? "", updatedAt: info?.updated_at ?? null } satisfies AppInfo,
    urls,
    docs,
  };
}

// ---------- application name and description ----------

export function saveApplicationInfo(companyId: number, raw: Record<string, unknown>, actor: Actor, ip: string) {
  const name = str(raw.name, 120);
  const description = str(raw.description, 4000);
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Enter the application's name.";
  if (Object.keys(errors).length) return { ok: false as const, errors };
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO company_applications (company_id, name, description, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET name = excluded.name, description = excluded.description, updated_at = excluded.updated_at`,
    )
    .run(companyId, name, description, now);
  audit({ actor, action: "application.details_saved", result: "ok", companyId, target: name, ip });
  return { ok: true as const };
}

// ---------- URLs ----------

export function addAppUrl(companyId: number, raw: Record<string, unknown>, actor: Actor, ip: string) {
  const url = str(raw.url, 2000).replace(/\/+$/, "");
  const label = str(raw.label, 80);
  const notes = str(raw.notes, 500);
  const environment = (ENVIRONMENTS as readonly string[]).includes(String(raw.environment)) ? (raw.environment as Environment) : null;
  const errors: Record<string, string> = {};
  const urlError = checkUrl(url, "The address");
  if (urlError) errors.url = urlError;
  if (!environment) errors.environment = "Choose the environment.";
  const count = (getDb().prepare("SELECT COUNT(*) n FROM company_app_urls WHERE company_id = ?").get(companyId) as { n: number }).n;
  if (count >= 50) errors.url = "This company already has 50 addresses.";
  if (Object.keys(errors).length) return { ok: false as const, errors };
  const info = getDb()
    .prepare("INSERT INTO company_app_urls (company_id, label, url, environment, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(companyId, label, url, environment, notes, nowIso());
  audit({ actor, action: "application.url_added", result: "ok", companyId, target: `${environment} ${new URL(url).host}`, ip });
  return { ok: true as const, id: Number(info.lastInsertRowid) };
}

export function removeAppUrl(companyId: number, urlId: number, actor: Actor, ip: string) {
  const row = getDb().prepare("SELECT url, environment FROM company_app_urls WHERE id = ? AND company_id = ?").get(urlId, companyId) as
    | { url: string; environment: string }
    | undefined;
  if (!row) throw new Error("Address not found for this company.");
  getDb().prepare("DELETE FROM company_app_urls WHERE id = ?").run(urlId);
  audit({ actor, action: "application.url_removed", result: "ok", companyId, target: `${row.environment} ${new URL(row.url).host}`, ip });
}

// ---------- documentation ----------

export function addDocLink(companyId: number, raw: Record<string, unknown>, actor: Actor, ip: string) {
  const url = str(raw.url, 2000);
  const title = str(raw.title, 160);
  const notes = str(raw.notes, 500);
  const errors: Record<string, string> = {};
  const urlError = checkUrl(url, "The link");
  if (urlError) errors.url = urlError;
  if (!title) errors.title = "Give the document a title.";
  if (Object.keys(errors).length) return { ok: false as const, errors };
  const info = getDb()
    .prepare("INSERT INTO company_docs (company_id, kind, title, url, notes, created_at, created_by) VALUES (?, 'link', ?, ?, ?, ?, ?)")
    .run(companyId, title, url, notes, nowIso(), actor.label);
  audit({ actor, action: "application.doc_link_added", result: "ok", companyId, target: title, ip });
  return { ok: true as const, id: Number(info.lastInsertRowid) };
}

/** Stores an uploaded document on the Nexus server. The original name is kept only as metadata. */
export function addDocFile(
  companyId: number,
  file: { name: string; bytes: Buffer },
  meta: { title?: string; notes?: string },
  actor: Actor,
  ip: string,
) {
  const original = path.basename(file.name).replace(/[^\w.\- ()]+/g, "_").slice(0, 160) || "document";
  const ext = path.extname(original).toLowerCase();
  const allowed = ALLOWED_UPLOADS[ext];
  if (!allowed) {
    return { ok: false as const, error: `Upload Markdown, text, PDF, Word (.docx) or image files. ${ext || "This file"} is not accepted.` };
  }
  if (file.bytes.length === 0) return { ok: false as const, error: "The file is empty." };
  if (file.bytes.length > MAX_UPLOAD_BYTES) return { ok: false as const, error: `Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  if (allowed.magic && !allowed.magic.every((b, i) => file.bytes[i] === b)) {
    return { ok: false as const, error: `The file's content does not match its ${ext} extension.` };
  }
  if (!allowed.magic && file.bytes.subarray(0, 8000).includes(0)) {
    return { ok: false as const, error: "That does not look like a text file." };
  }
  const dir = uploadsDir(companyId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stored = `${randomBytes(16).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(dir, stored), file.bytes, { mode: 0o600, flag: "wx" });
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const title = str(meta.title, 160) || original;
  const info = getDb()
    .prepare(
      `INSERT INTO company_docs (company_id, kind, title, file_name, stored_name, mime, size_bytes, sha256, notes, created_at, created_by)
       VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(companyId, title, original, stored, allowed.mime, file.bytes.length, sha256, str(meta.notes, 500), nowIso(), actor.label);
  audit({ actor, action: "application.doc_uploaded", result: "ok", companyId, target: title, ip, detail: { bytes: file.bytes.length, type: ext, sha256 } });
  return { ok: true as const, id: Number(info.lastInsertRowid) };
}

/** The stored file for download, scoped to the company. */
export function readDocFile(companyId: number, docId: number) {
  const row = getDb().prepare("SELECT * FROM company_docs WHERE id = ? AND company_id = ? AND kind = 'file'").get(docId, companyId) as
    | { stored_name: string; file_name: string; mime: string }
    | undefined;
  if (!row || !/^[0-9a-f]{32}\.[a-z]+$/.test(row.stored_name)) return null;
  const file = path.join(uploadsDir(companyId), row.stored_name);
  if (!fs.existsSync(file)) return null;
  return { bytes: fs.readFileSync(file), fileName: row.file_name, mime: row.mime };
}

export function removeDoc(companyId: number, docId: number, actor: Actor, ip: string) {
  const row = getDb().prepare("SELECT * FROM company_docs WHERE id = ? AND company_id = ?").get(docId, companyId) as
    | { kind: string; title: string; stored_name: string | null }
    | undefined;
  if (!row) throw new Error("Document not found for this company.");
  getDb().prepare("DELETE FROM company_docs WHERE id = ?").run(docId);
  if (row.kind === "file" && row.stored_name && /^[0-9a-f]{32}\.[a-z]+$/.test(row.stored_name)) {
    fs.rmSync(path.join(uploadsDir(companyId), row.stored_name), { force: true });
  }
  audit({ actor, action: "application.doc_removed", result: "ok", companyId, target: row.title, ip });
}
