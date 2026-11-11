import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { runtimePassword, useTempAdminEnv } from "./helpers.ts";

import { adminCount, createAdmin, findAdmin, LOCK_AFTER, NEUTRAL_FAIL, requireAdminApi, resetRateLimitsForTests, signIn } from "../../src/nexus-admin/server/auth.ts";
import { decryptSecret, encryptSecret } from "../../src/nexus-admin/server/crypto.ts";
import { getDb, resetDbForTests } from "../../src/nexus-admin/server/db.ts";
import { passwordProblems } from "../../src/nexus-admin/server/passwords.ts";
import { redactText, redactValue } from "../../src/nexus-admin/server/redact.ts";
import { base32Encode, totpCode, verifyTotp } from "../../src/nexus-admin/server/totp.ts";

// Settings are read lazily, so this runs before any database or key is used.
const env = useTempAdminEnv("auth");

const OWNER = "Hima Bindu";
const ownerPassword = runtimePassword();

test.after(() => resetDbForTests());

test("no admin exists until admin:create runs", () => {
  assert.equal(adminCount(), 0);
});

test("weak passwords are refused with plain reasons", () => {
  assert.match(passwordProblems("short", OWNER).join(" "), /at least 12/);
  assert.match(passwordProblems("hima bindu", OWNER).join(" "), /login ID/);
  assert.match(passwordProblems("HimaBindu", "Hima Bindu").join(" "), /login ID|12/);
  assert.match(passwordProblems("password123", OWNER).join(" "), /common|12/);
  assert.deepEqual(passwordProblems(ownerPassword, OWNER), []);
});

test("owner account stores only an Argon2id hash", async () => {
  await createAdmin(OWNER, ownerPassword);
  const row = findAdmin(OWNER)!;
  assert.match(row.password_hash, /^\$argon2id\$/);
  getDb().pragma("wal_checkpoint(TRUNCATE)");
  const bytes = fs.readFileSync(env.dbFile).toString("latin1");
  assert.ok(!bytes.includes(ownerPassword), "plain password found in the database file");
});

test("login ID matches case-insensitively and ignores extra spaces", async () => {
  resetRateLimitsForTests();
  const result = await signIn({ loginId: "  hima   BINDU ", password: ownerPassword, ip: "10.0.0.1" });
  assert.equal(result.ok, true);
});

test("unknown user and wrong password get the same neutral message", async () => {
  resetRateLimitsForTests();
  const unknown = await signIn({ loginId: "nobody", password: "x".repeat(14), ip: "10.0.0.2" });
  const wrong = await signIn({ loginId: OWNER, password: "y".repeat(14), ip: "10.0.0.2" });
  assert.equal(unknown.ok, false);
  assert.equal(wrong.ok, false);
  if (!unknown.ok && !wrong.ok) {
    assert.equal(unknown.message, NEUTRAL_FAIL);
    assert.equal(wrong.message, NEUTRAL_FAIL);
  }
});

test("repeated failures lock the account, even for the right password", async () => {
  resetRateLimitsForTests();
  getDb().prepare("UPDATE nexus_admins SET failed_count = 0, locked_until = NULL").run();
  for (let i = 0; i < LOCK_AFTER; i += 1) {
    await signIn({ loginId: OWNER, password: `wrong-${i}-xxxxxxxx`, ip: `10.0.1.${i}` });
  }
  assert.ok(findAdmin(OWNER)!.locked_until, "account should be locked");
  const right = await signIn({ loginId: OWNER, password: ownerPassword, ip: "10.0.2.1" });
  assert.equal(right.ok, false);
  getDb().prepare("UPDATE nexus_admins SET failed_count = 0, locked_until = NULL").run();
});

test("sign-in attempts are rate limited per IP", async () => {
  resetRateLimitsForTests();
  let last: Awaited<ReturnType<typeof signIn>> | null = null;
  for (let i = 0; i < 25; i += 1) last = await signIn({ loginId: `someone${i}`, password: "z".repeat(14), ip: "10.9.9.9" });
  assert.equal(last!.ok, false);
  if (last && !last.ok) assert.equal(last.status, 429);
  resetRateLimitsForTests();
});

test("audit log records sign-ins and refuses edits and deletes", () => {
  const db = getDb();
  const actions = (db.prepare("SELECT action FROM audit_log").all() as { action: string }[]).map((r) => r.action);
  assert.ok(actions.includes("auth.sign_in"));
  assert.ok(actions.includes("auth.sign_in_failed"));
  assert.ok(actions.includes("auth.account_locked"));
  assert.throws(() => db.prepare("UPDATE audit_log SET action = 'x'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM audit_log").run(), /append-only/);
});

test("admin API guard rejects missing sessions and missing CSRF tokens", async () => {
  resetRateLimitsForTests();
  const none = requireAdminApi(new Request("http://localhost/api/nexus-admin/companies"));
  assert.ok(none instanceof Response);
  assert.equal((none as Response).status, 401);

  const login = await signIn({ loginId: OWNER, password: ownerPassword, ip: "10.0.3.1" });
  assert.ok(login.ok);
  if (!login.ok) return;
  const cookie = `nexus_admin_session=${login.token}`;
  const ok = requireAdminApi(new Request("http://localhost/api/nexus-admin/companies", { headers: { cookie } }));
  assert.ok(!(ok instanceof Response));
  const noCsrf = requireAdminApi(
    new Request("http://localhost/api/nexus-admin/companies", { method: "POST", headers: { cookie, origin: "http://localhost", host: "localhost" } }),
  );
  assert.equal((noCsrf as Response).status, 403);
  const crossSite = requireAdminApi(
    new Request("http://localhost/api/nexus-admin/companies", { method: "POST", headers: { cookie, origin: "https://evil.example", host: "localhost", "x-csrf-token": login.csrf } }),
  );
  assert.equal((crossSite as Response).status, 403);
  const good = requireAdminApi(
    new Request("http://localhost/api/nexus-admin/companies", { method: "POST", headers: { cookie, origin: "http://localhost", host: "localhost", "x-csrf-token": login.csrf } }),
  );
  assert.ok(!(good instanceof Response));
});

test("secrets round-trip with AES-256-GCM and are bound to their row", () => {
  const secret = `ghp_${"a".repeat(36)}`;
  const { blob } = encryptSecret(secret, "company:1:connection:code");
  assert.ok(!blob.includes(secret));
  assert.equal(decryptSecret(blob, "company:1:connection:code"), secret);
  assert.throws(() => decryptSecret(blob, "company:2:connection:code"));
});

test("TOTP matches the RFC 6238 test vector", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpCode(secret, 1), "287082");
  assert.ok(verifyTotp(secret, "287082", 59_000));
  assert.ok(!verifyTotp(secret, "000000", 59_000));
});

test("redaction removes tokens, URL credentials and secret-named fields", () => {
  const text = redactText("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 and postgres://u:hunter22@db:5432/x and Bearer abc.def.ghi123");
  assert.doesNotMatch(text, /ghp_ABC|hunter22|abc\.def/);
  const value = redactValue({ password: "p", nested: { apiToken: "t", ok: "fine" } }) as Record<string, unknown>;
  assert.equal(value.password, "[redacted]");
  assert.deepEqual(value.nested, { apiToken: "[redacted]", ok: "fine" });
});
