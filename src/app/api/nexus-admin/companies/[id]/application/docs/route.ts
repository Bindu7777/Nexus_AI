import { adminRoute, bad, body, idParam, ok } from "@/nexus-admin/server/api";
import { addDocFile, addDocLink, MAX_UPLOAD_BYTES } from "@/nexus-admin/server/application";
import { getCompany } from "@/nexus-admin/server/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Add documentation. JSON { title, url, notes } records a link.
 * multipart/form-data with "file" (and optional "title", "notes") uploads a file.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return adminRoute(request, async (ctx, req) => {
    const companyId = idParam(id);
    if (!getCompany(companyId)) return bad("Company not found.", {}, 404);
    const type = req.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      const length = Number(req.headers.get("content-length") ?? 0);
      if (length > MAX_UPLOAD_BYTES + 64 * 1024) return bad(`Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, {}, 413);
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return bad("Choose a file to upload.");
      const result = addDocFile(
        companyId,
        { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
        { title: String(form.get("title") ?? ""), notes: String(form.get("notes") ?? "") },
        ctx.actor,
        ctx.ip,
      );
      return result.ok ? ok({ id: result.id }) : bad(result.error);
    }
    const result = addDocLink(companyId, await body(req), ctx.actor, ctx.ip);
    return result.ok ? ok({ id: result.id }) : bad("Check the highlighted fields.", { fields: result.errors });
  });
}
