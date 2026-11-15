// HTTP mode: OAuth 2.1 with PKCE (built-in pilot sign-in and the company's
// own identity provider), audience checks on every call, and isolation.
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import http from "node:http";
import test, { after } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createIdeHttpServer, type HttpConfig } from "../../services/mcp/ide-http.ts";
import { IDE_TOOL_NAMES } from "../../services/mcp/ide-server.ts";
import { runFixtureAgent } from "../../src/ide/fixture-agent.ts";
import { ACCESS_TTL_MS } from "../../src/ide/http/pilot-auth.ts";
import { deps, fixture, freePort, tempStore } from "./helpers.ts";

const servers: http.Server[] = [];
const clients: Client[] = [];
after(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => undefined)));
  for (const s of servers) {
    s.closeAllConnections();
    s.close();
  }
});

// Test-only values generated here; nothing real.
const PASSWORD = `Pilot-${randomBytes(9).toString("base64url")}`;

async function start(extra: Partial<HttpConfig> = {}, store = tempStore().store) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const clock = { t: Date.now() };
  const app = createIdeHttpServer({ publicUrl: base, pilot: true, now: () => clock.t, ...extra }, deps(store));
  await new Promise<void>((r) => app.server.listen(port, "127.0.0.1", () => r()));
  servers.push(app.server);
  return { ...app, base, clock, store };
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

async function register(base: string, redirect = "http://127.0.0.1:33418/callback") {
  const res = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Test IDE", redirect_uris: [redirect], token_endpoint_auth_method: "none" }) });
  assert.equal(res.status, 201);
  return (await res.json()) as { client_id: string };
}

async function authorize(base: string, o: { clientId: string; challenge: string; login: string; password: string; scope?: string; redirect?: string; method?: string; resource?: string }) {
  const redirect = o.redirect ?? "http://127.0.0.1:33418/callback";
  const q = new URLSearchParams({ response_type: "code", client_id: o.clientId, redirect_uri: redirect, code_challenge: o.challenge, code_challenge_method: o.method ?? "S256", scope: o.scope ?? "nexus.investigate", state: "xyz", resource: o.resource ?? `${base}/mcp` });
  const page = await fetch(`${base}/authorize?${q}`);
  if (page.status !== 200) return { status: page.status, html: await page.text() };
  const html = await page.text();
  const request = html.match(/name="request" value="([^"]+)"/)![1];
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  const post = await fetch(`${base}/authorize`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin: base }, body: new URLSearchParams({ request, csrf, login: o.login, password: o.password }) });
  const location = post.headers.get("location");
  return { status: post.status, html: post.status === 302 ? "" : await post.text(), code: location ? new URL(location).searchParams.get("code") : null, location, csp: page.headers.get("content-security-policy") };
}

async function token(base: string, form: Record<string, string>) {
  const res = await fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

async function signIn(base: string, login: string, scope = "nexus.investigate") {
  const { client_id } = await register(base);
  const p = pkce();
  const a = await authorize(base, { clientId: client_id, challenge: p.challenge, login, password: PASSWORD, scope });
  assert.equal(a.status, 302, a.html);
  const t = await token(base, { grant_type: "authorization_code", code: a.code!, code_verifier: p.verifier, client_id, redirect_uri: "http://127.0.0.1:33418/callback", resource: `${base}/mcp` });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return { ...t.body, client_id };
}

async function mcp(base: string, accessToken: string, name = "test-agent") {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } });
  const client = new Client({ name, version: "1" });
  await client.connect(transport);
  clients.push(client);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name: tool, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const v = JSON.parse(res.content[0].text);
    return res.isError ? { __error: true, ...v } : v;
  };
  return { client, transport, call };
}

const rawMcp = (base: string, accessToken: string | null, headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

// ---------- discovery ----------

test("unauthenticated calls get 401 with the MCP challenge; metadata describes this resource and its sign-in", async () => {
  const s = await start();
  const res = await rawMcp(s.base, null);
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", new RegExp(`Bearer resource_metadata="${s.base}/.well-known/oauth-protected-resource"`));
  const prm = await (await fetch(`${s.base}/.well-known/oauth-protected-resource`)).json();
  assert.equal(prm.resource, `${s.base}/mcp`);
  assert.deepEqual(prm.authorization_servers, [s.base]);
  const as = await (await fetch(`${s.base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
  // fetch cannot override Host, so send this one with http.request.
  const u = new URL(s.base);
  const status = await new Promise<number>((resolve, reject) => {
    const r = http.request({ host: u.hostname, port: u.port, path: "/.well-known/oauth-protected-resource", headers: { host: "evil.example.com" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on("error", reject);
    r.end();
  });
  assert.equal(status, 421, "requests for another host name are refused");
});

// ---------- the pilot flow ----------

test("pilot sign-in: authorization code with PKCE gives a token that runs an investigation over HTTP", { timeout: 60_000 }, async () => {
  const s = await start();
  await s.pilot!.addUser({ login: "sam@acme.test", companyId: "acme", label: "Sam", password: PASSWORD });
  const t = await signIn(s.base, "sam@acme.test");
  assert.equal(t.token_type, "Bearer");
  assert.equal(Number(t.expires_in), ACCESS_TTL_MS / 1000);
  const { client, call } = await mcp(s.base, t.access_token);
  assert.deepEqual((await client.listTools()).tools.map((x) => x.name).sort(), [...IDE_TOOL_NAMES].sort());
  const { final } = await runFixtureAgent(call, fixture("pay-1423.json"));
  assert.equal((final as { report: { verdict: string } }).report.verdict, "not_enough_evidence");
  const audit = s.store.auditFor({ companyId: "acme", engineerId: "pilot:sam@acme.test", engineerLabel: "Sam" });
  assert.ok(audit.length > 0 && audit.every((a) => a.engineer_id === "pilot:sam@acme.test"));
  // Tokens are stored only as hashes.
  assert.equal(JSON.stringify(s.store.db.prepare("SELECT * FROM oauth_tokens").all()).includes(t.access_token), false);
  await client.close();
});

test("PKCE and code rules: S256 only, verifier must match, codes are single-use and bound to client, redirect and resource", async () => {
  const s = await start();
  await s.pilot!.addUser({ login: "sam@acme.test", companyId: "acme", password: PASSWORD });
  const { client_id } = await register(s.base);
  const p = pkce();
  const plain = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "sam@acme.test", password: PASSWORD, method: "plain" });
  assert.equal(plain.status, 400);
  const otherResource = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "sam@acme.test", password: PASSWORD, resource: "https://other.example.com/mcp" });
  assert.equal(otherResource.status, 400);
  const badRedirect = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "sam@acme.test", password: PASSWORD, redirect: "http://127.0.0.1:9/other" });
  assert.equal(badRedirect.status, 400);
  assert.equal(badRedirect.location, undefined, "an unregistered redirect URI is never redirected to");

  const a = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "sam@acme.test", password: PASSWORD });
  assert.match(a.csp ?? "", /frame-ancestors 'none'/);
  const base = { grant_type: "authorization_code", code: a.code!, client_id, redirect_uri: "http://127.0.0.1:33418/callback" };
  assert.equal((await token(s.base, { ...base, code_verifier: pkce().verifier })).body.error, "invalid_grant", "wrong verifier");
  // The failed attempt burned the code: single use.
  assert.equal((await token(s.base, { ...base, code_verifier: p.verifier })).body.error, "invalid_grant");

  const b = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "sam@acme.test", password: PASSWORD });
  assert.equal((await token(s.base, { grant_type: "authorization_code", code: b.code!, client_id, redirect_uri: "http://127.0.0.1:1/x", code_verifier: p.verifier })).body.error, "invalid_grant", "redirect must match");
  const c = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "sam@acme.test", password: PASSWORD });
  assert.equal((await token(s.base, { grant_type: "authorization_code", code: c.code!, client_id, redirect_uri: "http://127.0.0.1:33418/callback", code_verifier: p.verifier, resource: "https://other.example.com/mcp" })).body.error, "invalid_target");
  for (const bad of ["javascript:alert(1)", "http://evil.example.com/cb", "file:///etc/passwd"]) {
    const r = await fetch(`${s.base}/register`, { method: "POST", body: JSON.stringify({ redirect_uris: [bad] }) });
    assert.equal(r.status, 400, bad);
  }
});

test("lockout: five wrong passwords lock the login, even against the right password", async () => {
  const s = await start();
  await s.pilot!.addUser({ login: "ann@acme.test", companyId: "acme", password: PASSWORD });
  const { client_id } = await register(s.base);
  const p = pkce();
  for (let i = 0; i < 5; i += 1) {
    const r = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "ann@acme.test", password: `wrong-${i}-password` });
    assert.equal(r.status, 401);
  }
  const locked = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "ann@acme.test", password: PASSWORD });
  assert.equal(locked.status, 401);
  assert.match(locked.html, /locked/);
  s.clock.t += 16 * 60_000;
  const later = await authorize(s.base, { clientId: client_id, challenge: p.challenge, login: "ann@acme.test", password: PASSWORD });
  assert.equal(later.status, 302);
  const stored = s.store.db.prepare("SELECT password_hash FROM pilot_users").get() as { password_hash: string };
  assert.match(stored.password_hash, /^\$argon2id\$/);
});

test("tokens are short-lived, bound to this server's audience, and refresh tokens rotate with reuse detection", async () => {
  const { store } = tempStore();
  const s = await start({}, store);
  await s.pilot!.addUser({ login: "sam@acme.test", companyId: "acme", password: PASSWORD });
  const t = await signIn(s.base, "sam@acme.test");
  assert.equal((await rawMcp(s.base, t.access_token)).status, 400, "authenticated (no session yet), not 401");

  // The same database behind another Nexus server: the token is not for it.
  const other = await start({}, store);
  const res = await rawMcp(other.base, t.access_token);
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /invalid_token/);

  const r1 = await token(s.base, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refresh_token, t.refresh_token);
  assert.equal((await token(s.base, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, scope: "nexus.investigate nexus.approve" })).body.error, "invalid_grant", "an old refresh token is refused");
  assert.equal((await rawMcp(s.base, r1.body.access_token)).status, 401, "reuse of a rotated refresh token revokes the family");

  const t2 = await signIn(s.base, "sam@acme.test");
  s.clock.t += ACCESS_TTL_MS + 1000;
  assert.equal((await rawMcp(s.base, t2.access_token)).status, 401, "expired after 10 minutes");
});

test("approval over HTTP needs the nexus.approve scope, which an ordinary sign-in does not carry", { timeout: 30_000 }, async () => {
  const s = await start();
  await s.pilot!.addUser({ login: "sam@acme.test", companyId: "acme", password: PASSWORD });
  const t = await signIn(s.base, "sam@acme.test");
  const { call } = await mcp(s.base, t.access_token, "nexus-vscode");
  const started = await call("nexus_start_investigation", { ticketRef: "PAY-1423" });
  const res = await call("nexus_approve", { investigationId: started.investigationId, confirmation: "APPLY_SANDBOX_REMEDIATION" });
  assert.equal(res.__error, true);
  assert.match(res.error, /nexus\.approve scope/);
});

test("isolation over HTTP: another company's engineer cannot read the investigation or use the session", { timeout: 30_000 }, async () => {
  const s = await start();
  await s.pilot!.addUser({ login: "sam@acme.test", companyId: "acme", password: PASSWORD });
  await s.pilot!.addUser({ login: "eve@globex.test", companyId: "globex", password: PASSWORD });
  const sam = await mcp(s.base, (await signIn(s.base, "sam@acme.test")).access_token);
  const eveToken = (await signIn(s.base, "eve@globex.test")).access_token;
  const eve = await mcp(s.base, eveToken);
  const started = await sam.call("nexus_start_investigation", { ticketRef: "PAY-1423" });
  const read = await eve.call("nexus_get_report", { investigationId: started.investigationId });
  assert.equal(read.code, "not_found");
  // Eve's token on Sam's session id is refused.
  const hijack = await rawMcp(s.base, eveToken, { "mcp-session-id": sam.transport.sessionId! });
  assert.equal(hijack.status, 403);
});

test("rate limit per user", { timeout: 30_000 }, async () => {
  const s = await start({ rateLimit: 3 });
  await s.pilot!.addUser({ login: "sam@acme.test", companyId: "acme", password: PASSWORD });
  const t = await signIn(s.base, "sam@acme.test");
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await rawMcp(s.base, t.access_token)).status);
  assert.deepEqual(statuses, [400, 400, 400, 429]);
});

// ---------- the company's identity provider ----------

test("company IdP tokens: signature, issuer, audience, expiry and algorithm are checked on every call", { timeout: 30_000 }, async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const jwksPort = await freePort();
  const jwks = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((r) => jwks.listen(jwksPort, "127.0.0.1", () => r()));
  servers.push(jwks);
  const issuer = "https://login.acme.test";
  const s = await start({ pilot: false, oidc: { issuer, jwksUrl: `http://127.0.0.1:${jwksPort}/jwks`, companyId: "acme" } });
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const sign = (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1", typ: "JWT" }) => {
    const data = `${b64(header)}.${b64(claims)}`;
    return `${data}.${createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url")}`;
  };
  const t = Math.floor(Date.now() / 1000);
  const good = { iss: issuer, aud: `${s.base}/mcp`, sub: "u-123", email: "sam@acme.test", scope: "nexus.investigate", exp: t + 300, iat: t };
  const prm = await (await fetch(`${s.base}/.well-known/oauth-protected-resource`)).json();
  assert.deepEqual(prm.authorization_servers, [issuer]);
  assert.equal((await fetch(`${s.base}/authorize`)).status, 404, "no built-in sign-in when the company IdP is configured");

  const { call } = await mcp(s.base, sign(good));
  const started = await call("nexus_start_investigation", { ticketRef: "PAY-1423" });
  assert.equal(started.status, "needs_evidence");
  const rejects: [string, string][] = [
    ["wrong audience", sign({ ...good, aud: "https://other.example.com/mcp" })],
    ["wrong issuer", sign({ ...good, iss: "https://evil.example.com" })],
    ["expired", sign({ ...good, exp: t - 3600 })],
    ["no scope", sign({ ...good, scope: "openid" })],
    ["alg none", `${b64({ alg: "none" })}.${b64(good)}.`],
    ["tampered", (() => { const [h, , sg] = sign(good).split("."); return `${h}.${b64({ ...good, sub: "admin" })}.${sg}`; })()],
  ];
  for (const [why, tok] of rejects) {
    const r = await rawMcp(s.base, tok);
    assert.ok(r.status === 401 || r.status === 403, `${why}: got ${r.status}`);
  }
});
