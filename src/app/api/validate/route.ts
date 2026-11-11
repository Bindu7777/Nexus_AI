import { catalogUrlFromEnv } from "@/lib/catalog-client";
import { assertCanValidate } from "@/lib/diagnosis";
import { runValidation } from "@/lib/engine";
import { getStore, trackJob } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { runId?: string; confirmation?: string };
  const store = getStore();
  const run = body.runId ? store.runs.get(body.runId) : undefined;
  const gate = assertCanValidate(run, body.confirmation);
  if (!gate.ok || !run) {
    return Response.json({ message: gate.ok ? "Missing run." : gate.message }, { status: gate.ok ? 400 : gate.status });
  }
  run.status = "validating";
  run.validationError = null;
  const job = runValidation({ catalogUrl: catalogUrlFromEnv(), run });
  trackJob(run.id, job);
  return Response.json({ runId: run.id });
}
