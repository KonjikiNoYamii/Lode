import { CARD_RATING_RULES, REVIEW_ONLY_RULES } from "./srs";

export type LearnMode = "auto" | "konsep" | "latihan" | "proyek" | "uji" | "ingat";

export const LEARN_MODES: LearnMode[] = [
  "auto",
  "konsep",
  "latihan",
  "proyek",
  "uji",
  "ingat",
];

export const MODE_META: Record<LearnMode, { label: string; hint: string }> = {
  auto: {
    label: "Auto",
    hint: "Lode sendiri yang memilih mode tiap giliran",
  },
  konsep: {
    label: "Konsep",
    hint: "Penjelasan mendalam, analogi, contoh langkah demi langkah",
  },
  latihan: {
    label: "Latihan",
    hint: "Soal bertingkat yang dikerjakan pelajar sendiri",
  },
  proyek: {
    label: "Proyek",
    hint: "Mengerjakan file asli di folder workspace",
  },
  uji: {
    label: "Uji",
    hint: "Soal penilaian tanpa banyak bantuan",
  },
  ingat: {
    label: "Ingat",
    hint: "Review kilat konsep yang sudah pernah dipelajari",
  },
};

const CONCRETE_MODES: LearnMode[] = ["konsep", "latihan", "proyek", "uji", "ingat"];

/**
 * Niat eksplisit pelajar. Selalu menang atas apa pun, termasuk kartu jatuh tempo.
 */
const STRONG_INTENT: { mode: LearnMode; re: RegExp }[] = [
  {
    mode: "uji",
    re: /\b(uji|ujian|quiz|kuis|exam|assessment|beri soal-soal|soal-soal)\b/i,
  },
  {
    mode: "ingat",
    re: /\b(ingat|review|ulang|recall|flashcard|kart(u|o)\s?ingatan|spaced)\b/i,
  },
];

/**
 * Niat longgar dari kata umum ("file", "kode", "paham", ...). Sengaja kalah oleh
 * kartu jatuh tempo: kalau tidak, hampir semua pesan menembak ke mode lain dan
 * daftar kartu tidak pernah sampai ke prompt — kartu jadi selamanya kotak 1.
 */
const WEAK_INTENT: { mode: LearnMode; re: RegExp }[] = [
  {
    mode: "proyek",
    re: /\b(proyek|project|bikin|buat|implement|refactor|file|berkas|folder|repo|kode|script|program)\b/i,
  },
  {
    mode: "latihan",
    re: /\b(latihan|drill|soal latihan|kerjakan soal|pecahkan soal)\b/i,
  },
  {
    mode: "konsep",
    re: /\b(jelaskan|apa itu|apa itu\b|mengerti|paham|bingung|nihil|clear|konsep dasar)\b/i,
  },
];

function matchIntent(
  list: { mode: LearnMode; re: RegExp }[],
  message: string,
  hasFolder: boolean,
): LearnMode | null {
  for (const { mode, re } of list) {
    if (!re.test(message)) continue;
    if (mode === "proyek" && !hasFolder) continue;
    return mode;
  }
  return null;
}

export interface ModeChoiceInput {
  message: string;
  mode: string;
  aiMode: string;
  hasFolder: boolean;
  dueCards: number;
  stuckCount: number;
  mastery: number;
}

export interface ModeChoice {
  mode: LearnMode;
  locked: boolean;
  reason: string;
}

export function normalizeMode(value: string | undefined | null): LearnMode {
  const clean = String(value ?? "").trim().toLowerCase();
  return LEARN_MODES.includes(clean as LearnMode) ? (clean as LearnMode) : "auto";
}

export function isLearnMode(value: string): value is LearnMode {
  return CONCRETE_MODES.includes(value as LearnMode);
}

export function chooseMode(input: ModeChoiceInput): ModeChoice {
  if (input.mode !== "auto") {
    const locked = normalizeMode(input.mode);
    if (locked === "proyek" && !input.hasFolder) {
      return { mode: "konsep", locked: false, reason: "mode proyek tanpa folder workspace" };
    }
    return { mode: locked, locked: true, reason: "dikunci manual" };
  }

  const strong = matchIntent(STRONG_INTENT, input.message, input.hasFolder);
  if (strong) {
    return { mode: strong, locked: false, reason: "kunci kata di pesan" };
  }

  if (input.dueCards > 0) {
    return { mode: "ingat", locked: false, reason: `${input.dueCards} kartu review jatuh tempo` };
  }

  const weak = matchIntent(WEAK_INTENT, input.message, input.hasFolder);
  if (weak) {
    return { mode: weak, locked: false, reason: "kunci kata di pesan" };
  }

  if (input.stuckCount > 0) {
    return { mode: "konsep", locked: false, reason: "ada topik yang buntu" };
  }
  // Jangan lanjut di mode "ingat" kalau tidak ada kartu yang bisa diuji —
  // kalau tidak, AI nyangkut di mode review tanpa kartu dan ikut mengarang materi.
  if (input.aiMode && isLearnMode(input.aiMode) && input.aiMode !== "ingat") {
    return { mode: input.aiMode, locked: false, reason: "lanjutan mode sebelumnya" };
  }
  if (input.mastery >= 60) {
    return { mode: "latihan", locked: false, reason: "mastery topik sudah ≥ 60%" };
  }
  return { mode: "konsep", locked: false, reason: "default" };
}

const MODE_INSTRUCTIONS: Record<Exclude<LearnMode, "auto">, string[]> = {
  konsep: [
    "MODE KONSEP — prioritas paham, belum ada soal: (1) apa itu & kenapa penting, (2) cara kerjanya langkah demi langkah, (3) analogi dari kehidupan pelajar, (4) contoh konkret yang bisa dijalankan, (5) kesalahan umum. Tutup dengan 1 pertanyaan cek pemahaman.",
  ],
  latihan: [
    "MODE LATIHAN — latihan bertahap: Beri 1-3 soal bertingkat (mudah → sedang → tantangan) tentang materi yang baru saja dibahas. WAJIB menunggu jawaban pelajar sebelum membahas solusi. JANGAN langsung memberi jawaban; beri petunjuk hanya kalau pelajar memintanya.",
  ],
  proyek: [
    "MODE PROYEK — bekerja di file asli. Baca dulu file yang relevan (@@read) sebelum mengubah apa pun, ubah sekecil mungkin agar target tercapai, dan selalu keluarkan blok @@write supaya benar-benar tersimpan. Gunakan bahasa dan gaya penulisan yang sama dengan isi file.",
  ],
  uji: [
    "MODE UJI — simulasi penilaian. Beri soal tanpa spoiler jawaban dan tanpa petunjuk awal. Tunggu jawaban pelajar, lalu nilai JUJUR: kata mana yang tepat, mana yang salah, dan beri koreksi. Jangan menoleransi jawaban setengah benar sebagai benar.",
  ],
  ingat: [
    "MODE INGAT — review kilat. Satu konsep per giliran: tanya kartu, tunggu jawaban pelajar, koreksi singkat, lalu lanjut. Hanya bahas konsep yang sudah pernah dipelajari; jangan menambah materi baru.",
  ],
};

export function buildModeContext(
  mode: LearnMode,
  reason: string,
  locked: boolean,
  review = "",
): string {
  if (mode === "auto") return "";
  const instructions = MODE_INSTRUCTIONS[mode];
  // Penilaian kartu ikut di mode apa pun selama masih ada kartu jatuh tempo:
  // Lode menilai penguasaan pelajar sambil mengajar, bukan cuma saat diminta review.
  const rating = review
    ? [...(mode === "ingat" ? REVIEW_ONLY_RULES : []), ...CARD_RATING_RULES, review]
    : [];
  return [
    `=== MODE BELAJAR SEKARANG: ${MODE_META[mode].label.toUpperCase()} ===`,
    `Alasan: ${reason}. ${locked ? "Mode ini dikunci oleh pelajar, jadi PATUHI dan jangan berganti." : "Mode ini dipilih otomatis oleh sistem."}`,
    ...instructions,
    ...rating,
    `Boleh pindah mode kalau alasannya jelas: tulis marker @@mode("konsep"|"latihan"|"proyek"|"uji"|"ingat") di baris PALING AKHIR jawabanmu. Marker itu disembunyikan dari tampilan.`,
  ].join("\n");
}

export function stripModeMarkers(
  text: string,
  sink?: Map<LearnMode, LearnMode>,
): string {
  return text.replace(
    /@@mode\(\s*"([a-z]+)"\s*\)/gi,
    (match, raw: string) => {
      const mode = raw.toLowerCase();
      if (!isLearnMode(mode)) return match;
      if (sink) sink.set(mode, mode);
      return "";
    },
  );
}
