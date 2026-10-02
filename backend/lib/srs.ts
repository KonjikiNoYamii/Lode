import { FIRST_CARD_DELAY_DAYS, MAX_CARD_BOX, type ReviewCard } from "./db";

export type CardRating = "lupa" | "nyaris" | "ingat";

export const CARD_RATINGS: CardRating[] = ["lupa", "nyaris", "ingat"];

export const MAX_BOX = MAX_CARD_BOX;
export const BOX_INTERVALS_DAYS = [1, 2, 4, 8, 16];
const LAPSE_DELAY_MINUTES = 10;

export function isCardRating(value: unknown): value is CardRating {
  return CARD_RATINGS.includes(String(value) as CardRating);
}

export function isDue(card: ReviewCard, now: Date = new Date()): boolean {
  return card.due_at <= toSqlite(now);
}

export function toSqlite(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Tanggal review pertama untuk kartu baru: besok, supaya materi baru tidak langsung diuji. */
export function firstDueAt(now: Date = new Date()): string {
  return toSqlite(new Date(now.getTime() + FIRST_CARD_DELAY_DAYS * 86_400_000));
}

export interface Schedule {
  box: number;
  dueAt: string;
  lapses: number;
}

export function scheduleReview(
  box: number,
  rating: CardRating,
  lapses: number,
  now: Date = new Date(),
): Schedule {
  const current = Math.max(1, Math.min(MAX_BOX, Math.trunc(box) || 1));
  if (rating === "lupa") {
    return {
      box: 1,
      dueAt: toSqlite(new Date(now.getTime() + LAPSE_DELAY_MINUTES * 60_000)),
      lapses: lapses + 1,
    };
  }
  if (rating === "nyaris") {
    return {
      box: current,
      dueAt: toSqlite(new Date(now.getTime() + 86_400_000)),
      lapses,
    };
  }
  const next = Math.min(MAX_BOX, current + 1);
  return {
    box: next,
    dueAt: toSqlite(
      new Date(now.getTime() + BOX_INTERVALS_DAYS[next - 1] * 86_400_000),
    ),
    lapses,
  };
}

export function boxLabel(box: number): string {
  return `Kotak ${Math.max(1, Math.min(MAX_BOX, Math.trunc(box) || 1))}/${MAX_BOX}`;
}

/** Kartu yang siap diuji; yang paling lama tidak jatuh tempo didahulukan. */
export function dueCards(cards: ReviewCard[], now: Date = new Date()): ReviewCard[] {
  return cards
    .filter((c) => isDue(c, now))
    .sort((a, b) => (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : a.id - b.id));
}

export function buildReviewContext(cards: ReviewCard[], limit = 5): string {
  if (cards.length === 0) return "";
  const lines = cards
    .slice(0, limit)
    .map((c) => `  - [id=${c.id}] ${c.front}${c.back ? ` → ${c.back}` : ""}`);
  return `Kartu review jatuh tempo (${cards.length}):\n${lines.join("\n")}`;
}

/**
 * Penilaian kartu adalah TUGAS LODE, bukan tugas pelajar. Berlaku di SEMUA mode,
 * bukan cuma saat mode review: kalau sedang mengajar, dia tetap menilai jawaban
 * pelajar terhadap kartu yang jatuh tempo.
 */
export const CARD_RATING_RULES = [
  "TUGASMU SETIAP GILIRAN: nilai jawaban pelajar terhadap kartu review yang jatuh tempo di daftar di bawah, lalu tulis marker @@card(<id>,\"lupa\"|\"nyaris\"|\"ingat\") di baris PALING AKHIR jawabanmu. Penilaian ini bagian dari mengajar — jangan menunggu pelajar minta diuji.",
  "Nilai dari ISI jawaban pelajar, bukan dari nada baik atau keinginanmu:",
  '  "ingat"  = pelajar benar-benar bisa menjelaskan/menjalankan sendiri TANPA bantuanmu (hint kecil tetap boleh kalau memang perlu).',
  '  "nyaris" = inti sudah benar tapi ada bagian yang masih salah atau belum bisa dia jelaskan sendiri.',
  '  "lupa"   = salah, belum bisa, atau cuma mengulang kalimatmu balik padamu.',
  "Jangan naikkan nilai cuma supaya suasananya enak, dan jangan turunkan asal-asalan. Jujur saja.",
  "Marker itu disembunyikan dari tampilan dan itu satu-satunya cara sistem tahu kartu sudah dinilai — TANPA marker, kartu tidak akan naik dan akan tetap di kotak yang sama selamanya.",
];

/** Tambahan khusus mode review: kartu jadi satu-satunya agenda giliran itu. */
export const REVIEW_ONLY_RULES = [
  "MODE REVIEW: daftar kartu di bawah adalah SATU-SATU hal yang boleh kamu uji. Jangan menambah konsep, materi, atau soal baru.",
  "Satu kartu per giliran: sebut id-nya, lalu tanya frontsnya saja TANPA memberi jawaban. Tunggu jawabannya, lalu nilai di giliran berikutnya.",
];

export function parseCardMarkers(text: string): {
  ratings: { id: number; rating: CardRating }[];
  clean: string;
} {
  const sink = new Map<number, CardRating>();
  const clean = stripCardMarkers(text, sink);
  return {
    ratings: [...sink.entries()].map(([id, rating]) => ({ id, rating })),
    clean,
  };
}

export function stripCardMarkers(
  text: string,
  sink?: Map<number, CardRating>,
): string {
  return text.replace(
    /@@card\(\s*(\d+)\s*,\s*"([a-z]+)"\s*\)/gi,
    (match, rawId: string, rawRating: string) => {
      const id = Number(rawId);
      const rating = rawRating.toLowerCase();
      if (!Number.isSafeInteger(id) || id <= 0 || !isCardRating(rating)) return match;
      if (sink) sink.set(id, rating);
      return "";
    },
  );
}
