import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  addMemory,
  addMessage,
  countMessages,
  createConversation,
  createPlanItem,
  deleteConversation,
  deleteMemory,
  deletePlanItem,
  deleteTopic,
  getConversation,
  getFileRevision,
  getMessage,
  getProfile,
  getTopic,
  listConversations,
  listFileRevisions,
  listMemories,
  listMemoriesByConversation,
  listMessages,
  listPlanItems,
  listTopics,
  listTopicsByConversation,
  listWorkspaceFiles,
  movePlanItem,
  patchConversation,
  patchPlanItem,
  recordFileRevision,
  patchTopic,
  runMaintenance,
  updateProfile,
  upsertWorkspaceFile,
  writeTopic,
  type ConversationExportPayload,
  exportConversationContext,
  importConversationContext,
} from "../lib/db";
import {
  aiRequestHeaders,
  chatText,
  streamChat,
  type AiThread,
  type ChatItem,
} from "../lib/ai";
import { finalMood } from "../lib/mood";
import { buildPlanContext, stripPlanMarkers } from "../lib/plan";
import {
  buildModeContext,
  chooseMode,
  isLearnMode,
  normalizeMode,
  stripModeMarkers,
  type LearnMode,
} from "../lib/mode";
import { type FileRevision, type PlanStatus } from "../lib/db";
import { diffLines } from "../lib/diff";
import {
  buildMemoryUpdatePrompt,
  buildSystemPrompt,
  parseMemoryUpdate,
} from "../lib/memory";
import { buildNotePrompt } from "../lib/notes";
import {
  applyWorkspaceWrites,
  buildAuthoredFilesContext,
  restoreWorkspaceFile,
  buildWorkspaceContext,
  gatherFileDump,
  parseAgentBlocks,
  type WriteResult,
  pickFolder,
  readWorkspaceFile,
  scanWorkspace,
  workspaceInfo,
} from "../lib/workspace";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.BACKEND_HOST?.trim() || "127.0.0.1";
const AI_ERROR_MARKER = "@@ai-error:";
const DIST_PATH = path.resolve(
  process.env.FRONTEND_DIST ??
    path.join(process.cwd(), "..", "frontend", "dist"),
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

const READ_MARKER = /@@read\("([^"]+)"\)/g;

// Kadang provider (Gemini) keluar dengan penolakan template seperti "Saya hanya
// model bahasa" alih-alih menjawab sebagai mentor. Itu bukan jawaban valid:
// jangan ditampilkan/di-simpan, ulangi sekali.
const REFUSAL_PATTERNS = [
  /hanya (sebuah )?model bahasa/i,
  /cuma (sebuah )?model bahasa/i,
  /tidak dirancang untuk (itu|hal tersebut|hal ini)/i,
  /tidak diprogram untuk (itu|hal tersebut|hal ini|melakukan)/i,
  /saya tidak (bisa|dapat) (membantu|memahami|merespons)/i,
  /saya (bukan|hanya) (asisten|ai|kecerdasan buatan)/i,
  /\b(i am|i'm) (just )?(a|an) (language )?(model|ai)\b/i,
  /\bas an? (ai|language model)\b/i,
];

function looksLikeRefusal(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 400) return false;
  return REFUSAL_PATTERNS.some((re) => re.test(t));
}

function makeWriteFilter(): {
  fed: (delta: string) => string;
  end: () => string;
  reset: () => void;
} {
  let inBlock = false;
  let buf = "";
  return {
    fed(delta: string): string {
      buf += delta;
      let out = "";
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!inBlock) {
          const t = line.trim();
          if (t.startsWith("@@write(")) {
            inBlock = true;
            continue;
          }
          if (t.startsWith("@@mkdir(")) continue;
          if (t.startsWith("@@mood(")) continue;
          out += line + "\n";
        } else if (!line.trim().includes("@@end")) {
          // isi blok @@write disembunyikan dari tampilan
        } else {
          inBlock = false;
        }
      }
      return out;
    },
    end(): string {
      if (inBlock) {
        buf = "";
        return "";
      }
      const t = buf.trimStart();
      if (t.startsWith("@@write(") || t.startsWith("@@mkdir(") || t.startsWith("@@mood(")) {
        buf = "";
        return "";
      }
      const r = buf;
      buf = "";
      return r;
    },
    reset(): void {
      inBlock = false;
      buf = "";
    },
  };
}

function clampInt(value: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function sendJson(
  res: ServerResponse,
  status: number,
  obj: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(obj));
}

function readBody(req: IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > maxBytes) {
        reject(new Error("Request body terlalu besar"));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let chatQueue: Promise<void> = Promise.resolve();

function beginChatTurn(): { ready: Promise<void>; release: () => void } {
  const ready = chatQueue;
  let release = () => {};
  chatQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

function writeAiError(res: ServerResponse, message: string): void {
  if (!res.writableEnded) {
    res.write(`\n\n${AI_ERROR_MARKER}${encodeURIComponent(message)}\n`);
  }
}

async function forwardSse(
  upstream: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
  onReset?: () => void,
): Promise<{ text: string; streamError: string; thread: AiThread | null }> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let streamError = "";
  let thread: AiThread | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const j = JSON.parse(data) as {
            error?: string | { message?: string };
            thread?: AiThread;
            control?: string;
            choices?: { delta?: { content?: string } }[];
          };
          if (j.error) {
            streamError =
              typeof j.error === "string" ? j.error : j.error.message ?? "";
            continue;
          }
          if (j.control === "reset") {
            text = "";
            onReset?.();
            continue;
          }
          if (j.thread) {
            thread = j.thread;
            continue;
          }
          const delta = j.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            text += delta;
            onDelta(delta);
          }
        } catch {
          // baris SSE tidak lengkap / bukan JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { text, streamError, thread };
}

function extractMarkers(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = READ_MARKER.exec(text))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

function stripMarkers(
  text: string,
  planSink?: Map<number, PlanStatus>,
  modeSink?: Map<LearnMode, LearnMode>,
): string {
  const base = stripModeMarkers(
    text
      .replace(/@@read\("[^"]*"\)/g, "")
      .replace(/@@mood\("[^"]*"\)/g, ""),
    modeSink,
  );
  return stripPlanMarkers(base, planSink);
}

const MARKER_NAMES = [
  "read",
  "write",
  "mkdir",
  "mood",
  "mode",
  "plan",
  "files",
  "end",
];
const MARKER_TAIL_MAX = 200;

/** True kalau `tail` bisa jadi awal marker Lode (mis. "@@mo", "@@read(\"a"). */
function looksLikeMarker(tail: string): boolean {
  const m = /^@@([a-z]*)/i.exec(tail);
  if (!m) return false;
  const name = m[1];
  if (!name) return true;
  return MARKER_NAMES.some((n) => n.startsWith(name) || name.startsWith(n));
}

/**
 * Strip marker Lode dari delta streaming. Panjang marker bisa melebihi satu
 * chunk, jadi potongan ekor yang masih mungkin jadi awal marker ditahan dulu
 * supaya tidak pernah bocor mentah ke layar. `flush()` mengembalikan sisa
 * yang ditahan saat stream selesai.
 */
function createMarkerStripper(
  planSink?: Map<number, PlanStatus>,
  modeSink?: Map<LearnMode, LearnMode>,
): { feed: (delta: string) => string; flush: () => string; reset: () => void } {
  let hold = "";
  const splitTail = (t: string): { emit: string; hold: string } => {
    const at = t.lastIndexOf("@@");
    if (at === -1) return { emit: t, hold: "" };
    const tail = t.slice(at);
    if (tail.length > MARKER_TAIL_MAX) return { emit: t, hold: "" };
    if (!looksLikeMarker(tail)) return { emit: t, hold: "" };
    if (tail.includes(")")) return { emit: t, hold: "" }; // marker sudah tutup
    return { emit: t.slice(0, at), hold: tail };
  };
  return {
    feed(delta: string): string {
      const { emit, hold: next } = splitTail(hold + delta);
      hold = next;
      return stripMarkers(emit, planSink, modeSink);
    },
    flush(): string {
      const rest = hold;
      hold = "";
      return stripMarkers(rest, planSink, modeSink);
    },
    reset(): void {
      hold = "";
    },
  };
}

function effectiveModeFor(
  conversationId: number,
  conv: { mode: string; ai_mode: string; folder: string },
): LearnMode {
  const topics = listTopicsByConversation(conversationId);
  const choice = chooseMode({
    message: "",
    mode: normalizeMode(conv.mode),
    aiMode: conv.ai_mode,
    hasFolder: Boolean(conv.folder),
    stuckCount: topics.filter((t) => t.status === "stuck").length,
    mastery: topics.reduce((max, t) => Math.max(max, t.mastery), 0),
  });
  return choice.mode === "auto" ? "konsep" : choice.mode;
}

/**
 * Catat isi lama setiap file yang berubah supaya bisa di-undo dari panel riwayat.
 * Folder baru (rel berakhiran "/") dan file yang isinya sama tidak dicatat.
 */
function recordFileWrites(
  conversationId: number,
  results: WriteResult[],
  source = "lode",
): number {
  let saved = 0;
  for (const r of results) {
    if (r.error || r.rel.endsWith("/") || !r.changed || r.next === undefined) continue;
    const stat = diffLines(r.prev ?? "", r.next);
    recordFileRevision({
      conversationId,
      rel: r.rel,
      prev: r.prev ?? null,
      next: r.next,
      added: stat.added,
      removed: stat.removed,
      source,
    });
    saved += 1;
  }
  return saved;
}

function summarizeRevision(rev: FileRevision) {
  const { content, ...rest } = rev;
  return { ...rest, preview: content.slice(0, 4000) };
}

async function forgetGeminiSession(sessionId: string): Promise<boolean> {
  const profile = getProfile();
  const base = profile.ai_base_url.replace(/\/v1\/?$/, "");
  const headers = aiRequestHeaders();
  try {
    const r = await fetch(`${base}/v1/sessions/delete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session: sessionId }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function serveStatic(res: ServerResponse, urlPath: string): void {
  const base = path.resolve(DIST_PATH);
  let file: string;
  if (urlPath === "/") {
    file = path.join(base, "index.html");
  } else {
    file = path.join(base, urlPath);
  }
  if (!file.startsWith(base)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(file)) file = path.join(base, "index.html");
  if (!existsSync(file)) {
    sendJson(res, 404, {
      error:
        "Frontend belum di-build. Jalankan: npm --prefix frontend run build",
    });
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[lode] unexpected error:", msg);
    if (!res.headersSent) sendJson(res, 500, { error: msg });
    else {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  }
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  // ---------- POST /api/chat (streaming + agent read) ----------
  if (method === "POST" && p === "/api/chat") {
    const body = await readJson(req);
    const message = String(body.message ?? "").trim();
    if (!message) return sendJson(res, 400, { error: "Pesan kosong" });

    const requestedCid =
      body.conversationId === undefined || body.conversationId === null || body.conversationId === ""
        ? 0
        : Number(body.conversationId);
    if (!Number.isSafeInteger(requestedCid) || requestedCid < 0) {
      return sendJson(res, 400, { error: "conversationId tidak valid" });
    }

    const chatTurn = beginChatTurn();
    await chatTurn.ready;
    if (res.destroyed) {
      chatTurn.release();
      return;
    }
    res.once("finish", chatTurn.release);
    res.once("close", chatTurn.release);
    let cid = requestedCid;
    let title: string | null = null;
    let folder = "";
    let resumeSession = "";
    if (!cid) {
      title = message.length > 36 ? `${message.slice(0, 36)}…` : message;
      folder = String(getProfile().workspace ?? "").trim();
      resumeSession = randomUUID();
      cid = createConversation(title, folder, resumeSession);
    } else {
      const conv = getConversation(cid);
      if (!conv) {
        return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
      }
      folder = String(conv.folder ?? "").trim();
      if (String(conv.ai_thread ?? "").trim()) {
        patchConversation(cid, { ai_thread: "" });
      }
      resumeSession = String(conv.ai_session ?? "").trim();
      if (!resumeSession) {
        resumeSession = randomUUID();
        patchConversation(cid, { ai_session: resumeSession });
      }
    }
    addMessage(cid, "user", message);

    const profile = getProfile();
    const topics = listTopicsByConversation(cid);
    const memories = listMemoriesByConversation(cid);
    const ACTIVE_CHAT_WINDOW = 50;
    const history = listMessages(cid).slice(-ACTIVE_CHAT_WINDOW);

    const conv = getConversation(cid);
    const modeChoice = chooseMode({
      message,
      mode: normalizeMode(conv?.mode),
      aiMode: conv?.ai_mode ?? "",
      hasFolder: Boolean(folder),
      stuckCount: topics.filter((t) => t.status === "stuck").length,
      mastery: topics.reduce((max, t) => Math.max(max, t.mastery), 0),
    });
    const turnMode: LearnMode = modeChoice.mode === "auto" ? "konsep" : modeChoice.mode;

    const wsMaxDepth = clampInt(profile.ws_max_depth, 1, 12, 7);
    const wsMaxFiles = clampInt(profile.ws_max_files, 10, 3000, 350);
    const wsAutoKb = clampInt(profile.ws_auto_kb, 0, 5000, 0);
    const allowWrite = profile.ws_allow_write !== 0;

    let workspaceCtx = "";
    if (folder) {
      try {
        workspaceCtx = await buildWorkspaceContext(folder, {
          maxDepth: wsMaxDepth,
          maxEntries: wsMaxFiles,
          autoDumpKB: wsAutoKb,
        });
      } catch {
        workspaceCtx = `[Folder workspace "${folder}" tidak bisa dibaca — pastikan path-nya benar.]`;
      }
    }

    let authoredCtx = "";
    if (folder) {
      const records = listWorkspaceFiles(cid);
      try {
        authoredCtx = await buildAuthoredFilesContext(
          folder,
          records.map((r: any) => r.rel),
        );
      } catch {
        authoredCtx = "";
      }
    }

    const planItems = listPlanItems(cid);
    const planIds = new Set(planItems.map((i: any) => i.id));

    const system = buildSystemPrompt(
      profile,
      topics,
      memories,
      workspaceCtx || "",
      allowWrite,
      authoredCtx,
      buildPlanContext(planItems),
      buildModeContext(turnMode, modeChoice.reason, modeChoice.locked),
    );

    const planSink = new Map<number, PlanStatus>();
    const modeSink = new Map<LearnMode, LearnMode>();

    const round1Payload = (): ChatItem[] => {
      const items: ChatItem[] = [{ role: "system", content: system }];
      for (const m of history) items.push({ role: m.role, content: m.content });
      return items;
    };
    const round2Payload = (extra: string): ChatItem[] => {
      const items: ChatItem[] = [{ role: "system", content: system }];
      for (const m of history) items.push({ role: m.role, content: m.content });
      items.push({ role: "user", content: extra });
      return items;
    };

    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Conversation-Id": String(cid),
    };
    if (title) headers["X-Conversation-Title"] = encodeURIComponent(title);

    const clientAbort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) clientAbort.abort();
    });

    const getUpstream = async (): Promise<ReadableStream<Uint8Array>> => {
      try {
        return await streamChat(
          round1Payload(),
          null,
          resumeSession,
          clientAbort.signal,
        );
      } catch (err) {
        throw new Error(
          "Tidak bisa terhubung ke server AI. Pastikan server AI kamu jalan & konfigurasinya benar.",
        );
      }
    };

    let upstream: ReadableStream<Uint8Array>;
    try {
      upstream = await getUpstream();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(
        res,
        502,
        {
          error:
            "Tidak bisa terhubung ke server AI. Pastikan server AI kamu jalan & konfigurasinya benar.",
          detail: msg,
        },
        title
          ? {
              "X-Conversation-Id": String(cid),
              "X-Conversation-Title": encodeURIComponent(title),
            }
          : { "X-Conversation-Id": String(cid) },
      );
    }

    res.writeHead(200, headers);

    // Round 1 — buffer awal untuk deteksi marker @@read, lalu stream bila aman
    const parseRound1 = (
      up: ReadableStream<Uint8Array>,
    ): Promise<{
      full: string;
      streamError: string;
      mode: "collect" | "stream";
      markers: Set<string>;
      thread: AiThread | null;
      committed: boolean;
    }> =>
      new Promise((resolve, reject) => {
        const reader = up.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        let streamError = "";
        let mode: "collect" | "stream" = "collect";
        let thread: AiThread | null = null;
        // true begitu ada byte jawaban yang keluar ke klien. Setelah itu
        // jawaban round 1 dianggap final dan TIDAK BOLEH diulang lewat round 2.
        let committed = false;
        const markers = new Set<string>();
        const detectMarkers = (txt: string) => {
          let m: RegExpExecArray | null;
          const re = /@@read\("([^"]+)"\)/g;
          while ((m = re.exec(txt))) markers.add(m[1]);
        };
        const run = async () => {
          try {
            const flt = makeWriteFilter();
            const strip = createMarkerStripper(planSink, modeSink);
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const raw of lines) {
                const line = raw.trim();
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (!data || data === "[DONE]") continue;
                try {
                  const j = JSON.parse(data) as {
                    error?: string | { message?: string };
                    thread?: AiThread;
                    control?: string;
                    choices?: { delta?: { content?: string } }[];
                  };
                  if (j.error) {
                    streamError =
                      typeof j.error === "string"
                        ? j.error
                        : j.error.message ?? "Unknown";
                    continue;
                  }
                  if (j.control === "reset") {
                    // Gemini mengulang jawaban dari awal — buang isi lama
                    // supaya tidak tampil dua kali.
                    full = "";
                    markers.clear();
                    flt.reset();
                    strip.reset();
                    if (!res.writableEnded) res.write("\n@@reset\n");
                    continue;
                  }
                  if (j.thread) {
                    thread = j.thread;
                    continue;
                  }
                  const delta = j.choices?.[0]?.delta?.content ?? "";
                  if (!delta) continue;
                  full += delta;

                  if (mode === "stream") {
                    res.write(flt.fed(strip.feed(delta)));
                    continue;
                  }

                  // Hanya boleh deteksi marker SEBELUM jawaban dikirim. Kalau
                  // marker @@read muncul setelah teks sudah keluar ke layar,
                  // memaksa round 2 akan membuat Lode menjawab pertanyaan yang
                  // sama dua kali.
                  detectMarkers(full);
                  if (markers.size > 0) {
                    continue; // tahan jawaban, siapkan round 2
                  }
                  if (full.length >= 1024 || /\n\n/.test(full)) {
                    mode = "stream"; // aman, mulai streaming
                    committed = true;
                    res.write(flt.fed(strip.feed(full)));
                  }
                } catch {
                  // baris SSE tidak lengkap / bukan JSON
                }
              }
            }
            if (mode === "stream" && !res.writableEnded) {
              res.write(flt.fed(strip.flush()));
              res.write(flt.end());
            }
            resolve({ full, streamError, mode, markers, thread, committed });
          } catch (err) {
            streamError = err instanceof Error ? err.message : "Stream terputus";
            resolve({ full, streamError, mode, markers, thread, committed });
          } finally {
            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
          }
        };
        void run();
      });

    let r1thread: AiThread | null = null;
    const round1 = await parseRound1(upstream);
    if (round1.thread) r1thread = round1.thread;
    let providerError = round1.streamError;

    let parsed = parseAgentBlocks(round1.full);

    // Guard penolakan provider: hanya berlaku kalau jawaban belum terkirim ke
    // klien (mode collect) dan belum ada marker aktivitas. Ulangi sekali dengan
    // payload yang sama; kalau tetap menolak, laporkan sebagai error.
    if (
      !round1.committed &&
      round1.markers.size === 0 &&
      !round1.streamError &&
      !clientAbort.signal.aborted &&
      looksLikeRefusal(parsed.clean)
    ) {
      try {
        const retryUpstream = await streamChat(
          round1Payload(),
          r1thread,
          resumeSession,
          clientAbort.signal,
        );
        // Tahan dulu (jangan stream ke klien) supaya kalau percobaan kedua pun
        // menolak, teks penolakan tidak sempat tampil.
        const rr = await forwardSse(retryUpstream, () => {});
        if (rr.thread) r1thread = rr.thread;
        if (rr.streamError) providerError = rr.streamError;
        const retryParsed = parseAgentBlocks(rr.text);
        if (retryParsed.clean.trim() && !looksLikeRefusal(retryParsed.clean)) {
          parsed = retryParsed;
          round1.full = rr.text;
          round1.mode = "stream";
          round1.committed = true;
          if (!res.writableEnded) {
            res.write(stripMarkers(retryParsed.clean, planSink, modeSink));
          }
        }
      } catch (err) {
        providerError = err instanceof Error ? err.message : "Ulangi jawaban gagal";
      }
      if (!providerError && looksLikeRefusal(parsed.clean)) {
        providerError =
          "Model AI menolak menjawab permintaan itu. Silakan ubah sedikit pertanyaannya lalu kirim ulang.";
      }
    }

    let writeNotes = "";
    let fileWrites = 0;
    const wantsWrites = parsed.writes.length > 0 || parsed.mkdirs.length > 0;
    if (wantsWrites) {
      if (folder && allowWrite) {
        const results = await applyWorkspaceWrites(folder, parsed);
        const ok = results.filter((r) => !r.error && !r.rel.endsWith("/"));
        const fail = results.filter((r) => r.error);
        for (const r of ok) upsertWorkspaceFile(cid, r.rel);
        fileWrites += recordFileWrites(cid, results);
        writeNotes =
          `\n[FILE/FOLDER DITULIS OLEH LODE: ${ok.length ? ok.map((r) => r.rel).join(", ") : "—"}]` +
          (fail.length
            ? `\n[GAGAL DITULIS: ${fail.map((r) => `${r.rel} (${r.error})`).join("; ")}]`
            : "");
      } else if (!folder) {
        writeNotes =
          "\n[Workspace belum diarahkan ke percakapan ini — berkas tidak dibuat. Ingatkan pelajar untuk set folder lewat tombol Folder.]";
      } else {
        writeNotes = "\n[Izin menulis Lode nonaktif di Settings — berkas tidak dibuat.]";
      }
    }

    if (round1.mode === "collect" && round1.markers.size === 0 && round1.full.trim()) {
      // jawaban pendek tanpa marker — belum sempat di-stream
      if (!res.writableEnded) res.write(stripMarkers(parsed.clean, planSink, modeSink));
    }

    let finalText = stripMarkers(parsed.clean, planSink, modeSink).trim();

    // Round 2 hanya aman kalau jawaban round 1 belum sempat keluar ke layar.
    if (round1.markers.size > 0 && !round1.committed) {
      const rels = [...round1.markers];
      let dump = "";
      if (folder) {
        dump = await gatherFileDump(folder, rels);
      } else {
        dump =
          "\n[Folder workspace belum diarahkan ke percakapan ini. Bilang ke pelajar untuk men-set folder di tombol folder.]";
      }
      try {
        const extra = `Pelajar meminta kamu membaca file. Gunakan isi file di bawah.\n${dump}${writeNotes}\n\nJawab pertanyaan pelajar sekarang memakai isi file itu. JANGAN menulis marker @@read lagi${wantsWrites ? " (berkas sudah diproses, jangan tulis blok @@write lagi)" : ""}.`;
        const round2 = await streamChat(
          round2Payload(extra),
          r1thread,
          resumeSession,
          clientAbort.signal,
        );
        const r2f = makeWriteFilter();
        const r2s = createMarkerStripper(planSink, modeSink);
        const r2 = await forwardSse(
          round2,
          (d) => {
            if (!res.writableEnded) res.write(r2f.fed(r2s.feed(d)));
          },
          () => {
            r2f.reset();
            r2s.reset();
            if (!res.writableEnded) res.write("\n@@reset\n");
          },
        );
        if (r2.thread) r1thread = r2.thread;
        if (!res.writableEnded) res.write(r2f.fed(r2s.flush()) + r2f.end());
        const r2Parsed = parseAgentBlocks(r2.text);
        if (folder && allowWrite && (r2Parsed.writes.length || r2Parsed.mkdirs.length)) {
          const results = await applyWorkspaceWrites(folder, r2Parsed);
          const ok = results.filter((r) => !r.error && !r.rel.endsWith("/"));
          const fail = results.filter((r) => r.error);
          for (const r of ok) upsertWorkspaceFile(cid, r.rel);
          fileWrites += recordFileWrites(cid, results);
          const note =
            `\n[FILE/FOLDER TAMBAHAN DITULIS: ${ok.length ? ok.map((r) => r.rel).join(", ") : "—"}]` +
            (fail.length
              ? `\n[GAGAL: ${fail.map((r) => `${r.rel} (${r.error})`).join("; ")}]`
              : "");
          finalText = `${stripMarkers(r2Parsed.clean, planSink, modeSink)}${note}`.trim() || finalText;
        } else {
          finalText = stripMarkers(r2Parsed.clean, planSink, modeSink).trim() || finalText;
        }
        if (r2.streamError) providerError = r2.streamError;
      } catch (err) {
        providerError = err instanceof Error ? err.message : "Gagal membaca file";
      }
      if (writeNotes) {
        finalText = `${finalText}\n> ${writeNotes.trim()}`.trim();
      }
    } else if (writeNotes) {
      finalText = `${finalText}\n> ${writeNotes.trim()}`.trim();
    }

    // round tambahan: pelajar minta membuat berkas, tapi Lode belum menulisnya
    const CREATE_VERB = /\b(buatkan?|buatin|bikin|create|generate|tuliskan?|simpan|tulis)\b/i;
    const FILE_TARGET = /\b(file|berkas|roadmap|folder|dir|skrip|script|\.\w{1,6})\b/i;
    const NO_CREATE = /(jangan|tldr|nggak?|tidak uta?sa?h|cukup|tanpa|skip|gausah|nggausah)/i;
    const askedCreate =
      !round1.streamError &&
      CREATE_VERB.test(message) &&
      FILE_TARGET.test(message) &&
      !NO_CREATE.test(message);
    if (
      askedCreate &&
      folder &&
      allowWrite &&
      parsed.writes.length === 0 &&
      parsed.mkdirs.length === 0 &&
      round1.markers.size === 0
    ) {
      try {
        const extra =
          "Pelajar meminta kamu membuat/menulis berkas di workspace, tapi jawabanmu tadi TIDAK berisi blok pembuatan berkas (file tidak jadi dibuat). SEKARANG keluarkan HANYA SATU blok:\n@@write(\"path/relatif/NamaBerkas.ext\")\n<isi berkas lengkap>\n@@end\nTanpa teks lain. Blok itu yang akan dieksekusi sistem untuk menulis berkas.";
        const round2 = await streamChat(
          round2Payload(extra),
          r1thread,
          resumeSession,
          clientAbort.signal,
        );
        const r2f = makeWriteFilter();
        const r2s = createMarkerStripper(planSink, modeSink);
        const r2 = await forwardSse(
          round2,
          (d) => {
            if (!res.writableEnded) res.write(r2f.fed(r2s.feed(d)));
          },
          () => {
            r2f.reset();
            r2s.reset();
            if (!res.writableEnded) res.write("\n@@reset\n");
          },
        );
        if (r2.thread) r1thread = r2.thread;
        if (!res.writableEnded) res.write(r2f.fed(r2s.flush()) + r2f.end());
        const r2p = parseAgentBlocks(r2.text);
        if (r2p.writes.length || r2p.mkdirs.length) {
          const results = await applyWorkspaceWrites(folder, r2p);
          const ok = results.filter((r) => !r.error);
          const fail = results.filter((r) => r.error);
          fileWrites += recordFileWrites(cid, results);
          const note =
            `\n\n> [Berkas ditulis oleh Lode: ${ok.length ? ok.map((r) => r.rel).join(", ") : "—"}]` +
            (fail.length
              ? `\n> [Gagal ditulis: ${fail.map((r) => `${r.rel} (${r.error})`).join("; ")}]`
              : "");
          if (!res.writableEnded) res.write(note.trim());
          finalText = `${finalText}\n${note}`.trim();
        } else {
          const msg = "\n\n> [Lode belum menulis berkas apa pun — minta lagi dengan format jelas.]";
          if (!res.writableEnded) res.write(msg.trim());
          finalText = `${finalText}\n${msg}`.trim();
        }
      } catch (err) {
        providerError = err instanceof Error ? err.message : "Gagal membuat berkas";
      }
    }

    // Guard kedua: Gemini kadang menulis jawaban benar dulu lalu menimpanya
    // dengan penolakan (streaming sudah terlanjur tampil, jadi round1.committed
    // true dan guard pertama terlewat). Ulangi sekali dan suruh klien membuang
    // teks refusal lewat marker reset.
    if (finalText && looksLikeRefusal(finalText) && !clientAbort.signal.aborted) {
      try {
        const retryUpstream = await streamChat(
          round1Payload(),
          r1thread,
          resumeSession,
          clientAbort.signal,
        );
        if (!res.writableEnded) res.write("\n@@reset\n");
        const rf = makeWriteFilter();
        const rs = createMarkerStripper(planSink, modeSink);
        const rr = await forwardSse(
          retryUpstream,
          (d) => {
            if (!res.writableEnded) res.write(rf.fed(rs.feed(d)));
          },
          () => {
            rf.reset();
            rs.reset();
            if (!res.writableEnded) res.write("\n@@reset\n");
          },
        );
        if (!res.writableEnded) res.write(rf.fed(rs.flush()) + rf.end());
        if (rr.thread) r1thread = rr.thread;
        if (rr.streamError) providerError = rr.streamError;
        const retryParsed = parseAgentBlocks(rr.text);
        if (retryParsed.clean.trim() && !looksLikeRefusal(retryParsed.clean)) {
          finalText = stripMarkers(retryParsed.clean, planSink, modeSink).trim();
          if (folder && allowWrite && (retryParsed.writes.length || retryParsed.mkdirs.length)) {
            const results = await applyWorkspaceWrites(folder, retryParsed);
            const ok = results.filter((r) => !r.error && !r.rel.endsWith("/"));
            for (const r of ok) upsertWorkspaceFile(cid, r.rel);
            fileWrites += recordFileWrites(cid, results);
          }
        } else {
          if (!res.writableEnded) res.write("\n@@reset\n");
          if (!providerError) {
            providerError =
              "Model AI menolak menjawab permintaan itu. Silakan ubah sedikit pertanyaannya lalu kirim ulang.";
          }
        }
      } catch (err) {
        providerError = err instanceof Error ? err.message : "Ulangi jawaban gagal";
      }
    }

    if (clientAbort.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }

    if (providerError) {
      writeAiError(res, providerError);
      if (!res.writableEnded) res.end();
      return;
    }

    const planUpdates = [...planSink.entries()].filter(([pid]) => planIds.has(pid));
    const aiMode = [...modeSink.values()].pop() ?? "";
    const effectiveMode: LearnMode =
      aiMode && isLearnMode(aiMode) && !modeChoice.locked ? aiMode : turnMode;
    if (aiMode && isLearnMode(aiMode)) {
      patchConversation(cid, { ai_mode: aiMode });
    }
    if (finalText && !res.writableEnded) {
      const { mood, clean: moodClean } = finalMood(finalText);
      finalText = moodClean.trim();
      if (finalText) {
        addMessage(cid, "assistant", finalText, mood, effectiveMode);
        res.write(`\n@@mood:${mood}\n`);
        res.write(`@@mode:${effectiveMode}\n`);
        for (const [pid, status] of planUpdates) {
          patchPlanItem(pid, { status });
          res.write(`@@plan:${pid}:${status}\n`);
        }
        if (fileWrites > 0) {
          res.write(`@@files:${fileWrites}\n`);
        }
      }
    } else {
      for (const [pid, status] of planUpdates) {
        patchPlanItem(pid, { status });
      }
      // Jangan tutup percakapan dengan sunyi: kalau upstream tidak mengirim
      // apa pun (mis. stream terputus setelah reset), user harus tahu.
      if (!finalText && fileWrites === 0) {
        writeAiError(res, "Lode tidak menghasilkan jawaban. Silakan kirim ulang pesan.");
      }
    }

    // Simpan thread gemini agar percakapan berlanjut tanpa mengulang riwayat.
    if (r1thread && r1thread.cid) {
      patchConversation(cid, { ai_thread: JSON.stringify(r1thread) });
    }

    if (!res.writableEnded) res.end();
    return;
  }

  // ---------- GET /api/health (tes koneksi AI) ----------
  if (method === "GET" && p === "/api/health") {
    const profile = getProfile();
    const upstreamUrl = `${profile.ai_base_url.replace(/\/v1\/?$/, "")}/health`;
    try {
      const r = await fetch(upstreamUrl, {
        headers: aiRequestHeaders(),
        signal: AbortSignal.timeout(6000),
      });
      const body = await r.json().catch(() => null);
      const health = body as { client_ready?: boolean } | null;
      return sendJson(res, 200, {
        ok: r.ok && health?.client_ready !== false,
        upstream_status: r.status,
        upstream_url: upstreamUrl,
        body,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, 200, {
        ok: false,
        upstream_status: null,
        upstream_url: upstreamUrl,
        error: msg,
      });
    }
  }

  // ---------- profile ----------
  if (p === "/api/profile") {
    if (method === "GET") return sendJson(res, 200, getProfile());
    if (method === "PUT") {
      const body = await readJson(req);
      return sendJson(res, 200, updateProfile(body));
    }
  }

  // ---------- workspace ----------
  if (p === "/api/workspace/info" && method === "GET") {
    const folder = String(url.searchParams.get("folder") ?? "");
    if (!folder) return sendJson(res, 400, { ok: false, error: "folder kosong" });
    try {
      const info = await workspaceInfo(folder, {
        maxDepth: clampInt(url.searchParams.get("depth"), 1, 12, clampInt(getProfile().ws_max_depth, 1, 12, 7)),
        maxEntries: clampInt(
          url.searchParams.get("files"),
          10,
          3000,
          clampInt(getProfile().ws_max_files, 10, 3000, 350),
        ),
      });
      return sendJson(res, 200, { ok: true, ...info });
    } catch (err) {
      return sendJson(res, 200, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (p === "/api/workspace/tree" && method === "GET") {
    const folder = String(url.searchParams.get("folder") ?? "");
    if (!folder) return sendJson(res, 400, { ok: false, error: "folder kosong" });
    try {
      const scan = await scanWorkspace(folder, {
        maxEntries: clampInt(
          url.searchParams.get("files"),
          10,
          3000,
          clampInt(getProfile().ws_max_files, 10, 3000, 350),
        ),
        maxDepth: clampInt(
          url.searchParams.get("depth"),
          1,
          12,
          clampInt(getProfile().ws_max_depth, 1, 12, 7),
        ),
      });
      return sendJson(res, 200, { ok: true, ...scan });
    } catch (err) {
      return sendJson(res, 200, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (p === "/api/workspace/read" && method === "GET") {
    const folder = String(url.searchParams.get("folder") ?? "");
    const file = String(url.searchParams.get("file") ?? "");
    if (!folder || !file) {
      return sendJson(res, 400, { ok: false, error: "folder & file harus diisi" });
    }
    try {
      const r = await readWorkspaceFile(folder, file);
      return sendJson(res, 200, {
        ok: true,
        content: r?.content ?? null,
        truncated: r?.truncated ?? false,
      });
    } catch (err) {
      return sendJson(res, 200, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (p === "/api/workspace/pick" && method === "GET") {
    const current = String(url.searchParams.get("folder") ?? "");
    const result = await pickFolder(current);
    if (!result.ok) return sendJson(res, 200, result);
    return sendJson(res, 200, {
      ok: true,
      selected: result.selected,
      tool: result.tool,
    });
  }

  // ---------- state (semua data untuk dashboard) ----------
  if (method === "GET" && p === "/api/state") {
    return sendJson(res, 200, {
      profile: getProfile(),
      conversations: listConversations(),
      topics: listTopics(),
      memories: listMemories(),
    });
  }

  // ---------- conversations ----------
  if (p === "/api/conversations" && method === "GET") {
    return sendJson(res, 200, { conversations: listConversations() });
  }
  const convProgressMatch = p.match(/^\/api\/conversations\/(\d+)\/progress$/);
  if (convProgressMatch && method === "GET") {
    const cid = Number(convProgressMatch[1]);
    if (!getConversation(cid)) {
      return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
    }
    return sendJson(res, 200, {
      conversation_id: cid,
      topics: listTopicsByConversation(cid),
      memories: listMemoriesByConversation(cid),
      plan: listPlanItems(cid),
      revisions: listFileRevisions(cid, 20).map(summarizeRevision),
    });
  }
  const convMatch = p.match(/^\/api\/conversations\/(\d+)$/);
  if (convMatch) {
    const cid = Number(convMatch[1]);
    const conv = getConversation(cid);
    if (!conv) {
      return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
    }
    if (method === "GET") {
      const limitParam = url.searchParams.get("limit");
      const beforeParam = url.searchParams.get("before");
      const limit = limitParam ? Number(limitParam) : undefined;
      const beforeId = beforeParam ? Number(beforeParam) : undefined;
      const totalMessages = countMessages(cid);
      const messages = listMessages(cid, limit, beforeId);
      return sendJson(res, 200, {
        conversation_id: cid,
        total_messages: totalMessages,
        messages,
        folder: conv.folder,
        mode: normalizeMode(conv.mode),
        effective_mode: effectiveModeFor(cid, conv),
      });
    }
    if (method === "PATCH") {
      const b = await readJson(req);
      patchConversation(cid, {
        title: b.title as string | undefined,
        folder: b.folder as string | undefined,
        mode: b.mode === undefined ? undefined : normalizeMode(b.mode as string),
      });
      return sendJson(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      const sessionId = conv.ai_session;
      deleteConversation(cid);
      if (sessionId) {
        forgetGeminiSession(sessionId).catch(() => {});
      }
      return sendJson(res, 200, { ok: true });
    }
  }

  // ---------- conversation export/import/fork ----------
  const convExportMatch = p.match(/^\/api\/conversations\/(\d+)\/export$/);
  if (convExportMatch && method === "GET") {
    const cid = Number(convExportMatch[1]);
    const base = exportConversationContext(cid);
    if (!base) return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
    const folder = String(base.conversation.folder || "").trim();
    if (folder) {
      try {
        const rels = base.workspace_files.map((r) => r.rel);
        const files: Array<{ rel: string; content: string | null; updated_at?: string }> = [];
        for (const r of rels.slice(0, 500)) {
          const rf = await readWorkspaceFile(folder, r, 256000);
          files.push({ rel: r, content: rf?.content ?? null, updated_at: undefined });
        }
        base.workspace_files = files;
      } catch {}
    }
    return sendJson(res, 200, base);
  }
  const convForkMatch = p.match(/^\/api\/conversations\/(\d+)\/fork$/);
  const convForkCleanMatch = p.match(/^\/api\/conversations\/(\d+)\/fork-clean$/);
  if ((convForkMatch || convForkCleanMatch) && method === "POST") {
    const cid = Number((convForkMatch || convForkCleanMatch)![1]);
    const base = exportConversationContext(cid);
    if (!base) return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
    const resImport = importConversationContext(base, { includeMessages: !!convForkMatch });
    return sendJson(res, 200, { id: resImport.id, warnings: resImport.warnings });
  }
  if (p === "/api/conversations/import" && method === "POST") {
    const raw = await readBody(req, 25_000_000);
    let input: ConversationExportPayload;
    try {
      input = JSON.parse(raw) as ConversationExportPayload;
    } catch {
      return sendJson(res, 400, { error: "Format JSON tidak valid" });
    }
    if (input?.format !== "lode-conversation" || input?.version !== 1) {
      return sendJson(res, 400, { error: "Format ekspor tidak dikenali" });
    }
    const resImport = importConversationContext(input);
    return sendJson(res, 200, { id: resImport.id, warnings: resImport.warnings });
  }

  // ---------- topics ----------
  if (p === "/api/topics") {
    if (method === "GET") return sendJson(res, 200, { topics: listTopics() });
    if (method === "POST") {
      const b = await readJson(req);
      writeTopic(
        String(b.name ?? ""),
        String(b.status ?? "learning"),
        String(b.notes ?? ""),
        Number(b.conversationId) || 0,
        {
          mastery: b.mastery as number | undefined,
          confidence: b.confidence as number | undefined,
          evidence: b.evidence as string | undefined,
        },
      );
      return sendJson(res, 200, { topics: listTopics() });
    }
  }
  const topicMatch = p.match(/^\/api\/topics\/(\d+)$/);
  if (topicMatch) {
    const id = Number(topicMatch[1]);
    if (method === "PATCH") {
      const b = await readJson(req);
      patchTopic(id, {
        name: b.name as string | undefined,
        status: b.status as string | undefined,
        notes: b.notes as string | undefined,
        mastery: b.mastery as number | undefined,
        confidence: b.confidence as number | undefined,
        evidence: b.evidence as string | undefined,
      });
      return sendJson(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      deleteTopic(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  // ---------- plan belajar ----------
  if (p === "/api/plan") {
    if (method === "GET") {
      const cid = Number(url.searchParams.get("conversationId")) || 0;
      return sendJson(res, 200, { plan: listPlanItems(cid) });
    }
    if (method === "POST") {
      const b = await readJson(req);
      const cid = Number(b.conversationId) || 0;
      if (!getConversation(cid)) {
        return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
      }
      const id = createPlanItem(cid, {
        title: String(b.title ?? ""),
        objective: String(b.objective ?? ""),
        prerequisites: String(b.prerequisites ?? ""),
        phase: Number(b.phase) || 1,
      });
      if (!id) {
        return sendJson(res, 400, { error: "Judul item plan wajib diisi" });
      }
      return sendJson(res, 200, { plan: listPlanItems(cid) });
    }
  }
  if (method === "POST" && p === "/api/plan/move") {
    const b = await readJson(req);
    const cid = Number(b.conversationId) || 0;
    const id = Number(b.id) || 0;
    const dir = b.dir === "up" ? "up" : "down";
    if (!cid || !id) {
      return sendJson(res, 400, { error: "conversationId dan id wajib diisi" });
    }
    movePlanItem(cid, id, dir);
    return sendJson(res, 200, { plan: listPlanItems(cid) });
  }
  const planMatch = p.match(/^\/api\/plan\/(\d+)$/);
  if (planMatch) {
    const id = Number(planMatch[1]);
    if (method === "PATCH") {
      const b = await readJson(req);
      patchPlanItem(id, {
        title: b.title as string | undefined,
        objective: b.objective as string | undefined,
        prerequisites: b.prerequisites as string | undefined,
        phase: b.phase as number | undefined,
        status: b.status as string | undefined,
      });
      return sendJson(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      deletePlanItem(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  // ---------- riwayat file (undo) ----------
  if (method === "GET" && p === "/api/revisions") {
    const cid = Number(url.searchParams.get("conversationId")) || 0;
    const limit = Number(url.searchParams.get("limit")) || 20;
    if (!getConversation(cid)) {
      return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
    }
    return sendJson(res, 200, {
      revisions: listFileRevisions(cid, limit).map(summarizeRevision),
    });
  }
  const revDiffMatch = p.match(/^\/api\/revisions\/(\d+)\/diff$/);
  if (revDiffMatch && method === "GET") {
    const rev = getFileRevision(Number(revDiffMatch[1]));
    if (!rev) {
      return sendJson(res, 404, { error: "Riwayat tidak ditemukan" });
    }
    const conv = getConversation(rev.conversation_id);
    let current = "";
    let truncated = false;
    if (conv?.folder) {
      try {
        const file = await readWorkspaceFile(conv.folder, rev.rel, 400_000);
        current = file?.content ?? "";
        truncated = file?.truncated ?? false;
      } catch {
        current = "";
      }
    }
    const stat = diffLines(rev.content, current);
    return sendJson(res, 200, {
      revision: summarizeRevision(rev),
      diff: stat.diff,
      added: stat.added,
      removed: stat.removed,
      truncated: stat.truncated,
    });
  }
  const revRestoreMatch = p.match(/^\/api\/revisions\/(\d+)\/restore$/);
  if (revRestoreMatch && method === "POST") {
    const rev = getFileRevision(Number(revRestoreMatch[1]));
    if (!rev) {
      return sendJson(res, 404, { error: "Riwayat tidak ditemukan" });
    }
    const conv = getConversation(rev.conversation_id);
    if (!conv?.folder) {
      return sendJson(res, 400, {
        error: "Percakapan ini tidak punya folder workspace",
      });
    }
    let current: { content: string; truncated: boolean } | null = null;
    try {
      current = await readWorkspaceFile(conv.folder, rev.rel, 400_000);
    } catch {
      current = null;
    }
    // Status sekarang ikut dicatat supaya undo-nya bisa dibatalkan lagi.
    // Kalau file terlalu besar untuk dibaca utuh, lewati snapshot daripada
    // menyimpan isi yang terpotong.
    if (!current?.truncated) {
      recordFileWrites(
        rev.conversation_id,
        [
          {
            rel: rev.rel,
            created: !current,
            bytes: current?.content.length ?? 0,
            changed: current?.content !== (rev.existed ? rev.content : ""),
            prev: current?.content ?? null,
            next: rev.existed ? rev.content : "",
          },
        ],
        "undo",
      );
    }
    const result = await restoreWorkspaceFile(
      conv.folder,
      rev.rel,
      rev.existed ? rev.content : null,
    );
    if (!result.ok) {
      return sendJson(res, 400, { error: result.error ?? "Gagal mengembalikan file" });
    }
    return sendJson(res, 200, {
      ok: true,
      removed: result.removed ?? false,
      revisions: listFileRevisions(rev.conversation_id, 20).map(summarizeRevision),
    });
  }

  // ---------- memories ----------
  if (p === "/api/memories") {
    if (method === "GET") return sendJson(res, 200, { memories: listMemories() });
    if (method === "POST") {
      const b = await readJson(req);
      addMemory(String(b.type ?? "insight"), String(b.content ?? ""));
      return sendJson(res, 200, { memories: listMemories() });
    }
  }
  const memMatch = p.match(/^\/api\/memories\/(\d+)$/);
  if (memMatch && method === "DELETE") {
    deleteMemory(Number(memMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ---------- POST /api/memory/update (auto-catatan progress) ----------
  if (method === "POST" && p === "/api/memory/update") {
    const body = await readJson(req);
    const cid = Number(body.conversationId) || 0;
    if (!cid) return sendJson(res, 400, { error: "conversationId diperlukan" });
    if (!getConversation(cid)) {
      return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
    }
    const chatTurn = beginChatTurn();
    await chatTurn.ready;
    if (res.destroyed) {
      chatTurn.release();
      return;
    }
    res.once("finish", chatTurn.release);
    res.once("close", chatTurn.release);

    const msgs = listMessages(cid);
    if (msgs.length < 2) {
      return sendJson(res, 200, {
        summary: "Belum ada percakapan untuk dicatat.",
        topics: listTopicsByConversation(cid),
        memories: listMemoriesByConversation(cid),
      });
    }

    const chatLines = msgs
      .slice(-4)
      .map((m) => `${m.role === "user" ? "Pelajar" : "Mentor"}: ${m.content}`)
      .join("\n\n");

    const prompt = buildMemoryUpdatePrompt(
      listTopicsByConversation(cid),
      listMemoriesByConversation(cid),
      chatLines,
    );
    let text: string;
    try {
      text = await chatText([{ role: "user", content: prompt }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, 502, { error: "Gagal update memori.", detail: msg });
    }

    const parsed = parseMemoryUpdate(text);
    for (const t of parsed.topics) {
      writeTopic(t.name, t.status, t.notes, cid, {
        mastery: t.mastery,
        confidence: t.confidence,
        evidence: t.evidence,
        strong: t.strong,
      });
    }
    for (const m of parsed.memories) addMemory(m.type, m.content, cid);

    return sendJson(res, 200, {
      summary: text,
      topics: listTopicsByConversation(cid),
      memories: listMemoriesByConversation(cid),
    });
  }

  // ---------- POST /api/notes/make (dadakan: ubah satu output mentor jadi berkas catatan) ----------
  if (method === "POST" && p === "/api/notes/make") {
    const body = await readJson(req);
    const cid = Number(body.conversationId) || 0;
    const mid = Number(body.messageId) || 0;
    if (!cid || !mid) {
      return sendJson(res, 400, { error: "conversationId & messageId diperlukan" });
    }
    const conv = getConversation(cid);
    if (!conv) {
      return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
    }
    const msg = getMessage(mid);
    if (!msg || msg.role !== "assistant") {
      return sendJson(res, 404, { error: "Pesan mentor tidak ditemukan" });
    }

    const folder = String(conv.folder ?? "").trim();
    if (!folder) {
      return sendJson(res, 400, {
        error:
          "Folder workspace belum diarahkan ke percakapan ini. Set folder dulu lewat tombol Folder supaya catatan bisa disimpan.",
      });
    }
    const profile = getProfile();
    if (profile.ws_allow_write === 0) {
      return sendJson(res, 400, {
        error: "Izin menulis Lode nonaktif di Settings — nyalakan supaya catatan bisa disimpan.",
      });
    }

    const chatTurn = beginChatTurn();
    await chatTurn.ready;
    if (res.destroyed) {
      chatTurn.release();
      return;
    }
    res.once("finish", chatTurn.release);
    res.once("close", chatTurn.release);

    const workspaceCtx = await buildWorkspaceContext(folder, {
      maxDepth: clampInt(profile.ws_max_depth, 1, 12, 7),
      maxEntries: clampInt(profile.ws_max_files, 10, 3000, 350),
      autoDumpKB: 0,
    }).catch(() => "(folder workspace tidak bisa dibaca)");

    const prompt = buildNotePrompt({ profile, output: msg.content, workspaceCtx });
    let text: string;
    try {
      text = await chatText([{ role: "user", content: prompt }]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return sendJson(res, 502, { error: "Gagal memproses catatan.", detail });
    }

    const parsed = parseAgentBlocks(text);
    if (parsed.writes.length === 0 && parsed.mkdirs.length === 0) {
      return sendJson(res, 200, {
        ok: false,
        files: [],
        error: "AI tidak menghasilkan blok berkas catatan.",
        raw: text.slice(0, 500),
      });
    }

    const results = await applyWorkspaceWrites(folder, parsed);
    const files = results.filter(
      (r) => !r.error && !r.rel.endsWith("/") && r.next !== undefined,
    );
    const failed = results.filter((r) => r.error);
    for (const r of files) upsertWorkspaceFile(cid, r.rel);
    recordFileWrites(cid, results);

    return sendJson(res, 200, {
      ok: files.length > 0,
      files: files.map((r) => r.rel),
      failed: failed.map((r) => ({ rel: r.rel, error: r.error })),
      error: files.length === 0
        ? (failed[0]?.error ?? "Gagal menulis berkas catatan.")
        : failed.length > 0
          ? `${failed.length} berkas gagal ditulis.`
          : "",
    });
  }

  // ---------- maintenance ----------
  if (method === "POST" && p === "/api/maintenance/cleanup") {
    const result = runMaintenance();
    return sendJson(res, 200, { ok: true, ...result });
  }

  // ---------- static (frontend hasil build) ----------
  if (!p.startsWith("/api")) {
    serveStatic(res, p);
    return;
  }

  sendJson(res, 404, { error: "Route tidak ditemukan" });
}

server.listen(PORT, HOST, () => {
  console.log(`[lode] API server jalan di http://${HOST}:${PORT}`);
  console.log(`[lode] AI endpoint: ${getProfile().ai_base_url}/chat/completions`);
  try {
    const r = runMaintenance();
    if (r.freedMessages || r.freedTopics) {
      console.log(
        `[lode] pembersihan: ${r.freedMessages} pesan & ${r.freedTopics} topik yatim dihapus (${r.sizeBefore}B -> ${r.sizeAfter}B)`,
      );
    } else {
      console.log(`[lode] pembersihan: tidak ada data yatim`);
    }
  } catch (err) {
    console.log(`[lode] pembersihan awal gagal: ${err instanceof Error ? err.message : err}`);
  }
});