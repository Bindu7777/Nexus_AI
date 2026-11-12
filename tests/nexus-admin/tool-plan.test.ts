import assert from "node:assert/strict";
import test from "node:test";
import { setupTempAdminEnv } from "./helpers.ts";

import { registry } from "../../src/nexus-admin/connectors/registry.ts";
import { appendPlanEntry, createCompany, getToolPlan, linkPlanEntry, saveToolPlan } from "../../src/nexus-admin/server/companies.ts";
import { addConnector } from "../../src/nexus-admin/server/connectors.ts";
import { resetDbForTests } from "../../src/nexus-admin/server/db.ts";

setupTempAdminEnv("toolplan");
const actor = { type: "nexus_admin" as const, id: 1, label: "Hima Bindu" };
const ip = "127.0.0.1";
const known = (id: string) => registry().get(id);
test.after(() => resetDbForTests());

test("Supabase and Vercel can be picked, are saved, and keep their link after a later save", () => {
  const id = createCompany(
    { name: "HM", short_code: "HMT", contact_name: "C", contact_email: "c@example.invalid", country: "IN", region: "", deployment_mode: "customer", notes: "" },
    actor,
    ip,
  );
  const plan = saveToolPlan(
    id,
    {
      entries: [
        { key: "k-github01", registryId: "github", deployment: "cloud" },
        { key: "k-supabase", registryId: "supabase-db", deployment: "cloud" },
        { key: "k-vercel01", registryId: "vercel-logs", deployment: "cloud" },
      ],
      other: [],
      none: [],
    },
    known,
    actor,
    ip,
  );
  assert.deepEqual(plan.entries.map((e) => [e.registryId, e.category]), [
    ["github", "code"],
    ["supabase-db", "database"],
    ["vercel-logs", "logs"],
  ]);
  assert.throws(() => saveToolPlan(id, { entries: [{ key: "k-xxxxxxxx", registryId: "nope", deployment: "cloud" }] }, known, actor, ip), /Unknown tool/);
  assert.throws(() => saveToolPlan(id, { entries: [{ key: "k-xxxxxxxx", registryId: "vercel-logs", deployment: "self-hosted" }] }, known, actor, ip), /does not support/);

  // Credentials saved for the Vercel pick link to it, and a later autosave keeps that link.
  const added = addConnector({ companyId: id, registryId: "vercel-logs", values: { deployment: "cloud", config: { token: "vercel_tok_123456" }, scope: { projects: ["happy-moments"] } }, actor, ip });
  assert.ok(added.ok);
  linkPlanEntry(id, "k-vercel01", added.connector.id);
  saveToolPlan(id, { ...getToolPlan(id), entries: getToolPlan(id).entries.map(({ connectorId: _c, ...e }) => e) }, known, actor, ip);
  assert.equal(getToolPlan(id).entries.find((e) => e.registryId === "vercel-logs")?.connectorId, added.connector.id);
});

test("a connector added from Connection health joins the tool list once", () => {
  const id = createCompany(
    { name: "HM2", short_code: "HMU", contact_name: "C", contact_email: "c@example.invalid", country: "IN", region: "", deployment_mode: "customer", notes: "" },
    actor,
    ip,
  );
  saveToolPlan(id, { entries: [], other: [], none: ["database"] }, known, actor, ip);
  const added = addConnector({
    companyId: id,
    registryId: "supabase-db",
    values: { deployment: "cloud", config: { connectionString: "postgresql://nexus_readonly.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" }, scope: { schemas: ["public"] } },
    actor,
    ip,
  });
  assert.ok(added.ok);
  const entry = { category: added.connector.category, registryId: "supabase-db", deployment: "cloud" as const, connectorId: added.connector.id };
  appendPlanEntry(id, entry);
  appendPlanEntry(id, entry);
  const plan = getToolPlan(id);
  assert.equal(plan.entries.length, 1, "added once");
  assert.equal(plan.entries[0].connectorId, added.connector.id);
  assert.deepEqual(plan.none, [], "database is no longer marked as none");
});
