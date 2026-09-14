import { getProfile } from "./db";

export interface ChatItem {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiThread {
  cid: string;
  rid: string;
  rcid: string;
  metadata: string[];
}

export function parseAiThread(json: string): AiThread | null {
  if (!json) return null;
  try {
    const t = JSON.parse(json) as {
      cid?: string;
      rid?: string;
      rcid?: string;
      metadata?: (string | null)[];
    };
    if (!t || !t.cid) return null;
    const meta = Array.isArray(t.metadata)
      ? t.metadata.map((x) => (x == null ? null : String(x)))
      : [t.cid, t.rid, t.rcid];
    return {
      cid: String(t.cid),
      rid: String(t.rid ?? ""),
      rcid: String(t.rcid ?? ""),
      metadata: meta as string[],
    };
  } catch {
    return null;
  }
}

function buildHeaders(): Record<string, string> {
  const profile = getProfile();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (profile.ai_api_key) {
    headers["Authorization"] = `Bearer ${profile.ai_api_key}`;
  }
  return headers;
}

async function callGemini(
  messages: ChatItem[],
  opts: { stream?: boolean; thread?: AiThread | null; session?: string } = {},
): Promise<Response> {
  const profile = getProfile();
  const body: Record<string, unknown> = { messages };
  if (opts.stream) body.stream = true;
  if (profile.ai_model) body.model = profile.ai_model;
  if (opts.thread) body.thread = opts.thread;
  if (opts.session) body.session = opts.session;

  const res = await fetch(`${profile.ai_base_url}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Gemini server (${profile.ai_base_url}) balas ${res.status}: ${detail.slice(0, 200)}`,
    );
  }
  return res;
}

export async function chatText(messages: ChatItem[]): Promise<string> {
  const res = await callGemini(messages);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Gemini server tidak mengembalikan jawaban");
  }
  return content;
}

export async function streamChat(
  messages: ChatItem[],
  thread?: AiThread | null,
  session?: string,
): Promise<ReadableStream<Uint8Array>> {
  const res = await callGemini(messages, { stream: true, thread, session });
  if (!res.body) {
    throw new Error("Gemini server tidak mengirim stream");
  }
  return res.body;
}