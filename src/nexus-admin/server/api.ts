// Shared plumbing for admin API routes: guard, JSON body, redacted errors.
import { type AdminContext, clientIp, jsonResponse, requireAdminApi } from "./auth";
import { actorOf } from "./auth";
import { redactText } from "./redact";

export type Handler = (ctx: AdminContext & { ip: string; actor: ReturnType<typeof actorOf> }, request: Request) => Promise<Response> | Response;

export async function adminRoute(request: Request, handler: Handler): Promise<Response> {
  const guard = requireAdminApi(request);
  if (guard instanceof Response) return guard;
  try {
    return await handler({ ...guard, ip: clientIp(request.headers), actor: actorOf(guard.admin) }, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return jsonResponse(400, { ok: false, error: redactText(message) });
  }
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 200_000) throw new Error("The request is too large.");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error("The request body was not valid JSON.");
  }
}

export const ok = (data: Record<string, unknown> = {}) => jsonResponse(200, { ok: true, ...data });
export const bad = (error: string, extra: Record<string, unknown> = {}, status = 400) => jsonResponse(status, { ok: false, error, ...extra });

export function idParam(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Unknown id.");
  return id;
}
