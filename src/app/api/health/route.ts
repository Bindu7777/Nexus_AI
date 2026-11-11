import { catalogJson, catalogUrlFromEnv } from "@/lib/catalog-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const catalogUrl = catalogUrlFromEnv();
  try {
    const catalog = await catalogJson(catalogUrl, "/health");
    return Response.json({ ok: true, catalogUrl, catalog });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        catalogUrl,
        catalog: { ok: false, error: error instanceof Error ? error.message : "Catalog health check failed." },
      },
      { status: 200 },
    );
  }
}
