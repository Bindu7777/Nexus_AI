// Nexus's own sandbox for the seeded demo company: the local catalog service
// and the frozen rule engine. Everything here runs inside Nexus (provenance
// "nexus-executed"); the IDE agent never measures, diagnoses or validates.
//
// It composes the engine's exported functions exactly as measureService()
// does, minus the server-side Jira read: in IDE mode the ticket comes from the
// engineer's own ticket tool. No engine rule, threshold or wording changes.
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { EvidenceItem } from "../../connectors/types";
import { engineRunEvidence, loadMeasurementsFromRun } from "../investigation/engine-adapter";
import type { TicketFull } from "../investigation/ticket";
import type { TicketExtra } from "./parsers";
import type { LoadMeasurements } from "../investigation/types";
import { applySandboxRemediation, createRun, runInvestigation, validateRemediation } from "../lib/engine";
import { getStore } from "../lib/store";
import { mapJiraIssue } from "../lib/tickets/jira";
import { resolveTicket } from "../lib/tickets/resolve";
import type { EngineTicket, EvidenceRecord, RunRecord } from "../lib/types";

export const SEEDED_TICKET = "NI-1042";
const DEMO_KEY = /^NEX-\d+$/;

/** Saved state of one sandbox run, so another Nexus process (the extension's) can approve it. */
export type SandboxSnapshot = { run: RunRecord; records: EvidenceRecord[] };

export type DemoMeasurement = {
  snapshot: SandboxSnapshot;
  evidence: EvidenceItem[];
  load: LoadMeasurements | null;
};

export interface Sandbox {
  /** The engine's view of a ticket when it belongs to the demo, else null. */
  engineTicket(key: string, ticket: TicketFull | null, extra?: TicketExtra | null): Promise<EngineTicket | null>;
  measure(ticket: EngineTicket): Promise<DemoMeasurement>;
  /** Applies the sandbox remediation with the engineer's confirmation and reruns the load. */
  applyAndValidate(snapshot: SandboxSnapshot, confirmation: string): Promise<
    | { ok: true; snapshot: SandboxSnapshot; evidence: EvidenceItem[] }
    | { ok: false; message: string; snapshot: SandboxSnapshot }
  >;
}

export const isDemoKey = (key: string) => key === SEEDED_TICKET || DEMO_KEY.test(key);

function asExecuted(items: EvidenceItem[]): EvidenceItem[] {
  return items.map((e) => ({ ...e, provenance: "nexus-executed" as const }));
}

function restore(snapshot: SandboxSnapshot) {
  const store = getStore();
  store.runs.set(snapshot.run.id, snapshot.run);
  for (const r of snapshot.records) store.evidence.set(r.id, r);
  return store;
}

function snapshotOf(runId: string): SandboxSnapshot {
  const store = getStore();
  const run = store.runs.get(runId)!;
  const records = run.evidence.map((e) => store.evidence.get(e.id)).filter((r): r is EvidenceRecord => Boolean(r));
  return { run: JSON.parse(JSON.stringify(run)) as RunRecord, records: JSON.parse(JSON.stringify(records)) as EvidenceRecord[] };
}

let child: ChildProcess | null = null;

async function healthy(url: string) {
  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

/** Starts the local demo catalog when it is not running. Local addresses only. */
export async function ensureCatalog(url: string, projectRoot: string) {
  if (await healthy(url)) return;
  const u = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error(`The sandbox catalog at ${url} is not answering.`);
  if (!child || child.exitCode !== null) {
    child = spawn(process.execPath, [path.join(projectRoot, "services/catalog/server.mjs")], {
      env: { ...process.env, CATALOG_PORT: u.port || "4318", CATALOG_HOST: "127.0.0.1" },
      stdio: "ignore",
    });
    child.unref();
    process.once("exit", () => child?.kill());
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await healthy(url)) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`The sandbox catalog did not start at ${url}.`);
}

export function createDemoSandbox(options: { catalogUrl: string; projectRoot: string; autoStart?: boolean }): Sandbox {
  const { catalogUrl, projectRoot } = options;
  return {
    async engineTicket(key, ticket, extra) {
      if (key === SEEDED_TICKET) return resolveTicket(SEEDED_TICKET, {});
      if (!DEMO_KEY.test(key) || !ticket) return null;
      // The same mapping the engine applies to a Jira issue, from the fields the IDE agent supplied.
      // An empty env: no Jira credentials are read.
      return mapJiraIssue(
        {
          key,
          fields: {
            summary: ticket.title,
            description: ticket.description,
            labels: ticket.labels,
            priority: ticket.priority ? { name: ticket.priority } : undefined,
            status: ticket.status ? { name: ticket.status } : undefined,
            created: ticket.createdAt ?? undefined,
            issuetype: extra?.issueType ? { name: extra.issueType } : undefined,
            project: extra?.projectKey ? { key: extra.projectKey } : undefined,
            reporter: extra?.reporter ? { displayName: extra.reporter } : undefined,
          },
        },
        {},
      );
    },
    async measure(ticket) {
      if (options.autoStart !== false) await ensureCatalog(catalogUrl, projectRoot);
      const scenarioName = ticket.sandboxScenario === "lock" || ticket.sandboxScenario === "outage" ? ticket.sandboxScenario : "lock";
      const store = getStore();
      const run = createRun(scenarioName);
      run.ticket = ticket;
      store.runs.set(run.id, run);
      await runInvestigation({ catalogUrl, store, run, projectRoot });
      if (run.status === "failed") throw new Error(run.error ?? "The sandbox measurement failed.");
      return { snapshot: snapshotOf(run.id), evidence: asExecuted(engineRunEvidence(run, store)), load: loadMeasurementsFromRun(run, store) };
    },
    async applyAndValidate(snapshot, confirmation) {
      if (options.autoStart !== false) await ensureCatalog(catalogUrl, projectRoot);
      const store = restore(snapshot);
      const applied = await applySandboxRemediation({ runId: snapshot.run.id, approvalToken: confirmation, catalogUrl, store });
      if (!applied.applied) return { ok: false, message: applied.message, snapshot };
      const validated = await validateRemediation({ runId: snapshot.run.id, catalogUrl, store });
      const after = snapshotOf(snapshot.run.id);
      if (!validated.ok) return { ok: false, message: validated.message, snapshot: after };
      return { ok: true, snapshot: after, evidence: asExecuted(engineRunEvidence(store.runs.get(snapshot.run.id)!, store)) };
    },
  };
}
