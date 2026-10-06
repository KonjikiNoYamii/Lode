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
export async function downloadConversation(id: number): Promise<any> {
  const r = await fetch(`/api/conversations/${id}/export`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
export async function forkConversation(id: number): Promise<{ id: number; warnings?: string[] }> {
  const r = await fetch(`/api/conversations/${id}/fork`, { method: "POST" });
  if (!r.ok) {
    let msg = "";
    try { const j = (await r.json()) as { error?: string }; msg = j.error ?? ""; } catch {}
    throw new Error(msg || `Gagal fork (${r.status})`);
  }
  return r.json() as Promise<{ id: number; warnings?: string[] }>;
}
export async function importConversation(payload: any): Promise<{ id: number; warnings?: string[] }> {
  const r = await fetch("/api/conversations/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let msg = "";
    try { const j = (await r.json()) as { error?: string }; msg = j.error ?? ""; } catch {}
    throw new Error(msg || `Gagal import (${r.status})`);
  }
  return r.json() as Promise<{ id: number; warnings?: string[] }>;
}

export async function forkCleanConversation(id: number): Promise<{ id: number; warnings?: string[] }> {
  const r = await fetch(`/api/conversations/${id}/fork-clean`, { method: "POST" });
  if (!r.ok) {
    let msg = "";
    try { const j = (await r.json()) as { error?: string }; msg = j.error ?? ""; } catch {}
    throw new Error(msg || `Gagal fork bersih (${r.status})`);
  }
  return r.json() as Promise<{ id: number; warnings?: string[] }>;
}
