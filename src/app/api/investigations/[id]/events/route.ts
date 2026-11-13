import { portalJson, requirePortalApi } from "@/portal/server/auth";
import { findForCaller, investigationView } from "@/portal/server/investigations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Live progress as server-sent events. Sends the investigation whenever it
 * changes, and closes after it finishes. Reads the stored stage records, so it
 * works for any client (portal page, IDE plugin) and survives page reloads.
 */
export async function GET(request: Request, { params }: Ctx) {
  const ctx = requirePortalApi(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!findForCaller(ctx, id)) return portalJson(404, { ok: false, error: "Investigation not found." });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let last = "";
      let closed = false;
      let ticks = 0;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = () => {
        if (closed) return;
        const row = findForCaller(ctx, id);
        if (!row) return close();
        const view = investigationView(row);
        const body = JSON.stringify(view);
        if (body !== last) {
          last = body;
          controller.enqueue(encoder.encode(`event: update\ndata: ${body}\n\n`));
        } else if (++ticks % 20 === 0) {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }
        if (view.status === "done" || view.status === "failed" || view.status === "cancelled") {
          controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
          close();
        }
      };
      const timer = setInterval(send, 700);
      request.signal.addEventListener("abort", close);
      send();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
