import assert from "node:assert/strict";
import test from "node:test";
import { runtimePassword, setupTempAdminEnv } from "../nexus-admin/helpers.ts";

import { createAdmin } from "../../src/nexus-admin/server/auth.ts";
import { createCompany, pauseCompany } from "../../src/nexus-admin/server/companies.ts";
import { getDb, resetDbForTests } from "../../src/nexus-admin/server/db.ts";
import { hashPassword } from "../../src/nexus-admin/server/passwords.ts";
import {
  changeEmployeePassword,
  LOCK_AFTER,
  lookupCompanyName,
  NEUTRAL_FAIL,
  PORTAL_COOKIE,
  portalFromCookieHeader,
  requirePortalApi,
  resetPortalRateLimitsForTests,
  signInEmployee,
} from "../../src/portal/server/auth.ts";
import * as loginRoute from "../../src/app/api/portal/auth/login/route.ts";
import * as passwordRoute from "../../src/app/api/portal/auth/password/route.ts";

setupTempAdminEnv("portal-auth");
const admin = { type: "nexus_admin" as const, id: 1, label: "Hima Bindu" };
const ip = "10.0.0.7";
test.after(() => resetDbForTests());
test.beforeEach(() => resetPortalRateLimitsForTests());

function company(code: string, status: "draft" | "active" = "active") {
  const id = createCompany(
    { name: `${code} Ltd`, short_code: code, contact_name: "C", contact_email: "c@example.invalid", country: "IN", region: "", deployment_mode: "customer", notes: "" },
    admin,
    "127.0.0.1",
  );
  getDb().prepare("UPDATE companies SET status = ? WHERE id = ?").run(status, id);
  return id;
}

async function employee(companyId: number, loginId: string, password: string, mustChange = true) {
  const info = getDb()
    .prepare("INSERT INTO company_users (company_id, role, login_id, display_name, password_hash, must_change_password, created_at) VALUES (?, 'employee', ?, 'Test Person', ?, ?, ?)")
    .run(companyId, loginId, await hashPassword(password), mustChange ? 1 : 0, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

const cookie = (token: string) => `${PORTAL_COOKIE}=${token}`;
const req = (url: string, init: { method?: string; token?: string; csrf?: string; body?: unknown } = {}) =>
  new Request(`http://localhost:4317${url}`, {
    method: init.method ?? "GET",
    headers: {
      origin: "http://localhost:4317",
      "x-forwarded-host": "localhost:4317",
      "content-type": "application/json",
      ...(init.token ? { cookie: cookie(init.token) } : {}),
      ...(init.csrf ? { "x-csrf-token": init.csrf } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

test("sign-in, forced password change, and the new password works", async () => {
  const cid = company("ACME");
  const temp = runtimePassword();
  await employee(cid, "221272", temp);
  const r = await signInEmployee({ companyCode: "acme", employeeId: " 221272 ", password: temp, ip });
  assert.ok(r.ok);
  assert.equal(r.mustChangePassword, true);
  assert.equal(r.companyName, "ACME Ltd");

  // With a temporary password, every API except the password change is refused.
  const blocked = requirePortalApi(req("/api/investigations", { token: r.token }));
  assert.ok(blocked instanceof Response);
  assert.equal(blocked.status, 403);
  assert.ok(!(requirePortalApi(req("/api/portal/auth/password", { token: r.token }), { allowMustChange: true }) instanceof Response));

  const ctx = portalFromCookieHeader(cookie(r.token))!;
  assert.match((await changeEmployeePassword(ctx, temp, "short", ip)).ok ? "" : "too short", /too short/);
  const asId = await changeEmployeePassword(ctx, temp, "221272", ip);
  assert.equal(asId.ok, false);
  const same = await changeEmployeePassword(ctx, temp, temp, ip);
  assert.equal(same.ok, false);
  const wrongCurrent = await changeEmployeePassword(ctx, "not-the-password", "A-much-better-passphrase-9", ip);
  assert.equal(wrongCurrent.ok, false);

  // Through the real route: CSRF required, then success.
  const noCsrf = await passwordRoute.POST(req("/api/portal/auth/password", { method: "POST", token: r.token, body: { current: temp, next: "A-much-better-passphrase-9", confirm: "A-much-better-passphrase-9" } }));
  assert.equal(noCsrf.status, 403);
  const changed = await passwordRoute.POST(
    req("/api/portal/auth/password", { method: "POST", token: r.token, csrf: r.csrf, body: { current: temp, next: "A-much-better-passphrase-9", confirm: "A-much-better-passphrase-9" } }),
  );
  assert.equal(changed.status, 200);
  assert.ok(!(requirePortalApi(req("/api/investigations", { token: r.token })) instanceof Response), "full access after the change");
  const again = await signInEmployee({ companyCode: "ACME", employeeId: "221272", password: "A-much-better-passphrase-9", ip });
  assert.ok(again.ok && !again.mustChangePassword);
});

test("failure messages never reveal whether the company or employee exists", async () => {
  const cid = company("BETA");
  const pw = runtimePassword();
  await employee(cid, "1001", pw, false);
  const results = await Promise.all([
    signInEmployee({ companyCode: "NOPE", employeeId: "1001", password: pw, ip }),
    signInEmployee({ companyCode: "BETA", employeeId: "9999", password: pw, ip }),
    signInEmployee({ companyCode: "BETA", employeeId: "1001", password: "wrong-password-123", ip }),
    signInEmployee({ companyCode: "BETA", employeeId: "Hima Bindu", password: pw, ip }),
  ]);
  for (const r of results) {
    assert.equal(r.ok, false);
    assert.equal(r.ok ? "" : r.message, NEUTRAL_FAIL);
  }
});

test("five wrong passwords lock the account for 15 minutes, even for the right password", async () => {
  const cid = company("LOCK");
  const pw = runtimePassword();
  const uid = await employee(cid, "2002", pw, false);
  for (let i = 0; i < LOCK_AFTER; i += 1) await signInEmployee({ companyCode: "LOCK", employeeId: "2002", password: "wrong-password-123", ip: `10.1.0.${i}` });
  const locked = await signInEmployee({ companyCode: "LOCK", employeeId: "2002", password: pw, ip: "10.1.0.99" });
  assert.equal(locked.ok, false);
  assert.equal(locked.ok ? "" : locked.message, NEUTRAL_FAIL);
  const row = getDb().prepare("SELECT locked_until FROM company_users WHERE id = ?").get(uid) as { locked_until: string };
  const minutes = (Date.parse(row.locked_until) - Date.now()) / 60000;
  assert.ok(minutes > 14 && minutes <= 15, `locked for ${minutes} minutes`);
  const actions = (getDb().prepare("SELECT action FROM audit_log WHERE company_id = ?").all(cid) as { action: string }[]).map((a) => a.action);
  assert.ok(actions.includes("portal.account_locked"));
  assert.ok(actions.includes("portal.sign_in_locked"));
});

test("sign-in attempts are rate limited per address", async () => {
  company("RATE");
  let last;
  for (let i = 0; i < 31; i += 1) last = await signInEmployee({ companyCode: "RATE", employeeId: `x${i}`, password: "wrong-password-123", ip: "10.9.9.9" });
  assert.equal(last!.ok, false);
  assert.equal(last!.ok ? 0 : last!.status, 429);
});

test("paused, draft and turned-off logins are told plainly, but only with the right password", async () => {
  const paused = company("PAUS");
  const pw = runtimePassword();
  await employee(paused, "3003", pw, false);
  const before = await signInEmployee({ companyCode: "PAUS", employeeId: "3003", password: pw, ip });
  assert.ok(before.ok);
  pauseCompany(paused, admin, "127.0.0.1");
  assert.equal(portalFromCookieHeader(cookie(before.ok ? before.token : "")), null, "pausing ends the session");
  const right = await signInEmployee({ companyCode: "PAUS", employeeId: "3003", password: pw, ip });
  assert.match(right.ok ? "" : right.message, /paused.*contact your company admin/i);
  const wrong = await signInEmployee({ companyCode: "PAUS", employeeId: "3003", password: "wrong-password-123", ip });
  assert.equal(wrong.ok ? "" : wrong.message, NEUTRAL_FAIL);

  const draft = company("DRFT", "draft");
  await employee(draft, "4004", pw, false);
  const d = await signInEmployee({ companyCode: "DRFT", employeeId: "4004", password: pw, ip });
  assert.match(d.ok ? "" : d.message, /not live on Nexus yet/);

  const live = company("LIVE");
  const uid = await employee(live, "5005", pw, false);
  getDb().prepare("UPDATE company_users SET disabled_at = ? WHERE id = ?").run(new Date().toISOString(), uid);
  const off = await signInEmployee({ companyCode: "LIVE", employeeId: "5005", password: pw, ip });
  assert.match(off.ok ? "" : off.message, /login is turned off/);
});

test("a Nexus admin session is not a portal session, and sessions stay in their company", async () => {
  const pw = runtimePassword();
  await createAdmin("Hima Bindu", pw);
  const cid = company("ISO");
  await employee(cid, "6006", pw, false);
  const r = await signInEmployee({ companyCode: "ISO", employeeId: "6006", password: pw, ip });
  assert.ok(r.ok);
  const ctx = portalFromCookieHeader(cookie(r.token))!;
  assert.equal(ctx.company.short_code, "ISO");
  // An admin session token presented as a portal cookie is refused.
  const { signIn } = await import("../../src/nexus-admin/server/auth.ts");
  const a = await signIn({ loginId: "Hima Bindu", password: pw, ip: "127.0.0.2" });
  assert.ok(a.ok);
  assert.equal(portalFromCookieHeader(cookie(a.ok ? a.token : "")), null);
});

test("the company name lookup shows live companies only", () => {
  company("SHOW");
  company("HIDE", "draft");
  assert.equal(lookupCompanyName("show", ip).name, "SHOW Ltd");
  assert.equal(lookupCompanyName("HIDE", ip).name, null);
  assert.equal(lookupCompanyName("NONE", ip).name, null);
});

test("the login route sets an httpOnly, SameSite=Strict cookie and audits without the password", async () => {
  const cid = company("ROUT");
  const pw = runtimePassword();
  await employee(cid, "7007", pw, false);
  const res = await loginRoute.POST(req("/api/portal/auth/login", { method: "POST", body: { companyCode: "ROUT", employeeId: "7007", password: pw } }));
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^nexus_portal_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const crossSite = await loginRoute.POST(
    new Request("http://localhost:4317/api/portal/auth/login", { method: "POST", headers: { origin: "https://evil.example", "x-forwarded-host": "localhost:4317" }, body: "{}" }),
  );
  assert.equal(crossSite.status, 403);
  const audit = JSON.stringify(getDb().prepare("SELECT * FROM audit_log").all());
  assert.ok(audit.includes("portal.sign_in"));
  assert.ok(!audit.includes(pw), "no password in the audit log");
});
