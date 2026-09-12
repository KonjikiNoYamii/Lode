import { useEffect, useMemo, useRef, useState } from "react";
import type { Memory, Message, Mood, Profile, Topic } from "@/types";
import { GraduationCap, BookOpen } from "lucide-react";
import { Markdown } from "./Markdown";
import MentorAvatar, {
  MOODS,
  MOOD_THEME,
  getCandidateUrls,
} from "./MentorAvatar";
import { STATUS_META } from "./status";

function isMood(v: string | undefined): v is Mood {
  return !!v && (MOODS as string[]).includes(v);
}

function stripStreamMood(s: string): string {
  return s.replace(/\n?@@mood:[a-z]+\s*/g, "");
}

const NEGATED_KIND =
  /\b(jangan|janganlah|tak perlu|tidak perlu|tidak usah|tak usah|ga usah|gausah|gak usah|nggak usah|jangan sampai)\s+(bingung|khawatir|pusing|panik|gugup|capek|lelah|sedih|menyerah)\b/i;

const KEYWORDS: Record<Exclude<Mood, "netral">, RegExp> = {
  bingung:
    /\b(?:aku|saya|gw|gue|kita)\s+(bingung|bingu|kurang paham|belum paham|kurang ngerti|belum ngerti|tidak yakin aku)\b|\b(hmm|bingung\.\.\.|pusing aku)\b|\?\s*\?/i,
  sedih:
    /\b(sedih\.\.\.|menyesal|kecewa berat|sayang sekali|aku gagal|gagal lagi|merasa gagal|payah aku|semangatku turun)\b/i,
  senang:
    /\b(senang|hebat|keren|mantap|selamat|gratulasi|bagus sekali|luar biasa|hebat banget|tepat sekali|jawaban benar|pasti bisa)\b|\b(yay|hooray|horay)\b/i,
  semangat:
    /\b(semangat|ayo kita|ayo|yuk|kita mulai|langsung gas|gas|lanjut|waktunya|step pertama|percobaan pertama|mari kita mulai)\b/i,
  tenang:
    /\b(tenang|santai|pelan-pelan|satu langkah|tak apa|tak masalah|gapapa|gak papa|tidak perlu buru|slow|jangan terburu)\b/i,
};

function detectLiveMood(text: string): Mood | null {
  const negated = NEGATED_KIND.test(text);
  for (const m of ["senang", "semangat", "tenang", "sedih", "bingung"] as const) {
    if (negated && (m === "bingung" || m === "sedih")) continue;
    if (KEYWORDS[m].test(text)) return m;
  }
  return null;
}

function lastMood(messages: Message[]): Mood | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && isMood(messages[i].mood)) {
      return messages[i].mood as Mood;
    }
  }
  return undefined;
}

interface Props {
  currentId: number | null;
  title: string;
  folder: string;
  profile: Profile | null;
  messages: Message[];
  topics?: Topic[];
  memories?: Memory[];
  totalMessages?: number;
  onLoadEarlier?: () => Promise<void>;
  addMessages: (msgs: Message[]) => void;
  onNewConversation: (id: number, title: string) => void;
  onMemoryUpdated: (id: number) => void;
  onNewChat: () => void;
  onOpenSidebar: () => void;
  onSetFolder: (folder: string) => Promise<void>;
}

const SUGGESTIONS = [
  "Rencanakan sesi belajar hari ini",
  "Jelaskan async/await dengan analogi anime",
  "Aku stuck dengan error ini, bantu aku",
  "Buatkan roadmap belajar web dev untukku",
];

function MiniAvatar({ mood }: { mood: Mood }) {
  const candidates = useMemo(() => getCandidateUrls(mood), [mood]);
  const [candidateIdx, setCandidateIdx] = useState(0);

  useEffect(() => {
    setCandidateIdx(0);
  }, [mood]);

  const src = candidates[candidateIdx] ?? "/avatars/yami-netral.png";
  const theme = MOOD_THEME[mood] ?? MOOD_THEME.netral;

  return (
    <img
      src={src}
      alt=""
      onError={() => {
        if (candidateIdx < candidates.length - 1) {
          setCandidateIdx((prev) => prev + 1);
        }
      }}
      className={`mt-1 h-8 w-8 shrink-0 rounded-full object-cover ring-2 transition-all duration-300 ${theme.ring}`}
    />
  );
}

export default function ChatRoom({
  currentId,
  title,
  folder,
  profile,
  messages,
  topics = [],
  memories = [],
  totalMessages = 0,
  onLoadEarlier,
  addMessages,
  onNewConversation,
  onMemoryUpdated,
  onNewChat,
  onOpenSidebar,
  onSetFolder,
}: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderText, setFolderText] = useState(folder);
  const [folderInfo, setFolderInfo] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [folderChecking, setFolderChecking] = useState(false);
  const [folderSaving, setFolderSaving] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [mood, setMood] = useState<Mood>("netral");
  const endRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef<HTMLTextAreaElement>(null);
  const prevLastMsgIdRef = useRef<number | undefined>(undefined);

  const mascotName = profile?.mascot || "Sensei";

  const handleLoadEarlier = async () => {
    if (!onLoadEarlier || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      await onLoadEarlier();
    } finally {
      setLoadingEarlier(false);
    }
  };

  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.mood);
    if (last?.mood && isMood(last.mood)) setMood(last.mood);
  }, [messages, currentId]);

  const lastMsgId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!lastMsgId && !live) return;
    if (lastMsgId !== prevLastMsgIdRef.current || live) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevLastMsgIdRef.current = lastMsgId;
  }, [lastMsgId, live]);

  useEffect(() => {
    setLive("");
    setError("");
    setSending(false);
  }, [currentId]);

  useEffect(() => {
    setFolderText(folder);
    setFolderInfo(null);
  }, [folder]);

  async function checkFolder() {
    const f = folderText.trim();
    if (!f) return;
    setFolderChecking(true);
    setFolderInfo(null);
    try {
      const r = await fetch(`/api/workspace/info?folder=${encodeURIComponent(f)}`);
      const j = (await r.json()) as { ok: boolean; fileCount?: number; error?: string };
      setFolderInfo(
        j.ok
          ? { ok: true, text: `Folder valid — ${j.fileCount ?? 0} file terdeteksi. Sensei bisa membacanya.` }
          : { ok: false, text: j.error ?? "Folder tidak valid" },
      );
    } catch (err) {
      setFolderInfo({
        ok: false,
        text: err instanceof Error ? err.message : "Gagal memeriksa folder",
      });
    } finally {
      setFolderChecking(false);
    }
  }

  async function pickFromManager() {
    setFolderChecking(true);
    setFolderInfo(null);
    try {
      const r = await fetch(
        `/api/workspace/pick?folder=${encodeURIComponent(folderText.trim())}`,
      );
      const j = (await r.json()) as {
        ok: boolean;
        selected?: string | null;
        error?: string;
      };
      if (!j.ok) {
        setFolderInfo({ ok: false, text: j.error ?? "Gagal membuka dialog folder" });
      } else if (j.selected) {
        setFolderText(j.selected);
        setFolderInfo({ ok: true, text: `Folder dipilih: ${j.selected}` });
      }
    } catch (err) {
      setFolderInfo({
        ok: false,
        text: err instanceof Error ? err.message : "Gagal membuka dialog folder",
      });
    } finally {
      setFolderChecking(false);
    }
  }

  async function saveFolder() {
    setFolderSaving(true);
    try {
      await onSetFolder(folderText.trim());
      setFolderOpen(false);
    } catch (err) {
      setFolderInfo({
        ok: false,
        text: err instanceof Error ? err.message : "Gagal menyimpan folder",
      });
    } finally {
      setFolderSaving(false);
    }
  }

  async function send(raw?: string) {
    const msg = (raw ?? input).trim();
    if (!msg || sending) return;

    setInput("");
    setError("");
    setSending(true);
    setLive("");

    const cidBefore = currentId;
    addMessages([
      {
        id: -Date.now(),
        conversation_id: cidBefore ?? 0,
        role: "user",
        content: msg,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, conversationId: cidBefore }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        setError(
          `${j?.error ?? "Terjadi kesalahan"}${j?.detail ? ` — ${j.detail}` : ""}`,
        );
        return;
      }

      const cid = Number(res.headers.get("x-conversation-id")) || cidBefore || 0;
      const titleRaw = res.headers.get("x-conversation-title");
      const convTitle = titleRaw
        ? decodeURIComponent(titleRaw)
        : msg.length > 30
          ? `${msg.slice(0, 30)}…`
          : msg;

      if (!res.body) {
        setError("Tidak ada respons dari server.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setLive(stripStreamMood(acc));

        // Mood dinamis saat streaming berjalan
        const streamMarker = acc.match(/@@mood:([a-z]+)/);
        if (streamMarker && isMood(streamMarker[1])) {
          setMood(streamMarker[1]);
        } else {
          const liveDetected = detectLiveMood(acc);
          if (liveDetected) {
            setMood(liveDetected);
          }
        }
      }

      let text = acc.trim();
      const moodMatch = text.match(/@@mood:([a-z]+)/);
      const streamMood = moodMatch?.[1];
      if (moodMatch) {
        text = text.replace(/@@mood:[a-z]+\s*/g, "").trim();
      }
      const nextMood: Mood = isMood(streamMood)
        ? streamMood
        : isMood(mood)
        ? mood
        : isMood(lastMood(messages))
        ? (lastMood(messages) as Mood)
        : "netral";
      setMood(nextMood);

      if (text) {
        addMessages([
          {
            id: -Date.now() + 1,
            conversation_id: cid,
            role: "assistant",
            content: text,
            created_at: new Date().toISOString(),
            mood: nextMood,
          },
        ]);
      }

      if (!cidBefore) {
        onNewConversation(cid, convTitle);
      }

      fetch("/api/memory/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: cid }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(() => onMemoryUpdated(cid))
        .catch(() => {
          // update memori gagal — tidak fatal
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Koneksi bermasalah");
    } finally {
      setSending(false);
      setLive("");
      sendingRef.current?.focus();
    }
  }

  const empty = messages.length === 0 && !live;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel/60 md:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header percakapan */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <button
          onClick={onOpenSidebar}
          className="rounded-lg px-2 py-1 text-mist hover:text-night lg:hidden"
          aria-label="Buka sidebar"
        >
          ☰
        </button>
        <MiniAvatar mood={mood} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{title}</div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-kirimochi">● memori tersimpan</span>
            {folder && (
              <span className="truncate text-mist" title={folder}>
                workspace: {folder}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setFolderOpen(true)}
          title={folder ? `Folder: ${folder}` : "Arahkan folder workspace"}
          className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold transition hover:border-sakura/40 hover:text-night"
        >
          {folder ? "Folder" : "+ Folder"}
        </button>
        <button
          onClick={onNewChat}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-mist transition hover:text-night"
        >
          Baru
        </button>
      </div>

      {/* modal folder workspace */}
      {folderOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-panel p-5 shadow-2xl">
            <h3 className="text-lg font-extrabold">Folder workspace</h3>
            <p className="mt-1 text-xs text-mist">
              Tempat kamu menulis jawaban/PR di code editor (mis. Zed). Sensei hanya
              baca, tidak menulis — kamu yang nulis di editor kamu.
            </p>
            <input
              value={folderText}
              onChange={(e) => setFolderText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveFolder()}
              placeholder="/home/kamu/projek/latihan"
              className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm outline-none transition focus:border-sakura/50"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={pickFromManager}
                disabled={folderChecking}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold transition hover:text-night disabled:opacity-40"
              >
                {folderChecking ? "Memilih…" : "Pilih folder dari pengelola file"}
              </button>
              <button
                onClick={checkFolder}
                disabled={folderChecking}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold transition hover:text-night disabled:opacity-40"
              >
                {folderChecking ? "Memindai…" : "Pindai folder"}
              </button>
              {folderInfo && (
                <span
                  className={`text-xs ${folderInfo.ok ? "text-kirimochi" : "text-rose-300"}`}
                >
                  {folderInfo.text}
                </span>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setFolderOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-mist transition hover:text-night"
              >
                Batal
              </button>
              <button
                onClick={saveFolder}
                disabled={folderSaving}
                className="rounded-xl bg-gradient-to-r from-sakura to-mew px-4 py-2 text-xs font-bold text-white transition enabled:hover:brightness-110 disabled:opacity-40"
              >
                {folderSaving ? "Menyimpan…" : "Simpan folder"}
              </button>
            </div>
            {!currentId && (
              <p className="mt-3 text-[11px] text-mist">
                Percakapan baru: folder ini akan dijadikan folder default dan dipakai
                untuk percakapan berikutnya.
              </p>
            )}
          </div>
        </div>
      )}

      {/* daftar pesan */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <MentorAvatar name={mascotName} mood={mood} />
            <div>
              <div className="text-xl font-extrabold">
                {profile?.mascot || "Sensei"} siap membantumu
              </div>
              <p className="mt-1 text-sm text-mist">
                Ketik apa pun seperti biasa{" "}
                {profile?.language === "id" ? "ke ChatGPT" : "to an AI"} — progress
                kamu tidak akan dilupakan.
              </p>
            </div>
            <div className="flex max-w-md flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-night/80 transition hover:border-sakura/40 hover:text-night"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {totalMessages > messages.length && (
              <div className="flex justify-center pb-2 pt-1">
                <button
                  onClick={handleLoadEarlier}
                  disabled={loadingEarlier}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-mist transition hover:border-sakura/40 hover:text-night disabled:opacity-40"
                >
                  {loadingEarlier
                    ? "Memuat pesan sebelumnya…"
                    : `↑ Muat 50 pesan sebelumnya (${totalMessages - messages.length} tersisa)`}
                </button>
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-mew to-sakura/90 px-4 py-2.5 text-sm text-white shadow-lg shadow-mew/10 sm:max-w-[75%]">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex items-start gap-2.5">
                  <MiniAvatar mood={isMood(m.mood) ? m.mood : "netral"} />
                  <div className="min-w-0 max-w-[85%] flex-1 rounded-2xl rounded-tl-md border border-white/10 bg-panel2 px-4 py-3 sm:max-w-[80%]">
                    <Markdown>{m.content}</Markdown>
                  </div>
                </div>
              ),
            )}

            {live && (
              <div className="flex items-start gap-2.5">
                <MiniAvatar mood={mood} />
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-white/10 bg-panel2 px-4 py-3">
                  <Markdown>{live}</Markdown>
                  <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-sakura align-middle" />
                </div>
              </div>
            )}

            {sending && !live && (
              <div className="flex items-start gap-2.5">
                <MiniAvatar mood={mood} />
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-white/10 bg-panel2 px-4 py-3 text-sm text-mist">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sakura" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-mew [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-akari [animation-delay:300ms]" />
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/* composer */}
      <div className="border-t border-white/10 px-4 py-3">
        <div className="glass flex items-end gap-2 rounded-2xl p-2">
          <textarea
            ref={sendingRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Tanya Sensei apa saja… (Shift+Enter = baris baru)"
            className="max-h-40 min-h-[42px] flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-mist/70"
          />
          <button
            onClick={() => send()}
            disabled={sending || !input.trim()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-sakura to-mew px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sakura/20 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Kirim
          </button>
        </div>
      </div>
      </div>

      {/* panel vtuber & progress belajar (desktop) */}
      <div className="hidden w-96 lg:w-[420px] xl:w-[460px] shrink-0 flex-col border-l border-white/10 md:flex h-full min-h-0 bg-panel/30">
        {/* Bagian Atas: Avatar Mentor (FIXED / NON-SCROLLABLE) */}
        <div className="shrink-0 flex flex-col items-center gap-2.5 px-6 pt-6 pb-4 border-b border-white/10">
          <MentorAvatar
            name={mascotName}
            mood={mood}
            speaking={Boolean(sending && live)}
            thinking={Boolean(sending && !live)}
          />

          {/* Status speaking/thinking */}
          {sending && (
            <div className="text-center text-xs">
              {live ? (
                <p className="font-medium text-sakura animate-pulse">
                  Sedang berbicara…
                </p>
              ) : (
                <p className="font-medium text-mew animate-pulse">
                  Sedang berpikir…
                </p>
              )}
            </div>
          )}
        </div>

        {/* Bagian Bawah: Progress Belajar & Catatan Mentor (INDEPENDENTLY SCROLLABLE) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-5">
          {/* Section: Progress Belajar */}
          <section>
            <div className="mb-2.5 flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">
                <GraduationCap className="h-3.5 w-3.5 text-mew" />
                <span>Progress Belajar</span>
              </div>
              {topics.length > 0 && (
                <span className="text-[10px] font-medium text-mist/60">
                  {topics.length} topik
                </span>
              )}
            </div>

            {topics.length === 0 ? (
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-center text-xs text-mist/70">
                Belum ada catatan topik untuk sesi ini. Progress akan tercatat otomatis saat belajar.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {topics.map((t) => {
                  const meta = STATUS_META[t.status];
                  return (
                    <li
                      key={t.id}
                      className="rounded-xl border border-white/10 bg-panel2/60 p-3.5 shadow-sm transition hover:border-white/20"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`}
                          />
                          <span className="text-xs font-bold text-night break-words">
                            {t.name}
                          </span>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${meta.chip}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      {t.notes && (
                        <p className="mt-2 text-xs leading-relaxed text-mist/90 border-t border-white/5 pt-2 whitespace-pre-wrap break-words">
                          {t.notes}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Section: Catatan Mentor */}
          {memories.length > 0 && (
            <section>
              <div className="mb-2.5 flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sakura/80">
                  <BookOpen className="h-3.5 w-3.5 text-sakura" />
                  <span>Catatan {mascotName}</span>
                </div>
                <span className="text-[10px] font-medium text-mist/60">
                  {memories.length} catatan
                </span>
              </div>
              <ul className="space-y-2.5">
                {memories.slice(0, 20).map((m) => (
                  <li
                    key={m.id}
                    className="rounded-xl border border-sakura/20 bg-sakura/5 p-3.5 text-xs leading-relaxed text-night/85"
                  >
                    <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-sakura/90">
                      {m.type}
                    </div>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{m.content}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}