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

export interface MakeNoteResult {
  ok: boolean;
  files: string[];
  error?: string;
}

export async function makeNote(conversationId: number, messageId: number): Promise<MakeNoteResult> {
  const r = await fetch("/api/notes/make", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, messageId }),
  });
  if (!r.ok) {
    let msg = "";
    try { const j = (await r.json()) as { error?: string; detail?: string }; msg = j.error ?? ""; if (j.detail) msg += ` (${j.detail})`; } catch {}
    throw new Error(msg || `Gagal membuat catatan (${r.status})`);
  }
  return r.json() as Promise<MakeNoteResult>;
}

export interface ContinueResult {
  text: string;
  error: string;
}

// Stream sambungan jawaban AI untuk pesan yang terpotong. `onDelta` menerima
// teks kumulatif dari sambungan; `onReset` dipanggil ketika backend meminta
// pembuangan isi (Gemini menulis ulang jawaban).
export async function continueMessage(
  conversationId: number,
  messageId: number,
  signal?: AbortSignal,
  onDelta?: (text: string) => void,
  onReset?: () => void,
): Promise<ContinueResult> {
  const r = await fetch("/api/chat/continue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, messageId }),
    signal,
  });
  if (!r.ok) {
    let msg = "";
    try {
      const j = (await r.json()) as { error?: string; detail?: string };
      msg = j.error ?? "";
      if (j.detail) msg += ` (${j.detail})`;
    } catch {}
    throw new Error(msg || `Gagal menyambung jawaban (${r.status})`);
  }
  if (!r.body) throw new Error("Tidak ada respons dari server.");
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  const RESET_MARKER = "\n@@reset\n";
  let acc = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    if (signal?.aborted) return { text: "", error: "" };
    if (acc.includes(RESET_MARKER)) {
      const at = acc.lastIndexOf(RESET_MARKER);
      acc = acc.slice(at + RESET_MARKER.length);
      onReset?.();
    }
    onDelta?.(acc);
  }
  acc += decoder.decode();
  if (signal?.aborted) return { text: "", error: "" };
  let error = "";
  const withoutErrors = acc.replace(/\n?@@ai-error:([^\n]*)/g, (_match, enc: string) => {
    try { error = decodeURIComponent(enc); } catch { error = enc; }
    return "";
  });
  const text = withoutErrors
    .replace(/\n?@@mood:[a-z]+\s*/g, "")
    .replace(/\n?@@mode:[a-z]+\s*/g, "")
    .trim();
  return { text, error };
}
