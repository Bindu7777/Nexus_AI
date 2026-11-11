import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return Response.json({ message: "Missing evidence id." }, { status: 400 });
  }
  const record = getStore().evidence.get(id);
  if (!record) {
    return Response.json(
      { message: "That evidence id is not in this demo session. Run the investigation again or reset." },
      { status: 404 },
    );
  }
  return Response.json(record, { headers: { "cache-control": "no-store" } });
}
