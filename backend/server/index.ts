import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  addMemory,
  addMessage,
  countDueCards,
  countMessages,
  createConversation,
  createPlanItem,
  createReviewCard,
  deleteConversation,
  deleteMemory,
  deletePlanItem,
  deleteReviewCard,
  deleteTopic,
  getConversation,
  getFileRevision,
  getProfile,
  getReviewCard,
  getReviewCardForConversation,
  getTopic,
  listConversations,
  listFileRevisions,
  listMemories,
  listMemoriesByConversation,
  listMessages,
  listPlanItems,
  listReviewCards,
  listTopics,
  listTopicsByConversation,
  listWorkspaceFiles,
  movePlanItem,
  patchConversation,
  patchPlanItem,
  recordFileRevision,
  patchReviewCard,
  patchTopic,
  runMaintenance,
  updateProfile,
  upsertWorkspaceFile,
  writeTopic,
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
import { MASTERY_REVIEW_GAIN, type FileRevision, type PlanStatus } from "../lib/db";
import { diffLines } from "../lib/diff";
import {
  buildReviewContext,
  dueCards,
  isCardRating,
  scheduleReview,
  stripCardMarkers,
  type CardRating,
} from "../lib/srs";
import {
  buildMemoryUpdatePrompt,
  buildSystemPrompt,
  parseMemoryUpdate,
} from "../lib/memory";
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

function makeWriteFilter(): { fed: (delta: string) => string; end: () => string } {
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

function readBody(req: IncomingMessage): Promise<string> {
  const maxBytes = 1_000_000;
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
            choices?: { delta?: { content?: string } }[];
          };
          if (j.error) {
            streamError =
              typeof j.error === "string" ? j.error : j.error.message ?? "";
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
  cardSink?: Map<number, CardRating>,
): string {
  const base = stripModeMarkers(
    text
      .replace(/@@read\("[^"]*"\)/g, "")
      .replace(/@@mood\("[^"]*"\)/g, ""),
    modeSink,
  );
  return stripCardMarkers(stripPlanMarkers(base, planSink), cardSink);
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
    dueCards: countDueCards(conversationId),
    stuckCount: topics.filter((t) => t.status === "stuck").length,
    mastery: topics.reduce((max, t) => Math.max(max, t.mastery), 0),
  });
  return choice.mode === "auto" ? "konsep" : choice.mode;
}

/**
 * Terapkan penilaian kartu (dari marker AI atau klik pelajar di UI).
 * Kartu "ingat" juga menambah mastery topik induknya — review adalah bukti.
 */
function applyCardRatings(
  conversationId: number,
  sink: Map<number, CardRating>,
): { id: number; rating: CardRating; box: number; due_at: string }[] {
  const applied: { id: number; rating: CardRating; box: number; due_at: string }[] = [];
  for (const [id, rating] of sink) {
    const card = getReviewCardForConversation(id, conversationId);
    if (!card) continue;
    const schedule = scheduleReview(card.box, rating, card.lapses);
    patchReviewCard(id, {
      box: schedule.box,
      dueAt: schedule.dueAt,
      lapses: schedule.lapses,
      rating,
    });
    if (card.topic_id && rating === "ingat") {
      const topic = getTopic(card.topic_id);
      if (topic && topic.conversation_id === conversationId) {
        writeTopic(
          topic.name,
          topic.status,
          topic.notes,
          conversationId,
          { mastery: topic.mastery + MASTERY_REVIEW_GAIN },
        );
      }
    }
    applied.push({ id, rating, box: schedule.box, due_at: schedule.dueAt });
  }
  return applied;
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
      dueCards: countDueCards(cid),
      stuckCount: topics.filter((t) => t.status === "stuck").length,
      mastery: topics.reduce((max, t) => Math.max(max, t.mastery), 0),
    });
    const turnMode: LearnMode = modeChoice.mode === "auto" ? "konsep" : modeChoice.mode;
    const reviewCards = dueCards(listReviewCards(cid));

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
          records.map((r) => r.rel),
        );
      } catch {
        authoredCtx = "";
      }
    }

    const planItems = listPlanItems(cid);
    const planIds = new Set(planItems.map((i) => i.id));

    const system = buildSystemPrompt(
      profile,
      topics,
      memories,
      workspaceCtx || "",
      allowWrite,
      authoredCtx,
      buildPlanContext(planItems),
      buildModeContext(
        turnMode,
        modeChoice.reason,
        modeChoice.locked,
        buildReviewContext(reviewCards),
      ),
    );

    const planSink = new Map<number, PlanStatus>();
    const modeSink = new Map<LearnMode, LearnMode>();
    const cardSink = new Map<number, CardRating>();

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
    }> =>
      new Promise((resolve, reject) => {
        const reader = up.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        let streamError = "";
        let mode: "collect" | "stream" = "collect";
        let thread: AiThread | null = null;
        const markers = new Set<string>();
        const detectMarkers = (txt: string) => {
          let m: RegExpExecArray | null;
          const re = /@@read\("([^"]+)"\)/g;
          while ((m = re.exec(txt))) markers.add(m[1]);
        };
        const stripMarkersAndTokens = (txt: string) => stripMarkers(txt, planSink, modeSink, cardSink);
        const run = async () => {
          try {
            const flt = makeWriteFilter();
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
                    choices?: { delta?: { content?: string } }[];
                  };
                  if (j.error) {
                    streamError =
                      typeof j.error === "string"
                        ? j.error
                        : j.error.message ?? "Unknown";
                    continue;
                  }
                  if (j.thread) {
                    thread = j.thread;
                    continue;
                  }
                  const delta = j.choices?.[0]?.delta?.content ?? "";
                  if (!delta) continue;
                  full += delta;
                  detectMarkers(full);

                  if (mode === "collect") {
                    if (markers.size > 0) {
                      mode = "collect"; // ada permintaan baca file → siapkan round 2
                    } else if (full.length >= 1024 || /\n\n/.test(full)) {
                      mode = "stream"; // aman, mulai streaming
                      res.write(flt.fed(stripMarkersAndTokens(full)));
                    }
                  } else {
                    res.write(flt.fed(stripMarkersAndTokens(delta)));
                  }
                } catch {
                  // baris SSE tidak lengkap / bukan JSON
                }
              }
            }
            if (mode === "stream" && !res.writableEnded) {
              res.write(flt.end());
            }
            resolve({ full, streamError, mode, markers, thread });
          } catch (err) {
            streamError = err instanceof Error ? err.message : "Stream terputus";
            resolve({ full, streamError, mode, markers, thread });
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

    const parsed = parseAgentBlocks(round1.full);

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
      if (!res.writableEnded) res.write(stripMarkers(parsed.clean, planSink, modeSink, cardSink));
    }

    let finalText = stripMarkers(parsed.clean, planSink, modeSink, cardSink).trim();

    if (round1.markers.size > 0) {
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
        const r2 = await forwardSse(round2, (d) => {
          if (!res.writableEnded) res.write(r2f.fed(stripMarkers(d, planSink, modeSink, cardSink)));
        });
        if (r2.thread) r1thread = r2.thread;
        if (!res.writableEnded) res.write(r2f.end());
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
          finalText = `${stripMarkers(r2Parsed.clean, planSink, modeSink, cardSink)}${note}`.trim() || finalText;
        } else {
          finalText = stripMarkers(r2Parsed.clean, planSink, modeSink, cardSink).trim() || finalText;
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
        const r2 = await forwardSse(round2, (d) => {
          if (!res.writableEnded) res.write(r2f.fed(stripMarkers(d, planSink, modeSink, cardSink)));
        });
        if (r2.thread) r1thread = r2.thread;
        if (!res.writableEnded) res.write(r2f.end());
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
    const cardUpdates = applyCardRatings(cid, cardSink);
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
        for (const card of cardUpdates) {
          res.write(`@@card:${card.id}:${card.rating}:${card.box}:${card.due_at}\n`);
        }
        if (fileWrites > 0) {
          res.write(`@@files:${fileWrites}\n`);
        }
      }
    } else {
      for (const [pid, status] of planUpdates) {
        patchPlanItem(pid, { status });
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
    const cards = listReviewCards(cid);
    return sendJson(res, 200, {
      conversation_id: cid,
      topics: listTopicsByConversation(cid),
      memories: listMemoriesByConversation(cid),
      plan: listPlanItems(cid),
      cards,
      due_cards: dueCards(cards).length,
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

  // ---------- kartu review (spaced repetition) ----------
  if (method === "GET" && p === "/api/cards") {
    const cid = Number(url.searchParams.get("conversationId")) || 0;
    const cards = listReviewCards(cid);
    return sendJson(res, 200, {
      cards,
      due: dueCards(cards).length,
    });
  }
  if (method === "POST" && p === "/api/cards") {
    const b = await readJson(req);
    const cid = Number(b.conversationId) || 0;
    if (!cid || !getConversation(cid)) {
      return sendJson(res, 404, { error: "Percakapan tidak ditemukan" });
    }
    const id = createReviewCard(cid, {
      front: String(b.front ?? ""),
      back: String(b.back ?? ""),
    });
    if (!id) {
      return sendJson(res, 400, { error: "Pertanyaan kartu wajib diisi" });
    }
    return sendJson(res, 200, { cards: listReviewCards(cid) });
  }
  const cardMatch = p.match(/^\/api\/cards\/(\d+)$/);
  if (cardMatch) {
    const id = Number(cardMatch[1]);
    const card = getReviewCard(id);
    if (!card) {
      return sendJson(res, 404, { error: "Kartu tidak ditemukan" });
    }
    if (method === "PATCH") {
      const b = await readJson(req);
      if (b.rating !== undefined) {
        if (!isCardRating(b.rating)) {
          return sendJson(res, 400, { error: "Nilai harus lupa, nyaris, atau ingat" });
        }
        const applied = applyCardRatings(
          card.conversation_id,
          new Map([[id, b.rating as CardRating]]),
        );
        return sendJson(res, 200, {
          cards: listReviewCards(card.conversation_id),
          applied,
        });
      }
      patchReviewCard(id, {
        front: b.front as string | undefined,
        back: b.back as string | undefined,
      });
      return sendJson(res, 200, { cards: listReviewCards(card.conversation_id) });
    }
    if (method === "DELETE") {
      deleteReviewCard(id);
      return sendJson(res, 200, { cards: listReviewCards(card.conversation_id) });
    }
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
      });
    }
    for (const m of parsed.memories) addMemory(m.type, m.content, cid);

    return sendJson(res, 200, {
      summary: text,
      topics: listTopicsByConversation(cid),
      memories: listMemoriesByConversation(cid),
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
    const freed = r.freedMessages + r.freedTopics + r.freedCards;
    if (r.promotedCards > 0) {
      console.log(
        `[lode] kartu review: ${r.promotedCards} kartu topik yang sudah dikuasai dimajukan satu kotak`,
      );
    }
    if (freed) {
      console.log(
        `[lode] pembersihan: ${r.freedMessages} pesan, ${r.freedTopics} topik & ${r.freedCards} kartu yatim dihapus (${r.sizeBefore}B -> ${r.sizeAfter}B)`,
      );
    } else {
      console.log(`[lode] pembersihan: tidak ada data yatim`);
    }
  } catch (err) {
    console.log(`[lode] pembersihan awal gagal: ${err instanceof Error ? err.message : err}`);
  }
});