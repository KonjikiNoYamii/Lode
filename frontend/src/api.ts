import type { State } from "./types";

export async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<T>;
}

export async function send<T>(
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let msg = "";
    try {
      const j = (await r.json()) as { error?: string };
      msg = j.error ?? "";
    } catch {
      // bukan JSON
    }
    throw new Error(msg || `Gagal ${method} ${url} (${r.status})`);
  }
  return r.json() as Promise<T>;
}

export const loadState = () => get<State>("/api/state");