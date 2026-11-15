# Adding a connector

Every tool Nexus can read from is one file in `src/nexus-admin/connectors/defs/`.
The onboarding wizard, the company pages, the API, connection tests, health
checks and the audit trail all read that file. Adding a tool means adding one
file. No admin screen changes.

`npm run dev`, `npm run build`, `npm test` and `npm run typecheck` regenerate
`src/nexus-admin/connectors/index.generated.ts` from the folder automatically.
To regenerate by hand, run `npm run connectors:index`.

## What a definition declares

| Field | Meaning |
| --- | --- |
| `id` | Lowercase id, for example `testrail`. Stored with each company connector. |
| `category` | `code`, `defects`, `docs`, `database`, `logs`, `tests`, `design` or `services`. |
| `displayName`, `description` | Shown in the tool picker. |
| `status` | `available`, or `planned`. Planned connectors show as "coming soon": they can be recorded for a customer but never tested or made Active. |
| `tier` | Roadmap tier: `now`, `next` or `on-request`. |
| `deployments` | `cloud`, `self-hosted`, or both. Self-hosted adds a **Base URL** and an optional **custom CA certificate** field automatically. Turn either off with `selfHosted: { baseUrl: false, caCert: false }`. |
| `fields` | The connection form: `text`, `secret`, `url`, `list` (one per line), `select`, `number`, `checkbox`, `email`, `certificate`. Each has a label, help text and optional `validate`. Fields of type `secret` are write-only: after saving, the admin sees only "Saved on …, last tested OK" with a Replace button, and the value is never returned by the API or written to logs. Every secret field shows "Use a read-only account or token." |
| `scopeFields` | What Nexus may read: repositories, project keys, spaces, schemas, log streams. At least one must be `required`, so "everything" is never the default. |
| `capabilities` | Always `readOnly: true`, plus `reads` (what it reads) and `transport` (`http`, `database`, `files` or `none`). The test runner adds a read-only proof for the transport. A `database` connector must return its own proof that a write was refused. |
| `targets(ctx)` | Hosts or URLs the test contacts. They're checked against private, loopback and cloud-metadata addresses first, unless the admin ticks "allow a private address". |
| `test(ctx)` | A read-only check. Return `{ ok, reached, problems, warnings }`. `reached` lists plain facts ("12 repositories reachable"). Each entry in `problems` says what to fix. |
| `build(ctx)` | Optional. Returns the read-only `Connector` the engine uses for evidence. |
| `setupHelp(values)` | Optional. Instructions shown beside the form, for example SQL for a read-only role. |

`ctx` gives the deployment, the validated `config` and `scope`, the decrypted
`secrets` (server-side only), `baseUrl`, `caCert`, a `fetchImpl` that trusts the
custom CA, and `siblingSecret(registryId, field)` for reusing another
connector's token.

## The rules a definition must follow

These are enforced when the registry loads, and again by `tests/nexus-admin/connectors.test.ts`:

- `capabilities.readOnly` is `true`.
- The only function members allowed are `test`, `build`, `targets`, `validate` and `setupHelp`. A definition with a method such as `createIssue` is rejected.
- HTTP goes through `createReadOnlyHttp` from `connectors/http.ts`, which sends GET or HEAD only and refuses a request body. The contract test runs every available connector's `test()` against a recording fetch and fails on any other method.
- Databases connect with a read-only role and run every query inside `BEGIN TRANSACTION READ ONLY ... ROLLBACK`.
- Scope is required.

## Worked example: TestRail (read-only)

TestRail ships today as a planned entry. To make it work, replace
`src/nexus-admin/connectors/defs/testrail.ts` with:

```ts
import { createReadOnlyHttp, redact } from "../../../../connectors/http";
import { asList } from "../form";
import { allowInternalField, defineConnector } from "../types";

export default defineConnector({
  id: "testrail",
  category: "tests",
  displayName: "TestRail",
  description: "Test cases, runs and results (read-only).",
  status: "available",
  tier: "next",
  deployments: ["cloud", "self-hosted"],
  selfHosted: { baseUrlLabel: "TestRail URL", baseUrlPlaceholder: "https://testrail.example.internal" },
  fields: [
    { name: "siteUrl", label: "Site URL", type: "url", required: true, placeholder: "https://acme.testrail.io", deployments: ["cloud"] },
    { name: "email", label: "Account email", type: "email", required: true },
    { name: "token", label: "API key", type: "secret", required: true, help: "For a user with read access to the projects below." },
    allowInternalField,
  ],
  scopeFields: [{ name: "projects", label: "Project ids", type: "list", required: true, placeholder: "3\n7" }],
  capabilities: { readOnly: true, reads: ["test cases", "test runs", "results"], transport: "http" },
  targets: (ctx) => [{ url: String(ctx.deployment === "cloud" ? ctx.config.siteUrl : ctx.baseUrl) }],
  test: async (ctx) => {
    const base = String(ctx.deployment === "cloud" ? ctx.config.siteUrl : ctx.baseUrl);
    const auth = `Basic ${Buffer.from(`${ctx.config.email}:${ctx.secrets.token}`).toString("base64")}`;
    const http = createReadOnlyHttp({ fetchImpl: ctx.fetchImpl, secrets: [ctx.secrets.token, auth], baseHeaders: { authorization: auth } });
    const result = { ok: false, reached: [] as string[], problems: [] as string[], warnings: [] as string[] };
    try {
      for (const id of asList(ctx.scope.projects)) {
        const p = await http.getJson<{ name?: string }>(`${base}/index.php?/api/v2/get_project/${encodeURIComponent(id)}`);
        if (p.status === 200) result.reached.push(`Project ${id} (${p.data?.name})`);
        else result.problems.push(`Project ${id} is not visible to this account (HTTP ${p.status}).`);
      }
      result.ok = result.problems.length === 0;
    } catch (error) {
      result.problems.push(redact(error instanceof Error ? error.message : String(error), [ctx.secrets.token, auth]));
    }
    return result;
  },
});
```

That's all. Restart `npm run dev`. TestRail now appears under **Tests** in the
tool picker with its fields, a Test button, health checks and audit events. No
screen, route or table changed.

`tests/nexus-admin/connectors.test.ts` proves this with a made-up connector. It
adds a definition to the registry and takes it through validation, saving, a
first test (becoming Active), a held change, one-click rotation, check history,
the audit trail, and a search for leaked secrets. It doesn't touch any other code.
