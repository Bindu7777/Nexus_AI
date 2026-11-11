import { catalogUrlFromEnv } from "@/lib/catalog-client";
import { resetSandbox } from "@/lib/investigate";
import { clearStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await resetSandbox(catalogUrlFromEnv());
    clearStore();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "Reset failed." },
      { status: 502 },
    );
  }
}
