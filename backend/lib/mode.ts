export type LearnMode = "auto" | "konsep" | "latihan" | "proyek" | "uji";

export const LEARN_MODES: LearnMode[] = [
  "auto",
  "konsep",
  "latihan",
  "proyek",
  "uji",
];

export const MODE_META: Record<LearnMode, { label: string; hint: string }> = {
  auto: {
    label: "Auto",
    hint: "Rangkaian materi lalu soal otomatis — Lode yang memilih mode tiap giliran",
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
};

const CONCRETE_MODES: LearnMode[] = ["konsep", "latihan", "proyek", "uji"];

/** Niat pelajar dari kata kunci di pesan. */
const MODE_INTENT: { mode: LearnMode; re: RegExp }[] = [
  {
    mode: "uji",
    re: /\b(uji|ujian|quiz|kuis|exam|assessment|beri soal-soal|soal-soal)\b/i,
  },
  {
    mode: "uji",
    re: /\b(ingat|review|ulang|recall|flashcard|kart(u|o)\s?ingatan|spaced)\b/i,
  },
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

function matchIntent(message: string, hasFolder: boolean): LearnMode | null {
  for (const { mode, re } of MODE_INTENT) {
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

  const keyed = matchIntent(input.message, input.hasFolder);
  if (keyed) {
    return { mode: keyed, locked: false, reason: "kunci kata di pesan" };
  }

  if (input.stuckCount > 0) {
    return { mode: "konsep", locked: false, reason: "ada topik yang buntu" };
  }
  if (input.aiMode && isLearnMode(input.aiMode)) {
    return { mode: input.aiMode, locked: false, reason: "lanjutan mode sebelumnya" };
  }
  if (input.mastery >= 60) {
    return { mode: "latihan", locked: false, reason: "mastery topik sudah ≥ 60%" };
  }
  return { mode: "konsep", locked: false, reason: "default" };
}

const MODE_INSTRUCTIONS: Record<Exclude<LearnMode, "auto">, string[]> = {
  konsep: [
    "MODE KONSEP — prioritas paham, belum ada soal: (1) apa itu & kenapa penting, (2) cara kerjanya langkah demi langkah, (3) analogi dari kehidupan pelajar, (4) contoh konkret yang bisa dijalankan, (5) kesalahan umum. Tetap JANGAN membajak semua materi sekaligus — kalau topiknya punya banyak bagian, ajarkan satu bagian saja tiap giliran. Tutup dengan 1 pertanyaan cek pemahaman HANYA tentang bagian yang barusan kamu ajarkan, JANGAN menguji materi yang belum dibahas; kalau giliran ini memakai @@more untuk lanjut otomatis ke bagian berikutnya, tunda pertanyaan cek pemahaman sampai bagian terakhir.",
  ],
  latihan: [
    "MODE LATIHAN — latihan bertahap: Beri 1-3 soal bertingkat (mudah → sedang → tantangan) tentang materi yang SUDAH diajarkan (di pesan ini atau sebelumnya). WAJIB menunggu jawaban pelajar sebelum membahas solusi. JANGAN langsung memberi jawaban; beri petunjuk hanya kalau pelajar memintanya.",
  ],
  proyek: [
    "MODE PROYEK — bekerja di file asli. Baca dulu file yang relevan (@@read) sebelum mengubah apa pun, ubah sekecil mungkin agar target tercapai, dan selalu keluarkan blok @@write supaya benar-benar tersimpan. Gunakan bahasa dan gaya penulisan yang sama dengan isi file.",
  ],
  uji: [
    "MODE UJI — simulasi penilaian. Beri soal tanpa spoiler jawaban dan tanpa petunjuk awal. Tunggu jawaban pelajar, lalu nilai JUJUR: kata mana yang tepat, mana yang salah, dan beri koreksi. Jangan menoleransi jawaban setengah benar sebagai benar.",
  ],
};

/** Instruksi fase MATERI di mode auto: output murni materi, soal menyusul otomatis. */
const KONSEP_AUTO_INSTRUCTION =
  "MODE KONSEP — FASE MATERI (sistem auto): (1) apa itu & kenapa penting, (2) cara kerjanya langkah demi langkah, (3) analogi dari kehidupan pelajar, (4) contoh konkret yang bisa dijalankan, (5) kesalahan umum. Ajarkan SATU bagian saja tiap giliran dan sambungkan dengan bagian sebelumnya; kalau masih ada bagian berikutnya, akhiri baris terakhir dengan @@more(\"judul bagian berikutnya\") (maksimal 9 bagian per giliran). PENTING: output ini MATERI MURNI — JANGAN menutup dengan soal, latihan, atau cek pemahaman, dan JANGAN memberi jawaban praktik; soal akan menyusul OTOMATIS sebagai output terpisah begitu blok materi selesai. Walaupun panduan gaya belajar menyebut 'beri latihan setelah materi', serahkan soal pada sistem.";

/**
 * Penanda multi-bagian lintas mode: saat alur auto aktif di mode selain konsep,
 * mentor juga boleh memecah pekerjaan jadi beberapa output berurutan lewat
 * @@more. Tanpa ini, hanya mode konsep yang bisa menghasilkan rangkaian panjang;
 * mode uji/latihan/proyek terpaksa memampatkan semuanya ke satu output pendek.
 */
const MULTIPART_TAIL =
  'Kalau cakupan permintaan pelajar besar (mis. "poin 6 sampai akhir", beberapa bagian/sub-topik, atau beberapa kelompok soal), JANGAN memampatkan semuanya ke satu jawaban: kerjakan SATU bagian/sub-topik saja di output ini, lalu kalau masih ada lanjutan, akhiri baris terakhir dengan @@more("judul bagian berikutnya") supaya sistem otomatis melanjutkan ke bagian itu sebagai output terpisah (maksimal 9 bagian per giliran). Jaga kedalaman setiap bagian — lebih baik beberapa output yang tuntas daripada satu output yang dangkal.';

/** Instruksi fase SOAL di mode auto (dipicu otomatis setelah blok materi). */
const SOAL_PHASE_INSTRUCTION =
  "MODE LATIHAN — FASE SOAL OTOMATIS. Output ini HANYA berisi latihan/soal tentang materi yang BARU SAJA kamu ajarkan di giliran ini — tanpa menjelaskan ulang materinya, tanpa materi baru. Kalau di giliran ini TIDAK ada materi baru (mis. kamu hanya menjawab pertanyaan status/meta dari pelajar), jangan mengarang materi: buatlah soal RECALL/penguatan tentang topik yang masih [learning]/[stuck] di progress. Isi 2-4 butir campuran: (a) 1 butir RECALL singkat tentang materi blok SEBELUMNYA supaya nyambung dan benar-benar diulang, (b) 1-2 butir tentang konsep inti blok ini, (c) untuk keterampilan praktis/koding, utamakan TUGAS PRAKTIK konkret yang dikerjakan sendiri (mis. 'buatlah file …, tulis script …, jalankan lalu perbaiki errornya') — bukan kuis pilihan ganda pendek yang membosankan. JANGAN pernah menguji materi yang belum pernah diajarkan. JANGAN menulis solusi/jawaban; beri petunjuk hanya kalau pelajar meminta. Tunggu pelajar mengerjakan sebelum melangkah.";

export interface ModeContextOptions {
  /** Mode auto aktif: soal dipisah jadi output terpisah. */
  autoFlow?: boolean;
  /** Fase soal pada alur auto (lanjutan continuePart yang dipicu sistem). */
  phase?: "soal";
}

export function buildModeContext(
  mode: LearnMode,
  reason: string,
  locked: boolean,
  options: ModeContextOptions = {},
): string {
  if (mode === "auto") return "";
  const soalPhase = options.phase === "soal" && mode === "latihan";
  const materiAuto = options.autoFlow && mode === "konsep" && !soalPhase;
  // Alur auto di mode selain konsep: tetap pakai instruksi mode, tapi diberi
  // kemampuan memecah pekerjaan jadi beberapa output lewat @@more supaya tidak
  // memampatkan cakupan besar ke satu jawaban dangkal.
  const multipartAuto = Boolean(options.autoFlow) && !soalPhase && !materiAuto;
  const baseInstructions = materiAuto
    ? [KONSEP_AUTO_INSTRUCTION]
    : MODE_INSTRUCTIONS[mode];
  const instructions = soalPhase ? [SOAL_PHASE_INSTRUCTION] : baseInstructions;
  const tag = soalPhase
    ? " — FASE SOAL (AUTO)"
    : materiAuto
      ? " — FASE MATERI (AUTO)"
      : "";
  return [
    `=== MODE BELAJAR SEKARANG: ${MODE_META[mode].label.toUpperCase()}${tag} ===`,
    `Alasan: ${reason}. ${locked ? "Mode ini dikunci oleh pelajar, jadi PATUHI dan jangan berganti." : "Mode ini dipilih otomatis oleh sistem."}`,
    ...instructions,
    multipartAuto ? MULTIPART_TAIL : "",
    soalPhase
      ? "Jangan pakai @@more, jangan tulis marker @@mode, dan jangan menjelaskan materi baru di output ini."
      : `Boleh pindah mode kalau alasannya jelas: tulis marker @@mode("konsep"|"latihan"|"proyek"|"uji") di baris PALING AKHIR jawabanmu. Marker itu disembunyikan dari tampilan.`,
  ].filter(Boolean).join("\n");
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

// ---------------------------------------------------------------------------
// Peta output (outline) untuk giliran panjang.
//
// Masalah: untuk cakupan besar (mis. "poin 6 sampai akhir"), satu output tidak
// cukup, dan meminta model mengarang banyak bagian sekaligus membuat ia kehabisan
// materi lalu mengulang. Solusi: minta PETA (daftar judul bagian) lebih dulu,
// simpan, lalu isi satu bagian per request. Model hanya "mengisi" slot yang sudah
// ditentukan → konsisten & tidak berulang.
// ---------------------------------------------------------------------------

/** Marker peta: baris judul bagian dipisah newline, diapit @@outline(...)...@@end. */
export const OUTLINE_RE = /@@outline\s*\n([\s\S]*?)\n?@@end/;

/** Instruksi membuat peta: minta daftar judul bagian saja, tanpa isi. */
export const OUTLINE_INSTRUCTION =
  "SISTEM (internal, bukan pesan pelajar): permintaan pelajar ini mencakup cakupan BESAR yang tidak cukup dijawab satu kali. JANGAN menjawab materinya sekarang. Tugasmu HANYA menyusun PETA/BLUEPRINT: daftar singkat judul bagian yang akan kamu ajarkan secara berurutan untuk menuntaskan permintaan itu. ATURAN: (1) 3 sampai 8 bagian sesuai kebutuhan nyata — jangan dipaksa banyak, jangan dipaksa sedikit; (2) tiap judul singkat (3-8 kata), spesifik, dan berurutan secara logis dari materi paling awal yang diminta sampai akhir; (3) jangan ada judul yang tumpang tindih/duplikat; (4) jangan sertakan isi materi, penjelasan, atau soal di peta. Keluarkan HANYA dalam format berikut, satu judul per baris, tanpa teks lain di luar blok:\n@@outline\nJudul bagian pertama\nJudul bagian kedua\n@@end";

/** Instruksi mengisi satu bagian dari peta. */
export function buildPartInstruction(index: number, items: string[]): string {
  const total = items.length;
  const current = items[index] ?? "";
  const list = items.map((t, i) => `${i + 1}. ${t}`).join("\n");
  return [
    "SISTEM (internal, bukan pesan pelajar): kamu sedang mengerjakan GILIRAN PANJANG yang sudah direncanakan. PETA bagian yang sudah kamu susun:",
    list,
    `Sekarang tulis isi untuk **bagian ke-${index + 1} dari ${total}: "${current}"** — dan HANYA bagian ini.`,
    "- Ajarkan/tuntaskan bagian ini secara mendalam dan lengkap (apa & kenapa penting, cara kerja langkah demi langkah, analogi bila relevan, contoh konkret yang bisa dijalankan, 1-2 kesalahan umum).",
    "- JANGAN menulis isi bagian lain, JANGAN mengulang bagian sebelumnya (yang sudah tertulis di atas dianggap sudah dibaca pelajar), JANGAN menyebut nomor bagian lain dalam bentuk isi.",
    "- Bertitik-tolak dari PETA di atas: bagian ini boleh menyambung dari materi sebelumnya, tapi sisanya diserahkan ke giliran berikutnya.",
    "- JANGAN menutup dengan soal/latihan/cek pemahaman — soal akan menyusul sebagai output terpisah setelah semua bagian selesai.",
    "- JANGAN mengirim marker apa pun (tanpa @@more) — sistem yang melanjutkan ke bagian berikutnya.",
  ].join("\n");
}

/** Ambil daftar judul dari teks jawaban peta. */
export function parseOutline(text: string): string[] {
  const m = text.match(OUTLINE_RE);
  const block = m ? m[1] : "";
  return block
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]?\s*\d*[.)]?\s*/, "").trim())
    .filter((l) => l.length > 0 && l.length <= 80)
    .slice(0, 8);
}
