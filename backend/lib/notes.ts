import type { Profile } from "./db";

const MAX_OUTPUT = 20_000;

export interface BuildNotePromptInput {
  profile: Profile;
  output: string;
  workspaceCtx: string;
  /** Berkas catatan topik yang SUDAH ADA — kalau diisi, prompt jadi mode merge/update. */
  existing?: { rel: string; content: string } | null;
}

/**
 * Prompt KAIDAH untuk mengubah SATU output mentor menjadi berkas catatan.
 * Sengaja terpisah dari system prompt / memory-update: proses ini "dadakan",
 * hanya berjalan saat pelajar menekan tombol Buatkan Catatan.
 * Kalau `existing` diisi (auto-note), tugasmu MERGE: tulis ulang SELURUH isi
 * berkas = isi lama + blok baru, dengan path yang SAMA persis.
 */
export function buildNotePrompt(cfg: BuildNotePromptInput): string {
  const { profile, output, workspaceCtx, existing } = cfg;
  const mergeRules = existing
    ? [
        "",
        "=== MODE UPDATE (berkas catatan topik SUDAH ADA) ===",
        `Berkas lama: "${existing.rel}" — isinya di bawah. Tugasmu: tulis ULANG SELURUH isi berkas itu sebagai gabungan RAPI antara isi lama dan blok materi BARU di bagian bawah.`,
        "ATURAN MERGE:",
        "1. Pertahankan semua isi lama yang masih relevan (jangan dibuang, jangan diulang dua kali).",
        "2. Tambahkan materi baru di bagian yang paling nyambung; kalau sub-bagian sudah ada, PERKAYA isinya — jangan duplikat judul yang sama.",
        "3. Susun ulang alur kalau perlu supaya tetap nyambung dari awal sampai akhir (seperti satu dokumen LKS yang terus tumbuh).",
        `4. Path WAJIB persis sama dengan berkas lama: ${existing.rel} (dalam blok @@write). Jangan bikin file baru.`,
        "5. Jaga panjang wajar (maksimal ~400 baris); gabungkan bagian lama yang terlalu panjang menjadi ringkasan padat bila perlu.",
        "",
        "=== ISI BERKAS LAMA ===",
        existing.content.slice(0, 20_000),
      ]
    : [];
  return [
    `Kamu adalah ${profile.mascot}, mentor belajar pribadi ${profile.name}.`,
    existing
      ? "Tugasmu: PERBARUI berkas catatan/LKS topik di bawah supaya memuat blok belajar BARU tanpa kehilangan isi lama."
      : "Tugasmu: ubah SATU output belajar di bawah menjadi berkas CATATAN yang rapi, padat, dan mudah dibaca ulang.",
    "",
    "ATURAN BERKAS:",
    "1. Jawabanmu HANYA berupa SATU blok berkas dengan format:",
    '   @@write("path/relatif/dari/folder-workspace/NamaCatatan.md")',
    "   <isi catatan>",
    "   @@end",
    "   Tidak boleh ada teks apa pun di luar blok (tanpa pembuka, tanpa penjelasan, tanpa pembatas ```).",
    ...(existing
      ? []
      : [
          '2. Path RELATIF terhadap folder workspace. Pilih lokasi paling masuk akal:',
          "   - Kalau output ini berkaitan dengan subfolder yang SUDAH ADA (mis. proyek1), simpan catatannya DI DALAM subfolder itu.",
          "   - Kalau belum ada subfolder yang cocok, simpan di akar folder workspace dengan nama deskriptif.",
        ]),
    "3. Nama file huruf kecil, deskriptif, tanpa spasi (pakai '-' atau '_'), ekstensi .md. Ekstensi lain boleh kalau memang jelas lebih tepat.",
    "4. Susun catatan dengan Markdown yang menarik: judul, ringkasan singkat, poin-poin kunci, kode/rumus dalam blok ```, contoh, dan 1-2 soal latihan singkat untuk dibaca ulang.",
    "5. JANGAN menebak isi file yang tidak ada di output — ringkas dan rapikan hanya yang benar-benar muncul.",
    "6. Kalau output mentor berisi anotasi teknis (mis. tanda kurung '[FILE/FOLDER DITULIS...]'), abaikan anotasi itu.",
    ...mergeRules,
    "",
    "=== STRUKTUR FOLDER WORKSPACE (acu untuk menentukan path) ===",
    workspaceCtx || "(folder workspace tidak bisa dibaca)",
    "",
    "=== OUTPUT MENTOR YANG MAU DIJADIKAN CATATAN ===",
    output.slice(0, MAX_OUTPUT),
    "",
  ].join("\n");
}