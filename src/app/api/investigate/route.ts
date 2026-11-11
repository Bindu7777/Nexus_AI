import { catalogUrlFromEnv } from "@/lib/catalog-client";
import { createRun, runInvestigation } from "@/lib/engine";
import { getStore, trackJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { scenario?: string };
  const scenario = body.scenario === "outage" ? "outage" : "lock";
  const store = getStore();
  const run = createRun(scenario);
  store.runs.set(run.id, run);
  const job = runInvestigation({ catalogUrl: catalogUrlFromEnv(), store, run });
  trackJob(run.id, job);
  return Response.json({ runId: run.id });
}
