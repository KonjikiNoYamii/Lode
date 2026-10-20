import type { Message } from "./db";

// Guardrail: validasi & perapian output AI sebelum disimpan ke database.
//
// Latar belakang: provider kadang menulis ulang jawaban di tengah streaming,
// hasil dua versi tertempel jadi satu pesan (blok duplikat), skrip terpotong di
// tengah blok kode, atau marker perintah (@@write/@@plan/...) bocor ke teks.
// Pesan rusak yang tersimpan akan ikut dikirim sebagai history ke giliran
// berikutnya dan meracuni konteks. Modul ini menjaga titik lahirnya.

export type GuardFlag =
  | "unbalanced_fence" // jumlah ``` ganjil / blok kode menggantung
  | "duplicated_block" // blok panjang berulang dalam 1 pesan (dua versi tertempel)
  | "marker_leak"; // marker perintah AI masih tersisa padahal sudah di-strip

export type Risk = "low" | "high";

export interface GuardResult {
  ok: boolean;
  flags: GuardFlag[];
  risk: Risk;
}

const FENCE = "```";
const FENCE_RE = /```/g;

// Threshold konservatif: variasi label/kalimat pendek yang wajar tidak dianggap
// duplikasi. Blok berulang ini adalah tanda dua versi jawaban tertempel.
const MIN_DUP_LINES = 6;
const MIN_DUP_CHARS = 300;
const MAX_BLOCK_LINES = 80;
const SKIP_HEAVY_ABOVE = 200_000;

// Marker perintah yang diproduksi model (Family A). Kalau masih ada di teks
// setelah `stripMarkers`, berarti malformed/bocor.
const MARKER_LEAK_RE =
  /@@\s*(?:write|mkdir|read|plan|mode|mood|more)\s*(?:\([^)]*\))?/gi;

function countFences(text: string): number {
  return (text.match(FENCE_RE) ?? []).length;
}

function normalizedLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

/** Deteksi blok panjang yang muncul dua kali dalam 1 pesan. */
function hasDuplicatedBlock(text: string): boolean {
  if (text.length > SKIP_HEAVY_ABOVE) return false;
  const lines = normalizedLines(text);
  const n = lines.length;
  if (n < MIN_DUP_LINES * 2) return false;
  for (let i = 0; i + MIN_DUP_LINES < n; i++) {
    const seed = lines[i];
    for (let j = i + MIN_DUP_LINES; j + MIN_DUP_LINES <= n; j++) {
      if (lines[j] !== seed) continue;
      let k = 0;
      while (
        k < MAX_BLOCK_LINES &&
        i + k < n &&
        j + k < n &&
        lines[i + k] === lines[j + k]
      ) {
        k += 1;
      }
      if (k < MIN_DUP_LINES) continue;
      const chars = lines.slice(i, i + k).reduce((s, l) => s + l.length, 0);
      if (chars >= MIN_DUP_CHARS) return true;
    }
  }
  return false;
}

function leakedMarkers(text: string): GuardFlag[] {
  const flags: GuardFlag[] = [];
  MARKER_LEAK_RE.lastIndex = 0;
  if (MARKER_LEAK_RE.test(text)) flags.push("marker_leak");
  return flags;
}

export function validateOutput(text: string): GuardResult {
  const t = (text ?? "").trim();
  const flags: GuardFlag[] = [];
  if (!t) return { ok: true, flags, risk: "low" };
  if (countFences(t) % 2 === 1) flags.push("unbalanced_fence");
  if (hasDuplicatedBlock(t)) flags.push("duplicated_block");
  flags.push(...leakedMarkers(t));
  const risk: Risk = flags.length > 0 ? "high" : "low";
  return { ok: flags.length === 0, flags, risk };
}

/** Perapian ringan yang aman: tutup blok kode menggantung, buang marker bocor. */
export function sanitizeText(text: string): string {
  let out = text ?? "";
  out = out.replace(MARKER_LEAK_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (out && countFences(out) % 2 === 1) {
    out = `${out}${out.endsWith("\n") ? "" : "\n"}\n${FENCE}`;
  }
  return out;
}

const FLAG_DESC: Record<GuardFlag, string> = {
  unbalanced_fence: "blok kode tidak seimbang",
  duplicated_block: "bagian respons berulang menyatu",
  marker_leak: "marker perintah bocor",
};

/** Nota transparan yang disisipkan ke respons bila ada bagian yang dirapikan. */
export function formatNotice(flags: GuardFlag[]): string {
  const seen = [...new Set(flags)];
  if (seen.length === 0) return "";
  const desc = seen
    .map((f) => FLAG_DESC[f])
    .filter(Boolean)
    .join(" dan ");
  return `> ⚠️ **Catatan sistem:** respons AI terdeteksi bermasalah (${desc}) dan dirapikan otomatis supaya kelanjutan belajar tetap bersih.`;
}

/**
 * Pembersihan history sebelum dikirim ke AI:
 * 1. dedup pesan beruntun identik (tanda kirim ganda),
 * 2. RAPIKAN (bukan buang) pesan assistant yang formatnya rusak — tutup blok
 *    kode menggantung, buang marker bocor — supaya history tidak pernah bolong.
 *
 * Tidak mengubah DB: hanya bentuk yang dikirim ke model. Pesan yang sama
 * sekali rusak tidak lagi menghilang dari konteks, jadi model tidak kehilangan
 * jejak jawaban sebelumnya (dulu itu memicu balasan "sebagai AI…").
 */
export function sanitizeStale(
  messages: Pick<Message, "id" | "role" | "content">[],
): Pick<Message, "id" | "role" | "content">[] {
  const deduped: typeof messages = [];
  for (const m of messages) {
    const prev = deduped[deduped.length - 1];
    const content = (m.content ?? "").trim();
    if (prev && prev.role === m.role && (prev.content ?? "").trim() === content) {
      // pertahankan kejadian terbaru agar konteks menunjuk pesan yang sebenarnya
      deduped[deduped.length - 1] = m;
      continue;
    }
    deduped.push(m);
  }
  const repaired = deduped.map((m) => {
    if (m.role !== "assistant") return m;
    if (validateOutput(m.content ?? "").risk !== "high") return m;
    return { ...m, content: sanitizeText(m.content ?? "") };
  });
  return repaired.length > 0 ? repaired : deduped.slice(-1);
}