"use client";

import { createContext, useContext } from "react";

type AdminInfo = { csrf: string; name: string };
const Ctx = createContext<AdminInfo>({ csrf: "", name: "" });

export function AdminProvider({ csrf, name, children }: AdminInfo & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ csrf, name }}>{children}</Ctx.Provider>;
}

export const useAdmin = () => useContext(Ctx);

export type ApiResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string; fields?: Record<string, string> };

/** fetch() for admin APIs: same-origin, CSRF header, JSON in and out. */
export async function adminFetch<T = Record<string, unknown>>(csrf: string, url: string, method = "GET", payload?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    if (response.status === 401) {
      window.location.href = "/nexus-admin/login";
      return { ok: false, error: "Your session ended. Sign in again." };
    }
    const data = (await response.json().catch(() => ({}))) as ApiResult<T>;
    if (!response.ok && data.ok !== false) return { ok: false, error: `The server answered HTTP ${response.status}.` };
    return data;
  } catch {
    return { ok: false, error: "The Nexus server could not be reached." };
  }
}
