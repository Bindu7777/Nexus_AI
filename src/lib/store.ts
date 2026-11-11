import type { EvidenceRecord, RunRecord } from "./types";

export type DemoStore = {
  runs: Map<string, RunRecord>;
  evidence: Map<string, EvidenceRecord>;
};

export function createStore(): DemoStore {
  return { runs: new Map(), evidence: new Map() };
}

export function getStore() {
  const globalStore = globalThis as typeof globalThis & { __nexusDemoStore?: DemoStore };
  if (!globalStore.__nexusDemoStore) globalStore.__nexusDemoStore = createStore();
  return globalStore.__nexusDemoStore;
}

export function clearStore(store = getStore()) {
  store.runs.clear();
  store.evidence.clear();
}

export function trackJob(runId: string, job: Promise<unknown>) {
  const globalJobs = globalThis as typeof globalThis & { __nexusDemoJobs?: Map<string, Promise<unknown>> };
  if (!globalJobs.__nexusDemoJobs) globalJobs.__nexusDemoJobs = new Map();
  globalJobs.__nexusDemoJobs.set(runId, job);
}
