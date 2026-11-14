// Built-in sign-in for pilots: a small OAuth 2.1 authorization server inside
// Nexus, used when the company has not connected its identity provider yet.
//
// - Authorization code flow with PKCE (S256 only), public clients registered
//   dynamically, exact redirect URI match, single-use codes valid 60 seconds.
// - Access tokens are opaque, short-lived (10 minutes), bound to this server's
//   resource URL (audience) and stored only as SHA-256 hashes. Refresh tokens
//   rotate on use; reusing an old one revokes the whole family.
// - Passwords are Argon2id hashes. Failed sign-ins are rate limited per
//   address and lock the login for 15 minutes after 5 failures.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import { burnVerifyTime, hashPassword, normaliseLoginId, passwordProblems, verifyPassword } from "../../nexus-admin/server/passwords";

export const SCOPES = ["nexus.investigate", "nexus.approve"] as const;
export const ACCESS_TTL_MS = 10 * 60_000;
export const REFRESH_TTL_MS = 8 * 3600_000;
export const CODE_TTL_MS = 60_000;
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pilot_users (
  login TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  label TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  login TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  family TEXT NOT NULL,
  client_id TEXT NOT NULL,
  login TEXT NOT NULL,
  scope TEXT NOT NULL,
  audience TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
`;

export type Principal = { sub: string; label: string; companyId: string; scopes: string[]; expiresAt: number; clientId: string | null; source: "pilot" | "oidc" };

export class OAuthError extends Error {
  constructor(
    readonly error: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_scope" | "invalid_target" | "access_denied" | "invalid_redirect_uri" | "invalid_client_metadata",
    message: string,
  ) {
    super(message);
  }
}

/** http only for loopback; https anywhere; app schemes (vscode://, cursor://) allowed; script-ish schemes never. */
export function redirectUriAllowed(uri: string) {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (/^(javascript|data|file|vbscript|blob|about):$/i.test(u.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

export class PilotAuth {
  private attempts = new Map<string, number[]>();
  constructor(
    private db: Database.Database,
    readonly resource: string,
    private now: () => number = () => Date.now(),
  ) {
    db.exec(SCHEMA);
  }

  // ---------- users ----------

  async addUser(input: { login: string; companyId: string; label?: string; password: string }) {
    const login = normaliseLoginId(input.login);
    if (!/^[a-z0-9._@+-]{3,120}$/.test(login)) throw new Error("Use a login of 3 to 120 letters, digits or . _ @ + -");
    if (!/^[a-z0-9_-]{1,60}$/i.test(input.companyId)) throw new Error("Use a company id of letters, digits, _ or -.");
    const problems = passwordProblems(input.password, login);
    if (problems.length) throw new Error(problems.join(" "));
    const hash = await hashPassword(input.password);
    this.db
      .prepare("INSERT INTO pilot_users (login, company_id, label, password_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(login) DO UPDATE SET company_id = excluded.company_id, label = excluded.label, password_hash = excluded.password_hash, failed = 0, locked_until = 0")
      .run(login, input.companyId, input.label ?? login, hash, new Date(this.now()).toISOString());
    return { login, companyId: input.companyId };
  }

  /** Rate limit by address: at most 10 attempts a minute. */
  private limited(ip: string) {
    const t = this.now();
    const list = (this.attempts.get(ip) ?? []).filter((x) => t - x < 60_000);
    list.push(t);
    this.attempts.set(ip, list);
    return list.length > 10;
  }

  async checkPassword(loginRaw: string, password: string, ip: string): Promise<{ ok: true; login: string } | { ok: false; message: string }> {
    const generic = "The login or password is not right.";
    if (this.limited(ip)) return { ok: false, message: "Too many sign-in attempts from this address. Wait a minute and try again." };
    const login = normaliseLoginId(loginRaw).slice(0, 120);
    const user = this.db.prepare("SELECT * FROM pilot_users WHERE login = ?").get(login) as { password_hash: string; failed: number; locked_until: number } | undefined;
    if (!user) {
      await burnVerifyTime(password);
      return { ok: false, message: generic };
    }
    if (user.locked_until > this.now()) {
      await burnVerifyTime(password);
      return { ok: false, message: "This login is locked after too many failed attempts. Try again in 15 minutes." };
    }
    if (!(await verifyPassword(user.password_hash, password))) {
      const failed = user.failed + 1;
      this.db.prepare("UPDATE pilot_users SET failed = ?, locked_until = ? WHERE login = ?").run(failed >= LOCK_AFTER ? 0 : failed, failed >= LOCK_AFTER ? this.now() + LOCK_MS : 0, login);
      return { ok: false, message: failed >= LOCK_AFTER ? "This login is locked after too many failed attempts. Try again in 15 minutes." : generic };
    }
    this.db.prepare("UPDATE pilot_users SET failed = 0, locked_until = 0 WHERE login = ?").run(login);
    return { ok: true, login };
  }

  // ---------- clients ----------

  registerClient(meta: unknown) {
    const m = (meta ?? {}) as { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown; grant_types?: unknown };
    const uris = Array.isArray(m.redirect_uris) ? m.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (!uris.length || uris.length > 5) throw new OAuthError("invalid_redirect_uri", "Give 1 to 5 redirect URIs.");
    for (const u of uris) if (!redirectUriAllowed(u) || u.length > 500) throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${u.slice(0, 80)}`);
    if (m.token_endpoint_auth_method && m.token_endpoint_auth_method !== "none") throw new OAuthError("invalid_client_metadata", "Only public clients with PKCE are supported (token_endpoint_auth_method none).");
    const name = typeof m.client_name === "string" ? m.client_name.slice(0, 80) : "MCP client";
    const clientId = `nxc_${randomBytes(16).toString("hex")}`;
    this.db.prepare("INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)").run(clientId, name, JSON.stringify(uris), new Date(this.now()).toISOString());
    return { client_id: clientId, client_name: name, redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
  }

  client(id: string) {
    const row = this.db.prepare("SELECT * FROM oauth_clients WHERE client_id = ?").get(id) as { client_id: string; name: string; redirect_uris: string } | undefined;
    return row ? { id: row.client_id, name: row.name, redirectUris: JSON.parse(row.redirect_uris) as string[] } : null;
  }

  // ---------- authorize ----------

  /** Validates an authorization request before any login form is shown. */
  validateAuthorize(q: URLSearchParams) {
    const client = this.client(q.get("client_id") ?? "");
    if (!client) throw new OAuthError("invalid_client", "Unknown client. Register it first.");
    const redirect = q.get("redirect_uri") ?? "";
    // Errors before the redirect URI is known to be safe are shown, never redirected.
    if (!client.redirectUris.includes(redirect)) throw new OAuthError("invalid_redirect_uri", "The redirect URI does not match the registered one.");
    if (q.get("response_type") !== "code") throw new OAuthError("invalid_request", "response_type must be code.");
    const challenge = q.get("code_challenge") ?? "";
    if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) throw new OAuthError("invalid_request", "PKCE with code_challenge_method S256 is required.");
    const resource = q.get("resource") ?? this.resource;
    if (resource !== this.resource) throw new OAuthError("invalid_target", "Tokens are issued only for this Nexus server.");
    const scope = this.scope(q.get("scope"));
    return { clientId: client.id, clientName: client.name, redirectUri: redirect, challenge, scope, resource, state: (q.get("state") ?? "").slice(0, 500) };
  }

  private scope(raw: string | null) {
    const asked = (raw ?? "nexus.investigate").split(" ").filter(Boolean);
    for (const s of asked) if (!(SCOPES as readonly string[]).includes(s)) throw new OAuthError("invalid_scope", `Unknown scope ${s}.`);
    return [...new Set(asked.length ? asked : ["nexus.investigate"])].join(" ");
  }

  issueCode(a: ReturnType<PilotAuth["validateAuthorize"]>, login: string) {
    const code = token();
    this.db
      .prepare("INSERT INTO oauth_codes (code_hash, client_id, login, redirect_uri, challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(sha(code), a.clientId, login, a.redirectUri, a.challenge, a.scope, a.resource, this.now() + CODE_TTL_MS);
    return code;
  }

  // ---------- token ----------

  exchange(form: URLSearchParams) {
    const grant = form.get("grant_type");
    if (grant === "authorization_code") return this.fromCode(form);
    if (grant === "refresh_token") return this.fromRefresh(form);
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  private fromCode(form: URLSearchParams) {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    const row = this.db.prepare("SELECT * FROM oauth_codes WHERE code_hash = ?").get(sha(code)) as
      | { client_id: string; login: string; redirect_uri: string; challenge: string; scope: string; resource: string; expires_at: number; used: number }
      | undefined;
    if (!row) throw new OAuthError("invalid_grant", "Unknown code.");
    if (row.used) {
      // A replayed code: revoke anything it produced.
      this.db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE family = ?").run(sha(code));
      throw new OAuthError("invalid_grant", "This code was already used.");
    }
    this.db.prepare("UPDATE oauth_codes SET used = 1 WHERE code_hash = ?").run(sha(code));
    if (row.expires_at < this.now()) throw new OAuthError("invalid_grant", "The code has expired.");
    if (row.client_id !== form.get("client_id")) throw new OAuthError("invalid_grant", "The code was issued to another client.");
    if (row.redirect_uri !== form.get("redirect_uri")) throw new OAuthError("invalid_grant", "The redirect URI does not match.");
    if ((form.get("resource") ?? row.resource) !== this.resource) throw new OAuthError("invalid_target", "Tokens are issued only for this Nexus server.");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new OAuthError("invalid_grant", "A PKCE code_verifier is required.");
    const expected = Buffer.from(row.challenge);
    const got = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new OAuthError("invalid_grant", "The PKCE code_verifier does not match.");
    return this.mint(sha(code), row.client_id, row.login, row.scope);
  }

  private fromRefresh(form: URLSearchParams) {
    const rt = form.get("refresh_token") ?? "";
    const row = this.db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(sha(rt)) as
      | { family: string; client_id: string; login: string; scope: string; expires_at: number; revoked: number }
      | undefined;
    if (!row) throw new OAuthError("invalid_grant", "Unknown refresh token.");
    if (row.revoked) {
      // Reuse of a rotated refresh token: someone else may hold it. Revoke the family.
      this.db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE family = ?").run(row.family);
      throw new OAuthError("invalid_grant", "This refresh token was already used. Sign in again.");
    }
    if (row.expires_at < this.now()) throw new OAuthError("invalid_grant", "The refresh token has expired. Sign in again.");
    if (row.client_id !== form.get("client_id")) throw new OAuthError("invalid_grant", "The refresh token belongs to another client.");
    this.db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?").run(sha(rt));
    const scope = form.get("scope") ? this.scope(form.get("scope")) : row.scope;
    if (!scope.split(" ").every((s) => row.scope.split(" ").includes(s))) throw new OAuthError("invalid_scope", "A refresh cannot widen the scope.");
    return this.mint(row.family, row.client_id, row.login, scope);
  }

  private mint(family: string, clientId: string, login: string, scope: string) {
    const access = token();
    const refresh = token();
    const ins = this.db.prepare("INSERT INTO oauth_tokens (token_hash, kind, family, client_id, login, scope, audience, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    ins.run(sha(access), "access", family, clientId, login, scope, this.resource, this.now() + ACCESS_TTL_MS);
    ins.run(sha(refresh), "refresh", family, clientId, login, scope, this.resource, this.now() + REFRESH_TTL_MS);
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope };
  }

  /** Checked on every call: known, unrevoked, unexpired, and for this server's audience. */
  verifyAccess(raw: string): Principal | null {
    const row = this.db.prepare("SELECT t.*, u.company_id, u.label FROM oauth_tokens t JOIN pilot_users u ON u.login = t.login WHERE t.token_hash = ? AND t.kind = 'access'").get(sha(raw)) as
      | { login: string; scope: string; audience: string; expires_at: number; revoked: number; company_id: string; label: string; client_id: string }
      | undefined;
    if (!row || row.revoked || row.expires_at <= this.now() || row.audience !== this.resource) return null;
    return { sub: row.login, label: row.label, companyId: row.company_id, scopes: row.scope.split(" "), expiresAt: row.expires_at, clientId: row.client_id, source: "pilot" };
  }

  revokeLogin(login: string) {
    this.db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE login = ?").run(normaliseLoginId(login));
  }
}
