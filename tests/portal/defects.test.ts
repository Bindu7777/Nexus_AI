import assert from "node:assert/strict";
import test from "node:test";
import { checkDefectNumber, defectExamples, type DefectSource } from "../../src/portal/server/defects.ts";

const jira: DefectSource[] = [{ kind: "jira", label: "Jira", projectKeys: ["KAN", "PAY"] }];
const gh: DefectSource[] = [{ kind: "github-issues", label: "GitHub Issues", repository: "acme/web" }];

test("Jira keys inside the configured projects are accepted and normalised", () => {
  assert.deepEqual(checkDefectNumber(jira, " kan-012 "), { ok: true, key: "KAN-12", source: "jira", where: "Jira project KAN" });
  assert.equal(checkDefectNumber(jira, "PAY-1423").ok, true);
});

test("numbers outside the scope, or in the wrong shape, are refused in plain words", () => {
  const out = checkDefectNumber(jira, "OPS-7");
  assert.equal(out.ok, false);
  assert.match(out.ok ? "" : out.message, /OPS is not a project.*KAN, PAY/);
  assert.match(checkDefectNumber(jira, "42").ok ? "" : (checkDefectNumber(jira, "42") as { message: string }).message, /full ticket key, for example KAN-42/);
  assert.match((checkDefectNumber(jira, "drop table x") as { message: string }).message, /does not look like a defect number/);
  assert.match((checkDefectNumber([], "KAN-1") as { message: string }).message, /no working defect connector/);
});

test("GitHub issue numbers work with or without the repository", () => {
  assert.deepEqual(checkDefectNumber(gh, "#42"), { ok: true, key: "acme/web#42", source: "github-issues", where: "GitHub Issues in acme/web" });
  assert.equal(checkDefectNumber(gh, "acme/web#42").ok, true);
  assert.equal(checkDefectNumber(gh, "evil/repo#42").ok, false);
  assert.deepEqual(defectExamples([...jira, ...gh]), ["KAN-123", "PAY-123", "acme/web#42"]);
});
