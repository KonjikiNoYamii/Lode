import { getProfile } from "./db";

export interface ChatItem {
  role: "system" | "user" | "assistant";
  content: string;
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
  opts: { stream?: boolean } = {},
): Promise<Response> {
  const profile = getProfile();
  const body: Record<string, unknown> = { messages };
  if (opts.stream) body.stream = true;
  if (profile.ai_model) body.model = profile.ai_model;

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
): Promise<ReadableStream<Uint8Array>> {
  const res = await callGemini(messages, { stream: true });
  if (!res.body) {
    throw new Error("Gemini server tidak mengirim stream");
  }
  return res.body;
}