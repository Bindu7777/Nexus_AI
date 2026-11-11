// Stores pilot requests in a local file. No email, no third-party service.
// Personal details are never written to the console or to logs.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pilotSchema } from "@/marketing/pilot-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE = process.env.PILOT_STORE ?? path.join(process.cwd(), ".data", "pilot-requests.jsonl");
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

type Bucket = { count: number; resetAt: number };
const buckets = ((globalThis as { __nexusPilotBuckets?: Map<string, Bucket> }).__nexusPilotBuckets ??= new Map());

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "local";
}

function limited(key: string) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > MAX_PER_WINDOW;
}

export async function POST(request: Request) {
  if (limited(clientKey(request))) {
    return Response.json({ ok: false, error: "Too many requests. Please try again in a few minutes." }, { status: 429 });
  }
  const raw = await request.json().catch(() => null);
  const parsed = pilotSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    // Honeypot hits look like success to the bot and store nothing.
    if (raw && typeof raw === "object" && "website" in raw && (raw as { website?: unknown }).website) {
      return Response.json({ ok: true });
    }
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fields[key] ??= issue.message;
    }
    return Response.json({ ok: false, fields }, { status: 400 });
  }
  const { website: _honeypot, ...data } = parsed.data;
  void _honeypot;
  try {
    await mkdir(path.dirname(STORE), { recursive: true });
    await appendFile(STORE, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...data })}\n`, { mode: 0o600 });
  } catch {
    return Response.json({ ok: false, error: "We could not save your request. Please email us instead." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
