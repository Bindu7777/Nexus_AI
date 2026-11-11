import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMySqlConnector } from "../connectors/database/mysql.ts";
import { assertReadOnlySql, createPostgresConnector, type DbClient } from "../connectors/database/postgres.ts";
import { createDemoCatalogConnector } from "../connectors/demo-catalog.ts";
import { createConfluenceConnector } from "../connectors/docs/confluence.ts";
import { createGitHubMarkdownConnector } from "../connectors/docs/github-markdown.ts";
import { createMarkdownFolderConnector } from "../connectors/docs/markdown-folder.ts";
import { evidenceItemToRecord } from "../connectors/evidence.ts";
import { createGitHubConnector } from "../connectors/github.ts";
import { assertReadOnlyRequest, createReadOnlyHttp } from "../connectors/http.ts";
import { buildConnectors } from "../connectors/index.ts";
import { createFileLogConnector } from "../connectors/logs/file.ts";
import { createCloudWatchLogsConnector, createDatadogLogsConnector, createLokiLogsConnector, createSentryConnector } from "../connectors/logs/stubs.ts";
import { createSupabaseLogsConnector } from "../connectors/logs/supabase.ts";
import { createGitHubIssuesConnector } from "../connectors/tickets/github-issues.ts";
import { createJiraConnector } from "../connectors/tickets/jira.ts";
import { type Connector, NotImplementedConnectorError, ReadOnlyViolationError } from "../connectors/types.ts";

// ---------- recording fetch that answers like the real services ----------

type Call = { method: string; url: string; hasBody: boolean };

function recordingFetch() {
  const calls: Call[] = [];
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const issue = (n: number) => ({
    number: n,
    title: "Moments feed shows duplicates",
    state: "open",
    html_url: `https://github.com/acme/happy-moments/issues/${n}`,
    body: "Feed shows each moment twice after refresh.",
    merged_at: null,
    updated_at: "2026-11-10T09:00:00Z",
    created_at: "2026-11-09T09:00:00Z",
    closed_at: null,
    user: { login: "reporter" },
    labels: [{ name: "bug" }],
  });
  const commit = {
    sha: "abc1234def5678abc1234def5678abc1234def56",
    html_url: "https://github.com/acme/happy-moments/commit/abc1234",
    commit: { message: "Fix feed query", author: { name: "dev", date: "2026-11-08T10:00:00Z" } },
    files: [{ filename: "src/feed.ts", status: "modified", additions: 3, deletions: 1 }],
  };
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, hasBody: init?.body != null });
    const accept = new Headers(init?.headers).get("accept") ?? "";
    const u = new URL(url);
    const p = u.pathname;

    if (u.hostname === "api.github.com") {
      if (p === "/repos/acme/happy-moments") {
        return json({ full_name: "acme/happy-moments", default_branch: "main", private: true, description: null, language: "TypeScript", pushed_at: "2026-11-10T00:00:00Z", html_url: "https://github.com/acme/happy-moments", permissions: { admin: false, push: false, pull: true } });
      }
      if (p === "/search/code") return json({ items: [{ path: "src/feed.ts", sha: "1", html_url: "https://github.com/x", text_matches: [{ fragment: "select * from moments" }] }] });
      if (p.startsWith("/repos/acme/happy-moments/contents/")) {
        if (p.endsWith("docs/setup.md")) return new Response("# Setup\n\nThe moments table holds posts.\n## Feed\nThe feed reads moments.\n");
        return new Response("line 1\nline 2\nline 3\nline 4\n");
      }
      if (p === "/repos/acme/happy-moments/git/trees/main") return json({ sha: "t", truncated: false, tree: [{ path: "docs/setup.md", type: "blob" }, { path: "src/feed.ts", type: "blob" }] });
      if (p === "/repos/acme/happy-moments/commits") return json([commit]);
      if (p.startsWith("/repos/acme/happy-moments/commits/")) return accept.includes("diff") ? new Response("diff --git a/src/feed.ts b/src/feed.ts\n") : json(commit);
      if (p === "/repos/acme/happy-moments/pulls") return json([issue(7)]);
      if (p.startsWith("/repos/acme/happy-moments/pulls/")) return accept.includes("diff") ? new Response("diff --git a/x b/x\n") : json(issue(7));
      if (p === "/repos/acme/happy-moments/issues") return json([issue(5)]);
      if (p === "/repos/acme/happy-moments/issues/5/comments") return json([{ user: { login: "dev" }, body: "Seen it too", created_at: "2026-11-10T10:00:00Z" }]);
      if (p === "/repos/acme/happy-moments/issues/5") return json(issue(5));
      if (p === "/repos/acme/happy-moments/issues/404") return json({ message: "Not Found" }, 404);
      return json({ message: "Not Found" }, 404);
    }
    if (u.hostname === "jira.example.invalid") {
      if (p === "/rest/api/3/myself") return json({ displayName: "Nexus reader" });
      if (p === "/rest/api/3/project/HM") return json({ key: "HM", name: "Happy Moments" });
      if (p === "/rest/api/3/search/jql") return json({ issues: [{ key: "HM-3", fields: { summary: "Feed duplicates", updated: "2026-11-10T00:00:00Z", status: { name: "Open" } } }] });
      if (p === "/rest/api/3/issue/HM-3") {
        return json({ key: "HM-3", fields: { summary: "Feed shows duplicates after refresh", description: "After a refresh the moments feed shows every moment twice. Started after Monday's deploy. Errors in logs.", project: { key: "HM" }, labels: [] } });
      }
      return json({}, 404);
    }
    if (u.hostname === "api.supabase.com") {
      return json({ result: [{ id: "a1b2", timestamp: 1_731_230_000_000_000, event_message: "error: duplicate key in moments" }] });
    }
    if (u.hostname === "127.0.0.1") {
      if (p === "/health") return json({ ok: true, service: "nexus-sandbox-catalog", mode: "baseline" });
      if (p === "/admin/telemetry") {
        return json({ logs: [{ id: "log_1", at: "2026-11-10T00:00:00Z", level: "warn", traceId: "t1", message: "lock wait", fields: {} }], traces: [{ traceId: "t1", logId: "log_1", startedAt: "2026-11-10T00:00:00Z", durationMs: 90, status: 200, productId: "orion-90", mode: "incident", workPlacement: "inside-lock", spans: [] }] });
      }
    }
    return json({}, 404);
  };
  return { calls, fetchImpl };
}

// ---------- fake Postgres client that records SQL ----------

function recordingDb() {
  const statements: string[] = [];
  const client: DbClient = {
    async connect() {},
    async end() {},
    async query(sql: string) {
      statements.push(sql.trim());
      const s = sql.toLowerCase();
      if (s.includes("current_setting('transaction_read_only')")) return { rows: [{ usr: "nexus_readonly", db: "postgres", version: "15.6", ro: "on", superuser: false }] };
      if (s.includes("has_table_privilege")) return { rows: [] };
      if (s.includes("count(*)")) return { rows: [{ n: 2 }] };
      if (s.includes("current_database() as db")) return { rows: [{ db: "postgres", usr: "nexus_readonly", version: "15.6" }] };
      if (s.includes("from pg_class c join pg_namespace")) return { rows: [{ schema: "public", name: "moments", kind: "r", rls: true, rls_forced: false, description: null, estimated_rows: 120 }, { schema: "public", name: "profiles", kind: "r", rls: true, rls_forced: false, description: null, estimated_rows: 10 }] };
      if (s.includes("from information_schema.columns") && s.includes("table_schema = any")) {
        return { rows: [
          { schema: "public", table: "moments", name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()", position: 1 },
          { schema: "public", table: "moments", name: "user_id", type: "uuid", nullable: false, default: null, position: 2 },
          { schema: "public", table: "profiles", name: "id", type: "uuid", nullable: false, default: null, position: 1 },
        ] };
      }
      if (s.includes("from pg_constraint")) return { rows: [{ schema: "public", table: "moments", name: "moments_user_id_fkey", type: "f", definition: "FOREIGN KEY (user_id) REFERENCES public.profiles(id)" }] };
      if (s.includes("from pg_indexes")) return { rows: [{ schema: "public", table: "moments", name: "moments_pkey", definition: "CREATE UNIQUE INDEX moments_pkey ON public.moments USING btree (id)" }] };
      if (s.includes("from pg_policies")) return { rows: [{ schema: "public", table: "moments", name: "own moments", permissive: "PERMISSIVE", roles: ["authenticated"], command: "SELECT", using: "(auth.uid() = user_id)", with_check: null }] };
      if (s.includes("to_regclass")) return { rows: [{ supabase: true, prisma: false }] };
      if (s.includes("table_schema = 'supabase_migrations'")) return { rows: [{ column_name: "version" }, { column_name: "name" }] };
      if (s.includes("from supabase_migrations.schema_migrations")) return { rows: [{ version: "20261101000000", name: "create_moments" }] };
      if (s.startsWith("select * from")) return { rows: [{ id: "x", user_id: "y" }] };
      return { rows: [] };
    },
  };
  return { statements, client };
}

// ---------- shared fixtures ----------

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nexus-contract-"));
}

function build() {
  const { calls, fetchImpl } = recordingFetch();
  const db = recordingDb();
  const logDir = tempDir();
  fs.writeFileSync(path.join(logDir, "app.log"), '2026-11-10T09:00:00Z INFO start\n{"timestamp":"2026-11-10T09:01:00Z","level":"error","msg":"duplicate moments row"}\n');
  const docDir = tempDir();
  fs.writeFileSync(path.join(docDir, "README.md"), "# Happy Moments\n\nShare small moments.\n## Feed\nThe feed lists moments.\n");
  const github = createGitHubConnector({ repos: ["https://github.com/acme/happy-moments"], token: "ghp_testtoken123", fetchImpl });
  const jiraEnv = { JIRA_BASE_URL: "https://jira.example.invalid", JIRA_EMAIL: "r@example.invalid", JIRA_API_TOKEN: "jira-test-token", JIRA_PROJECT_KEY: "HM" };
  const connectors: Connector[] = [
    github,
    createPostgresConnector({ flavor: "supabase", clientFactory: () => db.client, sampling: { enabled: false } }),
    createMySqlConnector(),
    createGitHubIssuesConnector({ github, repo: "acme/happy-moments" }),
    createJiraConnector({ env: jiraEnv, fetchImpl }),
    createFileLogConnector({ path: logDir }),
    createSupabaseLogsConnector({ projectRef: "abcdefghijklmnopqrst", accessToken: "sbp_testtoken", fetchImpl }),
    createDatadogLogsConnector(),
    createCloudWatchLogsConnector(),
    createLokiLogsConnector(),
    createSentryConnector(),
    createMarkdownFolderConnector({ path: docDir }),
    createGitHubMarkdownConnector({ github, repo: "acme/happy-moments", pathPrefix: "docs/" }),
    createConfluenceConnector(),
    createDemoCatalogConnector({ baseUrl: "http://127.0.0.1:4318", fetchImpl }),
  ];
  return { calls, db, connectors, github, logDir, docDir, jiraEnv, fetchImpl };
}

const KINDS = new Set(["code", "database", "tickets", "logs", "docs", "sandbox"]);
const WRITE_NAME = /^(write|create|update|delete|insert|post|put|patch|remove|apply|merge|push|comment|transition|upload|set)/i;

function assertContract(c: Connector) {
  assert.equal(typeof c.id, "string", "id");
  assert.ok(KINDS.has(c.kind), `${c.id} kind ${c.kind}`);
  assert.equal(c.readOnly, true, `${c.id} must declare readOnly: true`);
  assert.equal(typeof c.implemented, "boolean");
  assert.equal(typeof c.description, "string");
  for (const fn of ["test", "search", "fetch"] as const) assert.equal(typeof c[fn], "function", `${c.id}.${fn}`);
  for (const [name, value] of Object.entries(c)) {
    if (typeof value === "function") assert.doesNotMatch(name, WRITE_NAME, `${c.id} exposes a write-shaped method "${name}"`);
  }
}

// ---------- tests ----------

test("every connector satisfies the shared interface and declares readOnly", () => {
  const { connectors } = build();
  assert.equal(new Set(connectors.map((c) => c.id)).size, connectors.length, "ids are unique");
  for (const c of connectors) assertContract(c);
});

test("the registry builds only read-only connectors", () => {
  const { fetchImpl, logDir, docDir } = build();
  const set = buildConnectors(
    {
      github: { repos: ["acme/happy-moments"], token: "t" },
      database: { type: "supabase", connectionString: "postgres://reader:pw@localhost:5432/postgres" },
      logs: { type: "file", path: logDir },
      docs: { type: "folder", path: docDir },
      tickets: { type: "github-issues", repo: "acme/happy-moments" },
      demoCatalog: { baseUrl: "http://127.0.0.1:4318" },
    },
    { fetchImpl },
  );
  assert.equal(set.all.length, 6);
  for (const c of set.all) assertContract(c);
  assert.equal(set.tickets?.id, "github-issues");
});

test("exercising every implemented connector sends only GET requests with no body", async () => {
  const { calls, connectors, github } = build();
  for (const c of connectors.filter((x) => x.implemented)) {
    const result = await c.test();
    assert.ok(Array.isArray(result.reached) && Array.isArray(result.problems) && Array.isArray(result.warnings));
    assert.equal(result.ok, true, `${c.id}.test(): ${result.problems.join(" ")}`);
    assert.ok(result.reached.length > 0, `${c.id}.test() reports what it reached`);
    const found = await c.search({ text: "moments", limit: 5 });
    if (c.id !== "demo-catalog") assert.ok(found.length > 0, `${c.id}.search() found the seeded text`);
    for (const item of found) {
      assert.equal(item.source.length > 0 && item.ref.length > 0, true);
      assert.ok(item.observation === "observed" || item.observation === "inferred");
    }
  }
  // Every extra read path.
  await github.listRepos();
  await github.readFile("acme/happy-moments", "src/feed.ts", { startLine: 2, endLine: 3 });
  await github.listTree("acme/happy-moments");
  await github.listCommits("acme/happy-moments", { since: "2026-11-01T00:00:00Z", path: "src/feed.ts" });
  await github.readCommit("acme/happy-moments", "abc1234def5678abc1234def5678abc1234def56");
  await github.readDiff("acme/happy-moments", { sha: "abc1234def5678abc1234def5678abc1234def56" });
  await github.readDiff("acme/happy-moments", { pull: 7 });
  await github.listPulls("acme/happy-moments");
  await github.listIssues("acme/happy-moments");
  assert.equal(await github.readIssue("acme/happy-moments", 404), null);
  for (const ref of [
    "github:file:acme/happy-moments@main:src/feed.ts#L1-L2",
    "github:commit:acme/happy-moments@abc1234def5678abc1234def5678abc1234def56",
    "github:diff:acme/happy-moments@abc1234def5678abc1234def5678abc1234def56",
    "github:pr:acme/happy-moments#7",
    "github:prdiff:acme/happy-moments#7",
    "github:issue:acme/happy-moments#5",
  ]) {
    assert.ok(await github.fetch(ref), ref);
  }
  const issues = connectors.find((c) => c.id === "github-issues")!;
  assert.ok(await issues.fetch("ticket:github:#5"));
  const jira = connectors.find((c) => c.id === "jira")!;
  assert.ok(await jira.fetch("ticket:jira:HM-3"));
  const catalog = connectors.find((c) => c.id === "demo-catalog")!;
  assert.ok(await catalog.fetch("catalog:log:log_1"));
  assert.ok(await catalog.fetch("catalog:trace:t1"));
  const supa = connectors.find((c) => c.id === "supabase-logs")!;
  assert.ok(await supa.fetch("log:supabase:edge_logs:a1b2"));

  assert.ok(calls.length > 20, `expected many requests, saw ${calls.length}`);
  for (const call of calls) {
    assert.equal(call.method, "GET", `${call.method} ${call.url}`);
    assert.equal(call.hasBody, false, `body sent to ${call.url}`);
  }
});

test("the read-only HTTP client refuses every writing method and any body", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    assert.throws(() => assertReadOnlyRequest({ method }), ReadOnlyViolationError, method);
  }
  assert.throws(() => assertReadOnlyRequest({ method: "GET", body: "x" }), ReadOnlyViolationError);
  assert.doesNotThrow(() => assertReadOnlyRequest({ method: "GET" }));
  let called = false;
  const http = createReadOnlyHttp({ fetchImpl: async () => { called = true; return new Response("{}"); } });
  await http.get("https://example.invalid/");
  assert.equal(called, true);
});

test("connector errors do not leak tokens", async () => {
  const github = createGitHubConnector({
    repos: ["acme/happy-moments"],
    token: "ghp_SECRETVALUE123",
    fetchImpl: async () => { throw new Error("socket closed for ghp_SECRETVALUE123"); },
  });
  const result = await github.test();
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /SECRETVALUE/);
});

test("the SQL guard allows reads only", () => {
  for (const ok of [
    "select 1",
    "  WITH x as (select 1) select * from x",
    "show server_version",
    "select 'INSERT INTO t values (1)' as text_literal",
    'select "delete" from t',
  ]) {
    assert.doesNotThrow(() => assertReadOnlySql(ok), ok);
  }
  for (const bad of [
    "insert into moments values (1)",
    "update moments set x = 1",
    "delete from moments",
    "drop table moments",
    "alter table moments add column x int",
    "truncate moments",
    "grant all on moments to public",
    "select 1; delete from moments",
    "with d as (delete from moments returning *) select * from d",
    "create table x (id int)",
    "copy moments to '/tmp/x'",
    "set role postgres",
    "do $$ begin perform 1; end $$",
  ]) {
    assert.throws(() => assertReadOnlySql(bad), ReadOnlyViolationError, bad);
  }
});

test("Postgres reads run inside a READ ONLY transaction that is rolled back", async () => {
  const db = recordingDb();
  const pg = createPostgresConnector({ flavor: "supabase", clientFactory: () => db.client });
  const result = await pg.test();
  assert.equal(result.ok, true, result.problems.join(" "));
  const schema = await pg.readSchema({ refresh: true });
  assert.equal(schema.tables.length, 2);
  assert.equal(schema.foreignKeys[0].references, "public.profiles(id)");
  assert.equal(schema.policies[0].name, "own moments");
  assert.equal(schema.migrations[0].version, "20261101000000");
  assert.ok(await pg.fetch("db:table:public.moments"));
  assert.ok(await pg.fetch("db:policy:public.moments:own moments"));
  assert.ok(await pg.fetch("db:migration:20261101000000"));

  // Split the recorded statements into transactions and check each one.
  const txs: string[][] = [];
  for (const s of db.statements) {
    if (s === "BEGIN TRANSACTION READ ONLY") txs.push([s]);
    else txs[txs.length - 1].push(s);
  }
  assert.ok(txs.length >= 2);
  for (const tx of txs) {
    assert.equal(tx[0], "BEGIN TRANSACTION READ ONLY");
    assert.equal(tx[tx.length - 1], "ROLLBACK");
    for (const s of tx.slice(1, -1)) {
      if (/^SET LOCAL statement_timeout = \d+$/.test(s)) continue;
      assert.doesNotThrow(() => assertReadOnlySql(s), s);
    }
  }
  assert.ok(db.statements.every((s) => !/^select \* from/i.test(s)), "no row data read without sampling");
});

test("Postgres row sampling is refused unless enabled, and marked when enabled", async () => {
  const off = createPostgresConnector({ clientFactory: () => recordingDb().client });
  await assert.rejects(off.sampleRows("public.moments"), /sampling is disabled/i);
  const on = createPostgresConnector({ clientFactory: () => recordingDb().client, sampling: { enabled: true, reportable: false } });
  const sample = await on.sampleRows("public.moments", 3);
  assert.equal(sample.containsSampledData, true);
  assert.equal(sample.meta?.reportable, false);
  await assert.rejects(on.sampleRows("public.not_a_table"), /not a table/);
});

test("placeholder connectors say so and refuse to search or fetch", async () => {
  for (const stub of [createMySqlConnector(), createDatadogLogsConnector(), createCloudWatchLogsConnector(), createLokiLogsConnector(), createSentryConnector(), createConfluenceConnector()]) {
    assert.equal(stub.implemented, false);
    const result = await stub.test();
    assert.equal(result.ok, false);
    assert.match(result.problems[0], /placeholder/);
    await assert.rejects(stub.search({ text: "x" }), NotImplementedConnectorError);
    await assert.rejects(stub.fetch("x"), NotImplementedConnectorError);
  }
});

test("GitHub refuses refs to repositories that were not onboarded", async () => {
  const { github } = build();
  await assert.rejects(github.fetch("github:file:evil/other@main:secrets.txt"), /not one of the onboarded repositories/);
  await assert.rejects(github.readFile("evil/other", "x"), /not one of the onboarded repositories/);
});

test("file logs and docs refuse paths outside their root", async () => {
  const { connectors, logDir, docDir } = build();
  const logs = connectors.find((c) => c.id === "logs-file")!;
  const docs = connectors.find((c) => c.id === "docs-folder")!;
  const outside = tempDir();
  fs.writeFileSync(path.join(outside, "secret.log"), "secret\n");
  fs.symlinkSync(path.join(outside, "secret.log"), path.join(logDir, "escape.log"));
  fs.symlinkSync(path.join(outside, "secret.log"), path.join(docDir, "escape.md"));

  for (const ref of ["log:file:../secret.log#L1", `log:file:${path.join(outside, "secret.log")}#L1`, "log:file:escape.log#L1"]) {
    await assert.rejects(logs.fetch(ref), /Refused log path/, ref);
  }
  for (const ref of ["doc:file:../x.md", "doc:file:escape.md"]) {
    await assert.rejects(docs.fetch(ref), /Refused doc path/, ref);
  }
  const line = await logs.fetch("log:file:app.log#L2");
  assert.equal(line?.timestamp, "2026-11-10T09:01:00.000Z");
});

test("connector source code contains no filesystem writes or writing HTTP methods", () => {
  const root = path.join(process.cwd(), "connectors");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) files.push(full);
    }
  };
  walk(root);
  assert.ok(files.length >= 15);
  const fsWrite = /\bfs\.(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|createWriteStream|chmod|chmodSync|chown|chownSync|truncate|truncateSync|symlink|symlinkSync|link|linkSync|writeSync|write)\b/;
  const openWrite = /\bfs\.openSync\([^)]*["'][wa+]/;
  const promisesImport = /from\s+["'](node:)?fs\/promises["']/;
  const httpWrite = /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);
    assert.doesNotMatch(src, fsWrite, `${rel} writes to the filesystem`);
    assert.doesNotMatch(src, openWrite, `${rel} opens a file for writing`);
    assert.doesNotMatch(src, promisesImport, `${rel} imports fs/promises`);
    assert.doesNotMatch(src, httpWrite, `${rel} sends a writing HTTP method`);
  }
});

test("connector evidence maps onto an engine evidence record with its citation fields", async () => {
  const { github } = build();
  const item = await github.readFile("acme/happy-moments", "src/feed.ts", { startLine: 2, endLine: 3 });
  const record = evidenceItemToRecord(item, "run_x");
  assert.equal(record.type, "source");
  assert.equal(record.origin, "connector");
  assert.equal(record.id, `ext:run_x:${item.ref}`);
  const body = record.body as { path: string; startLine: number; endLine: number; excerpt: string };
  assert.deepEqual([body.path, body.startLine, body.endLine], ["src/feed.ts", 2, 3]);
  assert.equal(body.excerpt, "line 2\nline 3");
});
