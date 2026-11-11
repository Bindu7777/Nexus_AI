export class CatalogError extends Error {
  status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "CatalogError";
    this.status = status;
  }
}

export function catalogUrlFromEnv() {
  return process.env.CATALOG_URL ?? "http://127.0.0.1:4318";
}

export async function catalogJson(baseUrl: string, path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new CatalogError(`Catalog sandbox is not reachable at ${baseUrl}. ${detail}`, null);
  }

  const text = await response.text();
  let data: { error?: string; message?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text) as { error?: string; message?: string };
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!response.ok) {
    throw new CatalogError(data.error ?? data.message ?? `Catalog returned HTTP ${response.status}`, response.status);
  }
  return data;
}
