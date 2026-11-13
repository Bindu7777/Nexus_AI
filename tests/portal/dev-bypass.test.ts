import assert from "node:assert/strict";
import test from "node:test";
import { runtimePassword, setupTempAdminEnv } from "../nexus-admin/helpers.ts";

import { adminFromCookieHeader, createAdmin } from "../../src/nexus-admin/server/auth.ts";
import { createCompany } from "../../src/nexus-admin/server/companies.ts";
import { getDb, resetDbForTests } from "../../src/nexus-admin/server/db.ts";
import { devBypassEnabled } from "../../src/nexus-admin/server/dev-bypass.ts";
import { hashPassword } from "../../src/nexus-admin/server/passwords.ts";
import { PORTAL_COOKIE, portalFromCookieHeader, requirePortalApi, resetPortalRateLimitsForTests, signInEmployee } from "../../src/portal/server/auth.ts";

setupTempAdminEnv("dev-bypass");
const original = { flag: process.env.NEXUS_DEV_BYPASS_LOGIN, env: process.env.NODE_ENV, user: process.env.NEXUS_DEV_PORTAL_USER };
const env = process.env as Record<string, string | undefined>;
function set(flag: string | undefined, nodeEnv: string | undefined) {
  if (flag === undefined) delete env.NEXUS_DEV_BYPASS_LOGIN;
  else env.NEXUS_DEV_BYPASS_LOGIN = flag;
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
}
test.after(() => {
  set(original.flag, original.env);
  if (original.user === undefined) delete env.NEXUS_DEV_PORTAL_USER;
  else env.NEXUS_DEV_PORTAL_USER = original.user;
  resetDbForTests();
});

async function seed() {
  await createAdmin("Hima Bindu", runtimePassword());
  const cid = createCompany({ name: "Dev Co", short_code: "DEV", contact_name: "C", contact_email: "c@example.invalid", country: "IN", region: "", deployment_mode: "customer", notes: "" }, { type: "nexus_admin", id: 1, label: "x" }, "127.0.0.1");
  getDb().prepare("UPDATE companies SET status = 'active' WHERE id = ?").run(cid);
  const pw = runtimePassword();
  for (const id of ["221272", "221273"]) {
    getDb().prepare("INSERT INTO company_users (company_id, role, login_id, display_name, password_hash, must_change_password, created_at) VALUES (?, 'employee', ?, 'P', ?, 1, ?)").run(cid, id, await hashPassword(pw), new Date().toISOString());
  }
  return pw;
}

test("the bypass is off by default and in production, even with the flag set", async () => {
  await seed();
  set(undefined, "development");
  assert.equal(devBypassEnabled(), false);
  assert.equal(adminFromCookieHeader(null), null);
  assert.equal(portalFromCookieHeader(null), null);
  set("1", "production");
  assert.equal(devBypassEnabled(), false);
  assert.equal(adminFromCookieHeader(null), null);
  assert.equal(portalFromCookieHeader(null), null);
  set("true", "development");
  assert.equal(devBypassEnabled(), false, "only the exact value 1 turns it on");
});

test("in development with the flag, both portals sign in automatically and writes still need the CSRF header", () => {
  set("1", "development");
  const admin = adminFromCookieHeader(null);
  assert.equal(admin?.admin.display_name, "Hima Bindu");
  const portal = portalFromCookieHeader(null);
  assert.equal(portal?.company.short_code, "DEV");
  assert.equal(portal?.user.login_id, "221272");
  assert.equal(portal?.user.must_change_password, 0);
  env.NEXUS_DEV_PORTAL_USER = "DEV/221273";
  assert.equal(portalFromCookieHeader(null)?.user.login_id, "221273");
  const write = (csrf?: string) =>
    requirePortalApi(new Request("http://localhost:4317/api/investigations", { method: "POST", headers: { origin: "http://localhost:4317", "x-forwarded-host": "localhost:4317", ...(csrf ? { "x-csrf-token": csrf } : {}) } }));
  assert.ok(write() instanceof Response, "no CSRF header → refused");
  assert.ok(!(write(portal!.session.csrf_token) instanceof Response));
});

test("a real session still wins over the bypass", async () => {
  set("1", "development");
  delete env.NEXUS_DEV_PORTAL_USER;
  resetPortalRateLimitsForTests();
  const pw = runtimePassword();
  const cid = (getDb().prepare("SELECT id FROM companies WHERE short_code = 'DEV'").get() as { id: number }).id;
  getDb().prepare("INSERT INTO company_users (company_id, role, login_id, display_name, password_hash, must_change_password, created_at) VALUES (?, 'employee', '9999', 'Real', ?, 0, ?)").run(cid, await hashPassword(pw), new Date().toISOString());
  const s = await signInEmployee({ companyCode: "DEV", employeeId: "9999", password: pw, ip: "10.0.0.1" });
  assert.ok(s.ok);
  assert.equal(portalFromCookieHeader(`${PORTAL_COOKIE}=${s.ok ? s.token : ""}`)?.user.login_id, "9999");
});
