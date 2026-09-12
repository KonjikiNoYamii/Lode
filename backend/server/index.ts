import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import {
  addMemory,
  addMessage,
  createConversation,
  deleteConversation,
  deleteMemory,
  deleteTopic,
  getConversation,
  getProfile,
  listConversations,
  listMemories,
  listMemoriesByConversation,
  listMessages,
  listTopics,
  listTopicsByConversation,
  patchConversation,
  patchTopic,
  runMaintenance,
  updateProfile,
  upsertTopic,
} from "../lib/db";
import { chatText, streamChat, type ChatItem } from "../lib/ai";
import { finalMood } from "../lib/mood";
import {
  buildMemoryUpdatePrompt,
  buildSystemPrompt,
  parseMemoryUpdate,
} from "../lib/memory";
import {
  applyWorkspaceWrites,
  buildWorkspaceContext,
  gatherFileDump,
  parseAgentBlocks,
  pickFolder,
  readWorkspaceFile,
  scanWorkspace,
  workspaceInfo,
} from "../lib/workspace";

const PORT = Number(process.env.PORT ?? 8787);
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

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
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

async function forwardSse(
  upstream: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
): Promise<{ text: string; streamError: string }> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let streamError = "";
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
            choices?: { delta?: { content?: string } }[];
          };
          if (j.error) {
            streamError =
              typeof j.error === "string" ? j.error : j.error.message ?? "";
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
  return { text, streamError };
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

function stripMarkers(text: string): string {
  return text
    .replace(/@@read\("[^"]*"\)/g, "")
    .replace(/@@mood\("[^"]*"\)/g, "");
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
    console.error("[sensei] unexpected error:", msg);
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

    let cid = Number(body.conversationId) || 0;
    let title: string | null = null;
    let folder = "";
    if (!cid) {
      title = message.length > 36 ? `${message.slice(0, 36)}…` : message;
      folder = String(getProfile().workspace ?? "").trim();
      cid = createConversation(title, folder);
    } else {
      const conv = getConversation(cid);
      if (conv) folder = String(conv.folder ?? "").trim();
    }
    addMessage(cid, "user", message);

    const profile = getProfile();
    const topics = listTopicsByConversation(cid);
    const memories = listMemoriesByConversation(cid);
    const history = listMessages(cid).slice(-14);

    const wsMaxDepth = clampInt(profile.ws_max_depth, 1, 8, 3);
    const wsMaxFiles = clampInt(profile.ws_max_files, 10, 1000, 150);
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
    const system = buildSystemPrompt(
      profile,
      topics,
      memories,
      workspaceCtx || "",
      allowWrite,
    );

    const makePayload = (extraSystem = ""): ChatItem[] => [
      { role: "system", content: `${system}\n\n${extraSystem}`.trim() },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];

    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Conversation-Id": String(cid),
    };
    if (title) headers["X-Conversation-Title"] = encodeURIComponent(title);

    let upstream: ReadableStream<Uint8Array>;
    try {
      upstream = await streamChat(makePayload());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, 502, {
        error:
          "Tidak bisa terhubung ke gemini-server. Pastikan server kamu jalan & cookie Gemini valid.",
        detail: msg,
      });
    }

    res.writeHead(200, headers);

    // Round 1 — buffer awal untuk deteksi marker @@read, lalu stream bila aman
    const reader = upstream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let streamError = "";
    let mode: "collect" | "stream" = "collect";
    const markers = new Set<string>();
    const detectMarkers = (txt: string) => {
      let m: RegExpExecArray | null;
      const re = /@@read\("([^"]+)"\)/g;
      while ((m = re.exec(txt))) markers.add(m[1]);
    };

    const stripMarkersAndTokens = (txt: string) => stripMarkers(txt);

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
              choices?: { delta?: { content?: string } }[];
            };
            if (j.error) {
              streamError =
                typeof j.error === "string"
                  ? j.error
                  : j.error.message ?? "Unknown";
              continue;
            }
            const delta = j.choices?.[0]?.delta?.content ?? "";
            if (!delta) continue;
            detectMarkers(delta);
            full += delta;

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
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stream terputus";
      if (!res.writableEnded) res.write(`\n\n[error] ${msg}`);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    const parsed = parseAgentBlocks(full);

    let writeNotes = "";
    const wantsWrites = parsed.writes.length > 0 || parsed.mkdirs.length > 0;
    if (wantsWrites) {
      if (folder && allowWrite) {
        const results = await applyWorkspaceWrites(folder, parsed);
        const ok = results.filter((r) => !r.error);
        const fail = results.filter((r) => r.error);
        writeNotes =
          `\n[FILE/FOLDER DITULIS OLEH SENSEI: ${ok.length ? ok.map((r) => r.rel).join(", ") : "—"}]` +
          (fail.length
            ? `\n[GAGAL DITULIS: ${fail.map((r) => `${r.rel} (${r.error})`).join("; ")}]`
            : "");
      } else if (!folder) {
        writeNotes =
          "\n[Workspace belum diarahkan ke percakapan ini — berkas tidak dibuat. Ingatkan pelajar untuk set folder lewat tombol Folder.]";
      } else {
        writeNotes = "\n[Izin menulis Sensei nonaktif di Settings — berkas tidak dibuat.]";
      }
    }

    if (mode === "collect" && markers.size === 0 && full.trim()) {
      // jawaban pendek tanpa marker — belum sempat di-stream
      if (!res.writableEnded) res.write(stripMarkers(parsed.clean));
    }

    let finalText = stripMarkers(parsed.clean).trim();

    if (markers.size > 0) {
      const rels = [...markers];
      let dump = "";
      if (folder) {
        dump = await gatherFileDump(folder, rels);
      } else {
        dump =
          "\n[Folder workspace belum diarahkan ke percakapan ini. Bilang ke pelajar untuk men-set folder di tombol folder.]";
      }
      try {
        const extra = `Pelajar meminta kamu membaca file. Gunakan isi file di bawah.\n${dump}${writeNotes}\n\nJawab pertanyaan pelajar sekarang memakai isi file itu. JANGAN menulis marker @@read lagi${wantsWrites ? " (berkas sudah diproses, jangan tulis blok @@write lagi)" : ""}.`;
        const round2 = await streamChat(makePayload(extra));
        const r2f = makeWriteFilter();
        const r2 = await forwardSse(round2, (d) => {
          if (!res.writableEnded) res.write(r2f.fed(stripMarkers(d)));
        });
        if (!res.writableEnded) res.write(r2f.end());
        const r2Parsed = parseAgentBlocks(r2.text);
        if (folder && allowWrite && (r2Parsed.writes.length || r2Parsed.mkdirs.length)) {
          const results = await applyWorkspaceWrites(folder, r2Parsed);
          const ok = results.filter((r) => !r.error);
          const fail = results.filter((r) => r.error);
          const note =
            `\n[FILE/FOLDER TAMBAHAN DITULIS: ${ok.length ? ok.map((r) => r.rel).join(", ") : "—"}]` +
            (fail.length
              ? `\n[GAGAL: ${fail.map((r) => `${r.rel} (${r.error})`).join("; ")}]`
              : "");
          finalText = `${stripMarkers(r2Parsed.clean)}${note}`.trim() || finalText;
        } else {
          finalText = stripMarkers(r2Parsed.clean).trim() || finalText;
        }
        if (r2.streamError && !finalText) {
          if (!res.writableEnded) res.write(`\n\n[server error] ${r2.streamError}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.writableEnded) res.write(`\n\n[error membaca file] ${msg}`);
      }
      if (writeNotes) {
        finalText = `${finalText}\n> ${writeNotes.trim()}`.trim();
      }
    } else if (writeNotes) {
      finalText = `${finalText}\n> ${writeNotes.trim()}`.trim();
    } else if (streamError && !finalText) {
      finalText = `[Gagal terhubung ke server AI (${streamError}). Mohon coba lagi.]`;
      if (!res.writableEnded) res.write(`\n\n> ${finalText}`);
    }

    // round tambahan: pelajar minta membuat berkas, tapi Sensei belum menulisnya
    const CREATE_VERB = /\b(buatkan?|buatin|bikin|create|generate|tuliskan?|simpan|tulis)\b/i;
    const FILE_TARGET = /\b(file|berkas|roadmap|folder|dir|skrip|script|\.\w{1,6})\b/i;
    const NO_CREATE = /(jangan|tldr|nggak?|tidak uta?sa?h|cukup|tanpa|skip|gausah|nggausah)/i;
    const askedCreate =
      !streamError &&
      CREATE_VERB.test(message) &&
      FILE_TARGET.test(message) &&
      !NO_CREATE.test(message);
    if (
      askedCreate &&
      folder &&
      allowWrite &&
      parsed.writes.length === 0 &&
      parsed.mkdirs.length === 0 &&
      markers.size === 0
    ) {
      try {
        const extra =
          "Pelajar meminta kamu membuat/menulis berkas di workspace, tapi jawabanmu tadi TIDAK berisi blok pembuatan berkas (file tidak jadi dibuat). SEKARANG keluarkan HANYA SATU blok:\n@@write(\"path/relatif/NamaBerkas.ext\")\n<isi berkas lengkap>\n@@end\nTanpa teks lain. Blok itu yang akan dieksekusi sistem untuk menulis berkas.";
        const round2 = await streamChat(makePayload(extra));
        const r2f = makeWriteFilter();
        const r2 = await forwardSse(round2, (d) => {
          if (!res.writableEnded) res.write(r2f.fed(stripMarkers(d)));
        });
        if (!res.writableEnded) res.write(r2f.end());
        const r2p = parseAgentBlocks(r2.text);
        if (r2p.writes.length || r2p.mkdirs.length) {
          const results = await applyWorkspaceWrites(folder, r2p);
          const ok = results.filter((r) => !r.error);
          const fail = results.filter((r) => r.error);
          const note =
            `\n\n> [Berkas ditulis oleh Sensei: ${ok.length ? ok.map((r) => r.rel).join(", ") : "—"}]` +
            (fail.length
              ? `\n> [Gagal ditulis: ${fail.map((r) => `${r.rel} (${r.error})`).join("; ")}]`
              : "");
          if (!res.writableEnded) res.write(note.trim());
          finalText = `${finalText}\n${note}`.trim();
        } else {
          const msg = "\n\n> [Sensei belum menulis berkas apa pun — minta lagi dengan format jelas.]";
          if (!res.writableEnded) res.write(msg.trim());
          finalText = `${finalText}\n${msg}`.trim();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!res.writableEnded) res.write(`\n\n[error membuat berkas] ${msg}`);
      }
    }

    if (finalText && !res.writableEnded) {
      const { mood, clean: moodClean } = finalMood(finalText);
      finalText = moodClean.trim();
      if (finalText) {
        addMessage(cid, "assistant", finalText, mood);
        res.write(`\n@@mood:${mood}\n`);
      }
    }
    if (!res.writableEnded) res.end();
    return;
  }

  // ---------- GET /api/health (tes koneksi AI) ----------
  if (method === "GET" && p === "/api/health") {
    const profile = getProfile();
    const upstreamUrl = `${profile.ai_base_url.replace(/\/v1\/?$/, "")}/health`;
    try {
      const r = await fetch(upstreamUrl, { signal: AbortSignal.timeout(6000) });
      const body = await r.json().catch(() => null);
      return sendJson(res, 200, {
        ok: r.ok,
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
        maxDepth: clampInt(url.searchParams.get("depth"), 1, 8, clampInt(getProfile().ws_max_depth, 1, 8, 3)),
        maxEntries: clampInt(
          url.searchParams.get("files"),
          10,
          1000,
          clampInt(getProfile().ws_max_files, 10, 1000, 150),
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
          1000,
          clampInt(getProfile().ws_max_files, 10, 1000, 150),
        ),
        maxDepth: clampInt(
          url.searchParams.get("depth"),
          1,
          8,
          clampInt(getProfile().ws_max_depth, 1, 8, 3),
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
    return sendJson(res, 200, {
      conversation_id: cid,
      topics: listTopicsByConversation(cid),
      memories: listMemoriesByConversation(cid),
    });
  }
  const convMatch = p.match(/^\/api\/conversations\/(\d+)$/);
  if (convMatch) {
    const cid = Number(convMatch[1]);
    if (method === "GET") {
      return sendJson(res, 200, {
        conversation_id: cid,
        messages: listMessages(cid),
        folder: getConversation(cid)?.folder ?? "",
      });
    }
    if (method === "PATCH") {
      const b = await readJson(req);
      patchConversation(cid, {
        title: b.title as string | undefined,
        folder: b.folder as string | undefined,
      });
      return sendJson(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      deleteConversation(cid);
      return sendJson(res, 200, { ok: true });
    }
  }

  // ---------- topics ----------
  if (p === "/api/topics") {
    if (method === "GET") return sendJson(res, 200, { topics: listTopics() });
    if (method === "POST") {
      const b = await readJson(req);
      upsertTopic(
        String(b.name ?? ""),
        String(b.status ?? "learning"),
        String(b.notes ?? ""),
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
      });
      return sendJson(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      deleteTopic(id);
      return sendJson(res, 200, { ok: true });
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
    for (const t of parsed.topics) upsertTopic(t.name, t.status, t.notes, cid);
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

server.listen(PORT, () => {
  console.log(`[sensei] API server jalan di http://localhost:${PORT}`);
  console.log(`[sensei] AI endpoint: ${getProfile().ai_base_url}/chat/completions`);
  try {
    const r = runMaintenance();
    if (r.freedMessages || r.freedTopics) {
      console.log(
        `[sensei] pembersihan: ${r.freedMessages} pesan & ${r.freedTopics} topik yatim dihapus (${r.sizeBefore}B -> ${r.sizeAfter}B)`,
      );
    } else {
      console.log(`[sensei] pembersihan: tidak ada data yatim`);
    }
  } catch (err) {
    console.log(`[sensei] pembersihan awal gagal: ${err instanceof Error ? err.message : err}`);
  }
});