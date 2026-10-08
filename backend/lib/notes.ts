import type { Profile } from "./db";

const MAX_OUTPUT = 20_000;

export interface BuildNotePromptInput {
  profile: Profile;
  output: string;
  workspaceCtx: string;
}

/**
 * Prompt KAIDAH untuk mengubah SATU output mentor menjadi berkas catatan.
 * Sengaja terpisah dari system prompt / memory-update: proses ini "dadakan",
 * hanya berjalan saat pelajar menekan tombol Buatkan Catatan.
 */
export function buildNotePrompt(cfg: BuildNotePromptInput): string {
  const { profile, output, workspaceCtx } = cfg;
  return [
    `Kamu adalah ${profile.mascot}, mentor belajar pribadi ${profile.name}.`,
    "Tugasmu: ubah SATU output belajar di bawah menjadi berkas CATATAN yang rapi, padat, dan mudah dibaca ulang.",
    "",
    "ATURAN BERKAS:",
    "1. Jawabanmu HANYA berupa SATU blok berkas dengan format:",
    '   @@write("path/relatif/dari/folder-workspace/NamaCatatan.md")',
    "   <isi catatan>",
    "   @@end",
    "   Tidak boleh ada teks apa pun di luar blok (tanpa pembuka, tanpa penjelasan, tanpa pembatas ```).",
    '2. Path RELATIF terhadap folder workspace. Pilih lokasi paling masuk akal:',
    "   - Kalau output ini berkaitan dengan subfolder yang SUDAH ADA (mis. proyek1), simpan catatannya DI DALAM subfolder itu.",
    "   - Kalau belum ada subfolder yang cocok, simpan di akar folder workspace dengan nama deskriptif.",
    "3. Nama file huruf kecil, deskriptif, tanpa spasi (pakai '-' atau '_'), ekstensi .md. Ekstensi lain boleh kalau memang jelas lebih tepat.",
    "4. Susun catatan dengan Markdown yang menarik: judul, ringkasan singkat, poin-poin kunci, kode/rumus dalam blok ```, contoh, dan 1-2 soal latihan singkat untuk dibaca ulang.",
    "5. JANGAN menebak isi file yang tidak ada di output — ringkas dan rapikan hanya yang benar-benar muncul.",
    "6. Kalau output mentor berisi anotasi teknis (mis. tanda kurung '[FILE/FOLDER DITULIS...]'), abaikan anotasi itu.",
    "",
    "=== STRUKTUR FOLDER WORKSPACE (acu untuk menentukan path) ===",
    workspaceCtx || "(folder workspace tidak bisa dibaca)",
    "",
    "=== OUTPUT MENTOR YANG MAU DIJADIKAN CATATAN ===",
    output.slice(0, MAX_OUTPUT),
    "",
  ].join("\n");
}