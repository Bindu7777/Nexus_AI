import { adminRoute, bad, idParam, ok } from "@/nexus-admin/server/api";
import { readDocFile, removeDoc } from "@/nexus-admin/server/application";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; docId: string }> };

/** Download an uploaded document. Always as an attachment, never rendered inline. */
export async function GET(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, () => {
    const file = readDocFile(idParam(p.id), idParam(p.docId));
    if (!file) return bad("Document not found.", {}, 404);
    const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "content-type": file.mime,
        "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const p = await params;
  return adminRoute(request, (ctx) => {
    removeDoc(idParam(p.id), idParam(p.docId), ctx.actor, ctx.ip);
    return ok();
  });
}
