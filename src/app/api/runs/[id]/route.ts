import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const run = getStore().runs.get(id);
  if (!run) {
    return Response.json({ message: "No investigation with that id is stored in this demo session." }, { status: 404 });
  }
  return Response.json(run);
}
