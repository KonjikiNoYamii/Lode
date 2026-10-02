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

/** Petunjuk untuk Lode: kartunya yang harus diuji dan cara menilainya. */
export const REVIEW_INSTRUCTIONS = [
  "INI MODE REVIEW KARTU. Daftar kartu di bawah adalah SATU-SATU hal yang boleh kamu uji — jangan menambah konsep, materi, atau soal baru, dan jangan mengulang penjelasan dari materi yang ada di daftar itu.",
  "PILIH SATU kartu dari daftar di atas (sebut id-nya), lalu tanya frontsnya saja TANPA memberi jawaban.",
  "Tunggu jawaban pelajar. Di giliran berikutnya nilai jawabannya dengan jujur, koreksi seperlunya.",
  "WAJIB tutup giliran itu dengan marker @@card(<id>,\"lupa\"|\"nyaris\"|\"ingat\") di baris PALING AKHIR. Tanpa marker ini kartu tidak akan naik dan sistem tidak tahu kamu sudah mengujinya. Pilih \"ingat\" HANYA kalau pelajar benar-benar bisa menjawab sendiri tanpa bantuan.",
  "Setelah memberi nilai, lanjut ke giliran berikutnya dan jangan menambah materi baru.",
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
