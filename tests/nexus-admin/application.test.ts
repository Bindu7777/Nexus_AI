import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { setupTempAdminEnv } from "./helpers.ts";

import {
  addAppUrl,
  addDocFile,
  addDocLink,
  getApplication,
  readDocFile,
  removeAppUrl,
  removeDoc,
  saveApplicationInfo,
  uploadsDir,
} from "../../src/nexus-admin/server/application.ts";
import { createCompany } from "../../src/nexus-admin/server/companies.ts";
import { getDb, resetDbForTests } from "../../src/nexus-admin/server/db.ts";

const env = setupTempAdminEnv("application");
process.env.NEXUS_UPLOADS_DIR = path.join(env.dir, "uploads");
const actor = { type: "nexus_admin" as const, id: 1, label: "Hima Bindu" };
const ip = "127.0.0.1";
test.after(() => resetDbForTests());

const company = (code: string) =>
  createCompany(
    { name: `Co ${code}`, short_code: code, contact_name: "C", contact_email: "c@example.invalid", country: "IN", region: "", deployment_mode: "customer", notes: "" },
    actor,
    ip,
  );

test("application details need a name and are saved per company", () => {
  const id = company("APP");
  assert.equal(saveApplicationInfo(id, { name: "  " }, actor, ip).ok, false);
  assert.equal(saveApplicationInfo(id, { name: "Happy Moments", description: "Share small moments." }, actor, ip).ok, true);
  assert.equal(saveApplicationInfo(id, { name: "Happy Moments v2", description: "" }, actor, ip).ok, true);
  const app = getApplication(id);
  assert.equal(app.info.name, "Happy Moments v2");
  assert.ok(app.info.updatedAt);
});

test("application URLs accept http and https only, with an environment, and never credentials", () => {
  const id = company("URL");
  assert.equal(addAppUrl(id, { url: "https://happymoments.example", environment: "production", label: "Web" }, actor, ip).ok, true);
  assert.equal(addAppUrl(id, { url: "https://staging.happymoments.example/", environment: "staging" }, actor, ip).ok, true);
  for (const bad of [
    { url: "javascript:alert(1)", environment: "production" },
    { url: "ftp://files.example", environment: "other" },
    { url: "https://user:pass@app.example", environment: "production" },
    { url: "not a url", environment: "production" },
    { url: "https://app.example", environment: "prod" },
  ]) {
    assert.equal(addAppUrl(id, bad, actor, ip).ok, false, JSON.stringify(bad));
  }
  const app = getApplication(id);
  assert.equal(app.urls.length, 2);
  assert.equal(app.urls[1].url, "https://staging.happymoments.example", "trailing slash trimmed");
  const other = company("URL2");
  assert.throws(() => removeAppUrl(other, app.urls[0].id, actor, ip), /not found for this company/);
  removeAppUrl(id, app.urls[0].id, actor, ip);
  assert.equal(getApplication(id).urls.length, 1);
});

test("documentation links need a title and a safe address", () => {
  const id = company("LNK");
  assert.equal(addDocLink(id, { title: "", url: "https://docs.example/a" }, actor, ip).ok, false);
  assert.equal(addDocLink(id, { title: "Arch", url: "javascript:alert(1)" }, actor, ip).ok, false);
  assert.equal(addDocLink(id, { title: "Architecture", url: "https://docs.example/architecture" }, actor, ip).ok, true);
  assert.equal(getApplication(id).docs[0].kind, "link");
});

test("uploads accept documents, check content against the extension, and stay scoped to the company", () => {
  const id = company("UPL");
  const md = Buffer.from("# Happy Moments\n\nSetup notes.\n");
  const ok = addDocFile(id, { name: "../../etc/README.md", bytes: md }, { title: "Readme" }, actor, ip);
  assert.ok(ok.ok);
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(100, 32)]);
  assert.ok(addDocFile(id, { name: "spec.pdf", bytes: pdf }, {}, actor, ip).ok);

  for (const [name, bytes, why] of [
    ["tool.exe", Buffer.from("MZ"), /not accepted/],
    ["fake.pdf", Buffer.from("hello, not a pdf"), /does not match/],
    ["empty.md", Buffer.alloc(0), /empty/],
    ["binary.txt", Buffer.from([0x41, 0x00, 0x42]), /text file/],
    ["page.html", Buffer.from("<script>alert(1)</script>"), /not accepted/],
  ] as const) {
    const r = addDocFile(id, { name, bytes }, {}, actor, ip);
    assert.equal(r.ok, false, name);
    assert.match(r.ok ? "" : r.error, why, name);
  }

  const docs = getApplication(id).docs;
  assert.equal(docs.length, 2);
  const readme = docs.find((d) => d.title === "Readme")!;
  assert.equal(readme.fileName, "README.md", "path parts stripped from the original name");
  const stored = getDb().prepare("SELECT stored_name FROM company_docs WHERE id = ?").get(readme.id) as { stored_name: string };
  assert.match(stored.stored_name, /^[0-9a-f]{32}\.md$/);
  const file = path.join(uploadsDir(id), stored.stored_name);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const back = readDocFile(id, readme.id);
  assert.equal(back?.bytes.toString(), md.toString());
  const other = company("UPL2");
  assert.equal(readDocFile(other, readme.id), null, "another company cannot read it");
  assert.throws(() => removeDoc(other, readme.id, actor, ip), /not found for this company/);

  removeDoc(id, readme.id, actor, ip);
  assert.equal(fs.existsSync(file), false, "file deleted with the record");
  assert.equal(readDocFile(id, readme.id), null);

  const audit = JSON.stringify(getDb().prepare("SELECT * FROM audit_log WHERE company_id = ?").all(id));
  assert.match(audit, /application.doc_uploaded/);
  assert.doesNotMatch(audit, /Setup notes/, "file contents never go to the audit log");
});
