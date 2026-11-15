// The Nexus MCP server over streamable HTTP, for an install inside the
// customer's network. Same tools as stdio mode (createIdeMcpServer).
//
// Authorization follows the MCP specification: this server is an OAuth 2.1
// resource server. It publishes protected-resource metadata, answers 401 with
// a WWW-Authenticate challenge, and accepts only bearer tokens whose audience
// is this server. Tokens come from the company's identity provider (OIDC), or
// from the built-in pilot sign-in (username and password) until one is set up.
import { randomBytes, randomUUID } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createJwksVerifier, TokenError, type OidcConfig } from "../../src/ide/http/jwt";
import { OAuthError, PilotAuth, SCOPES, type Principal } from "../../src/ide/http/pilot-auth";
import type { IdeDeps } from "../../src/ide/machine";
import { LIMITS } from "../../src/ide/requests";
import { createDemoSandbox } from "../../src/ide/sandbox-demo";
import { IdeStore, type Caller } from "../../src/ide/store";
import { catalogUrlFromEnv } from "../../src/lib/catalog-client";
import { createIdeMcpServer } from "./ide-server";

export type HttpConfig = {
  /** Public base URL clients use, e.g. https://nexus.acme.internal. The MCP endpoint is <publicUrl>/mcp. */
  publicUrl: string;
  /** Built-in username and password sign-in, for pilots. */
  pilot: boolean;
  /** The company's identity provider. */
  oidc?: Omit<OidcConfig, "audience"> & { audience?: string };
  /** Requests per user per 5 minutes on /mcp. */
  rateLimit?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
};

type Session = { transport: StreamableHTTPServerTransport; principal: Principal; lastSeen: number };

const SESSION_IDLE_MS = 30 * 60_000;
const MAX_BODY = LIMITS.maxSubmissionBytes + 256 * 1024;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...headers,
  });
  res.end(text);
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("too_large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const ipOf = (req: IncomingMessage) => req.socket.remoteAddress ?? "unknown";

function loginPage(a: { clientName: string; scope: string; id: string; csrf: string; error?: string }) {
  const approve = a.scope.split(" ").includes("nexus.approve");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in to Nexus</title>
<style>
:root{--bg:#0b1020;--panel:#121a33;--text:#e7ecf7;--muted:#9aa6c4;--action:#2f6bff;--coral:#ff7a6b;--line:#24304f}
@media (prefers-color-scheme: light){:root{--bg:#f4f6fb;--panel:#fff;--text:#121a33;--muted:#4b5675;--line:#d5dbea}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;padding:16px}
main{width:100%;max-width:380px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:0 0 16px}label{display:block;margin:12px 0 4px;font-weight:600}
input{width:100%;padding:10px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--text);font:inherit}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--action);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--coral);margin-top:12px}.note{font-size:13px;margin-top:16px}
</style></head><body><main>
<h1>Sign in to Nexus</h1>
<p>${esc(a.clientName)} is asking to ${approve ? "investigate defects and send your fix approvals" : "investigate defects"} as you.</p>
<form method="post" action="/authorize" autocomplete="on">
<input type="hidden" name="request" value="${esc(a.id)}"><input type="hidden" name="csrf" value="${esc(a.csrf)}">
<label for="login">Login</label><input id="login" name="login" required maxlength="120" autocomplete="username">
<label for="password">Password</label><input id="password" name="password" type="password" required maxlength="256" autocomplete="current-password">
${a.error ? `<p class="err" role="alert">⚠ ${esc(a.error)}</p>` : ""}
<button type="submit">Sign in</button>
</form>
<p class="note">Nexus is read-only toward your repository and tools. This sign-in is only for Nexus itself.</p>
</main></body></html>`;
}

export function createIdeHttpServer(config: HttpConfig, deps: IdeDeps) {
  const now = config.now ?? (() => Date.now());
  const base = config.publicUrl.replace(/\/$/, "");
  const publicHost = new URL(base).host;
  const resource = `${base}/mcp`;
  const pilot = config.pilot ? new PilotAuth(deps.store.db, resource, now) : null;
  const verifyJwt = config.oidc ? createJwksVerifier({ ...config.oidc, audience: config.oidc.audience ?? resource }, config.fetchImpl, now) : null;
  const sessions = new Map<string, Session>();
  const pending = new Map<string, { a: ReturnType<PilotAuth["validateAuthorize"]>; csrf: string; expires: number }>();
  const hits = new Map<string, number[]>();
  const limit = config.rateLimit ?? 300;
  const prmUrl = `${base}/.well-known/oauth-protected-resource`;
  const challenge = (error?: string, scope?: string) =>
    `Bearer resource_metadata="${prmUrl}"${scope ? `, scope="${scope}"` : ""}${error ? `, error="${error}"` : ""}`;

  async function authenticate(req: IncomingMessage): Promise<Principal | null> {
    const h = req.headers.authorization ?? "";
    const m = h.match(/^Bearer\s+([A-Za-z0-9._~+/=-]{16,4096})$/);
    if (!m) return null;
    const pilotHit = pilot?.verifyAccess(m[1]);
    if (pilotHit) return pilotHit;
    if (verifyJwt && m[1].split(".").length === 3) {
      try {
        const v = await verifyJwt(m[1]);
        return { ...v, source: "oidc" };
      } catch (error) {
        if (!(error instanceof TokenError)) throw error;
        return null;
      }
    }
    return null;
  }

  const callerOf = (p: Principal): Caller => ({ companyId: p.companyId, engineerId: `${p.source}:${p.sub}`, engineerLabel: p.label });
  const samePrincipal = (a: Principal, b: Principal) => a.source === b.source && a.sub === b.sub && a.companyId === b.companyId;

  function rateLimited(p: Principal) {
    const key = `${p.source}:${p.sub}`;
    const t = now();
    const list = (hits.get(key) ?? []).filter((x) => t - x < 5 * 60_000);
    list.push(t);
    hits.set(key, list);
    return list.length > limit;
  }

  function sweep() {
    const t = now();
    for (const [id, s] of sessions) if (t - s.lastSeen > SESSION_IDLE_MS) {
      void s.transport.close();
      sessions.delete(id);
    }
    for (const [id, p] of pending) if (p.expires < t) pending.delete(id);
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse) {
    const principal = await authenticate(req);
    if (!principal) return send(res, 401, { error: "Sign in to Nexus to use this server." }, { "www-authenticate": challenge(req.headers.authorization ? "invalid_token" : undefined, "nexus.investigate") });
    if (!principal.scopes.includes("nexus.investigate")) return send(res, 403, { error: "The token lacks the nexus.investigate scope." }, { "www-authenticate": challenge("insufficient_scope", "nexus.investigate") });
    if (rateLimited(principal)) return send(res, 429, { error: "Too many requests. Slow down and try again in a few minutes." }, { "retry-after": "60" });
    const sid = req.headers["mcp-session-id"];
    let body: unknown;
    if (req.method === "POST") {
      try {
        body = JSON.parse(await readBody(req, MAX_BODY));
      } catch (error) {
        return send(res, error instanceof Error && error.message === "too_large" ? 413 : 400, { error: error instanceof Error && error.message === "too_large" ? "The request is too large." : "The body is not JSON." });
      }
    }
    if (typeof sid === "string") {
      const s = sessions.get(sid);
      if (!s) return send(res, 404, { error: "Unknown or expired session. Start a new one." });
      // A session belongs to the engineer who opened it.
      if (!samePrincipal(s.principal, principal)) return send(res, 403, { error: "This session belongs to someone else." });
      s.principal = principal;
      s.lastSeen = now();
      return s.transport.handleRequest(req, res, body);
    }
    if (req.method !== "POST" || !isInitializeRequest(body)) return send(res, 400, { error: "Start a session with an initialize request." });
    const holder: { session: Session | null } = { session: null };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        holder.session = { transport, principal, lastSeen: now() };
        sessions.set(id, holder.session);
      },
      onsessionclosed: (id) => void sessions.delete(id),
    });
    const current = () => holder.session?.principal ?? principal;
    const server = createIdeMcpServer(deps, () => callerOf(current()), {
      approvalDenied: () => (current().scopes.includes("nexus.approve") ? null : "Approving needs the nexus.approve scope, which only the Nexus extension's sign-in asks for."),
    });
    await server.connect(transport);
    return transport.handleRequest(req, res, body);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Liveness for container health checks: no data, any host name.
    if (req.url === "/health") return send(res, 200, { ok: true });
    // Everything else answers only for the configured host name (DNS rebinding protection).
    if (req.headers.host !== publicHost) return send(res, 421, { error: "Wrong host." });
    const url = new URL(req.url ?? "/", base);
    sweep();
    if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return send(res, 200, {
        resource,
        authorization_servers: [...(pilot ? [base] : []), ...(config.oidc ? [config.oidc.issuer] : [])],
        scopes_supported: [...SCOPES],
        bearer_methods_supported: ["header"],
        resource_name: "Nexus",
      });
    }
    if (url.pathname === "/mcp") return handleMcp(req, res);
    if (!pilot) return send(res, 404, { error: "Not found." });

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return send(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: [...SCOPES],
      });
    }
    try {
      if (url.pathname === "/register" && req.method === "POST") {
        let meta: unknown;
        try {
          meta = JSON.parse(await readBody(req, 16 * 1024));
        } catch {
          throw new OAuthError("invalid_client_metadata", "The body is not JSON.");
        }
        return send(res, 201, pilot.registerClient(meta));
      }
      if (url.pathname === "/authorize" && req.method === "GET") {
        let a;
        try {
          a = pilot.validateAuthorize(url.searchParams);
        } catch (error) {
          if (error instanceof OAuthError) return send(res, 400, `<!doctype html><title>Nexus sign-in</title><p>${esc(error.message)}</p>`);
          throw error;
        }
        const id = randomBytes(16).toString("hex");
        const csrf = randomBytes(16).toString("hex");
        pending.set(id, { a, csrf, expires: now() + 10 * 60_000 });
        return send(res, 200, loginPage({ clientName: a.clientName, scope: a.scope, id, csrf }), pageHeaders(a.redirectUri));
      }
      if (url.pathname === "/authorize" && req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && origin !== base) return send(res, 403, "<!doctype html><title>Nexus sign-in</title><p>Sign in from the Nexus page.</p>");
        const form = new URLSearchParams(await readBody(req, 8 * 1024));
        const p = pending.get(form.get("request") ?? "");
        if (!p || p.csrf !== form.get("csrf")) return send(res, 400, "<!doctype html><title>Nexus sign-in</title><p>This sign-in page has expired. Start again from your editor.</p>");
        const r = await pilot.checkPassword(form.get("login") ?? "", form.get("password") ?? "", ipOf(req));
        if (!r.ok) return send(res, 401, loginPage({ clientName: p.a.clientName, scope: p.a.scope, id: form.get("request")!, csrf: p.csrf, error: r.message }), pageHeaders(p.a.redirectUri));
        pending.delete(form.get("request")!);
        const code = pilot.issueCode(p.a, r.login);
        const to = new URL(p.a.redirectUri);
        to.searchParams.set("code", code);
        if (p.a.state) to.searchParams.set("state", p.a.state);
        to.searchParams.set("iss", base);
        res.writeHead(302, { location: to.toString(), "cache-control": "no-store" });
        return res.end();
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const form = new URLSearchParams(await readBody(req, 8 * 1024));
        return send(res, 200, pilot.exchange(form), { pragma: "no-cache" });
      }
    } catch (error) {
      if (error instanceof OAuthError) return send(res, error.error === "invalid_client" ? 401 : 400, { error: error.error, error_description: error.message });
      if (error instanceof Error && error.message === "too_large") return send(res, 413, { error: "invalid_request", error_description: "Too large." });
      throw error;
    }
    return send(res, 404, { error: "Not found." });
  }

  function pageHeaders(redirectUri: string): Record<string, string> {
    let target = "";
    try {
      const u = new URL(redirectUri);
      target = u.protocol === "http:" || u.protocol === "https:" ? ` ${u.origin}` : ` ${u.protocol}`;
    } catch {
      target = "";
    }
    return { "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${target}; frame-ancestors 'none'; base-uri 'none'`, "x-frame-options": "DENY" };
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      if (!res.headersSent) send(res, 500, { error: "Nexus could not complete this request." });
      else res.end();
    });
  });
  return { server, pilot, sessions, resource };
}

// ---------- command line ----------

export function httpConfigFromEnv(env = process.env): HttpConfig & { host: string; port: number } {
  const port = Number(env.NEXUS_HTTP_PORT ?? 4320);
  const host = env.NEXUS_HTTP_HOST ?? "127.0.0.1";
  const publicUrl = env.NEXUS_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
  const u = new URL(publicUrl);
  if (u.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("NEXUS_PUBLIC_URL must use https unless it is a loopback address.");
  const oidc = env.NEXUS_OIDC_ISSUER
    ? {
        issuer: env.NEXUS_OIDC_ISSUER,
        jwksUrl: env.NEXUS_OIDC_JWKS_URL ?? `${env.NEXUS_OIDC_ISSUER.replace(/\/$/, "")}/.well-known/jwks.json`,
        audience: env.NEXUS_OIDC_AUDIENCE,
        companyId: env.NEXUS_OIDC_COMPANY,
        companyClaim: env.NEXUS_OIDC_COMPANY_CLAIM,
        algorithms: env.NEXUS_OIDC_ALGORITHMS?.split(",").map((s) => s.trim()).filter(Boolean),
      }
    : undefined;
  const pilot = env.NEXUS_PILOT_LOGIN === "1" || !oidc;
  return { publicUrl, host, port, pilot, oidc };
}

export async function startHttpFromEnv() {
  const cfg = httpConfigFromEnv();
  const root = process.env.NEXUS_PROJECT_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const deps: IdeDeps = {
    store: new IdeStore(),
    sandbox: process.env.NEXUS_IDE_DEMO === "1" ? createDemoSandbox({ catalogUrl: catalogUrlFromEnv(), projectRoot: root }) : null,
    approverClients: (process.env.NEXUS_APPROVER_CLIENTS ?? "nexus-vscode").split(",").map((s) => s.trim()).filter(Boolean),
  };
  const { server } = createIdeHttpServer(cfg, deps);
  server.listen(cfg.port, cfg.host, () => {
    console.error(`Nexus MCP (HTTP) on ${cfg.publicUrl}/mcp · sign-in: ${[cfg.pilot ? "pilot" : null, cfg.oidc ? `OIDC ${cfg.oidc.issuer}` : null].filter(Boolean).join(" + ")}`);
  });
}

// Run directly (tsx ide-http.ts) only; inside the bundled nexus-mcp command, cli.ts decides.
const isMain = Boolean(process.argv[1] && /ide-http\.ts$/.test(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isMain) {
  startHttpFromEnv().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
