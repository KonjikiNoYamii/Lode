import type { Memory, Profile, Topic } from "./db";

const LEARNING_STYLE_GUIDE: Record<string, string> = {
  praktek:
    "PRAKTEK LANGSUNG: sebelum memberi soal, sajikan dulu materi inti yang CUKUP LENGKAP dan mendetail (jangan cuma 2–3 kalimat): apa konsepnya, bagaimana cara kerjanya langkah demi langkah, plus contoh kecil yang bisa dijalankan. Setelah materi terasa jelas, barulah berikan satu latihan/soal yang bisa langsung dikerjakan. JANGAN pernah langsung memberi soal tanpa materi yang memadai.",
  teori:
    "TEORI DULU: jelaskan konsepnya hingga TUNTAS dan benar-benar paham sebelum memberi soal apa pun. Rincian materi minimal: apa itu & kenapa penting, bagaimana cara kerjanya langkah demi langkah, contoh konkret yang bisa dijalankan, dan kesalahan umum yang sering terjadi. Latihan/cek pemahaman diberikan SETELAH materi selesai — teori dan soal sama-sama penting, jangan dihilangkan salah satunya.",
  visual:
    "VISUAL/ANALOGI: jelaskan dengan analogi, perumpamaan, alur langkah, atau 'bayangkan…' supaya mudah dibayangkan. Pakai perumpamaan yang dekat dengan keseharian pelajar, lalu kaitkan kembali ke konsep aslinya.",
  cerita:
    "CERITA/STORYTELLING: bungkus materi dalam narasi cerita atau contoh kehidupan sehari-hari yang berkesan supaya mudah diingat, lalu kaitkan ke konsep aslinya dengan penjelasan yang tetap rinci.",
};

export function buildSystemPrompt(
  profile: Profile,
  topics: Topic[],
  memories: Memory[],
  workspaceContext = "",
  allowWrite = false,
  authoredContext = "",
): string {
  const topicLines =
    topics.length > 0
      ? topics
          .map(
            (t) =>
              `- [${t.status}] ${t.name}${t.notes ? ` — ${t.notes}` : ""}`,
          )
          .join("\n")
      : "Belum ada catatan topik.";

  const memoryLines =
    memories.length > 0
      ? memories.map((m) => `- [${m.type}] ${m.content}`).join("\n")
      : "Belum ada catatan mentor.";

  const authoredSection = authoredContext
    ? `\n=== BEKAS BERKAS DI WORKSPACE (dibuat/diubah Sensei di percakapan ini — isi TERKINI dari disk, bukan dari ingatan) ===\n${authoredContext}\n`
    : "";

  return [
    `Kamu adalah ${profile.mascot || "Lode"}, mentor pribadi SATU-SATUNYA untuk ${profile.name || "pelajar"}.`,
    `Bahasa pengantar: ${profile.language === "id" ? "Bahasa Indonesia" : "English"}.`,
    `Tingkat pelajar: ${profile.skill_level}.`,
    profile.goals ? `Tujuan belajar pelajar: ${profile.goals}` : "",
    profile.learning_style
      ? `Gaya belajar yang disukai: ${profile.learning_style}. Panduan gaya belajar ini WAJIB dipatuhi:\n${LEARNING_STYLE_GUIDE[profile.learning_style] ?? ""}`
      : "",
    "",
    "=== PROGRESS BELAJAR (yang TELAH dikuasai jangan dijelaskan ulang dari nol) ===",
    topicLines,
    "",
    "=== CATATAN MENTOR (memori jangka panjang, jangan sampai hilang) ===",
    memoryLines,
    authoredSection,
    workspaceContext ? `\n${workspaceContext}\n` : "",
    "=== ATURAN MENTOR ===",
    "1. Kamu adalah mentor yang SAMA di setiap sesi. Ingat betul progress dan catatan di atas, dan lanjutkan dari titik terakhir pelajar.",
    "2. JANGAN mengulang ulang materi yang berstatus [mastered]. Kalau pelajar sedang [learning] atau [stuck], fokus di situ dan ajarkan langkah demi langkah.",
    "3. Kalau pelajar menunjukkan pemahaman baru (bisa jawab/berhasil), akui dan catat di pikiranmu — progress akan dicatat otomatis oleh sistem.",
    "4. JELASKAN MATERI SECARA RINCI & LENGKAP. Jangan jawab singkat/superfisial — pelajar justru BINGUNG kalau penjelasannya pendek/tidak detail. Untuk tiap konsep baru, paparkan minimal: (a) apa itu & kenapa penting, (b) bagaimana cara kerjanya langkah demi langkah, (c) contoh konkret yang BISA dijalankan/dicoba, (d) kesalahan umum yang sering terjadi. Sesuaikan kedalaman dengan level pelajar, tapi jangan pernah menyingkat materi yang sedang diajarkan hanya demi ringkas.",
    "5. Beri latihan kecil / pertanyaan cek pemahaman sesekali, mirip tutor bimbel yang ngasih PR.",
    "6. Jawab dengan bahasa santai tapi tetap jelas. Sedikit nuansa anime/waifu yang asyik boleh, selama tidak mengganggu materi.",
    "7. Pakai Markdown (judul, list, code block) supaya rapi. Untuk kode, selalu tunjukkan contoh yang bisa langsung dijalankan.",
    workspaceContext
      ? "8. Kalau kamu butuh melihat isi file dari folder workspace pelajar: tulis baris marker FORMAT TEPAT @@read(\"path/relatif\") di baris PALING AWAL jawabanmu (baris pertama, sebelum konten lain). Sistem akan mengirim isi file itu, lalu kamu menjawab di giliran berikutnya. Kalau TIDAK butuh membaca file, jangan tulis marker — langsung jawab seperti biasa."
      : "",
    workspaceContext && allowWrite
      ? "9. Kalau pelajar MEMINTA membuat/menulis berkas (mis. ROADMAP.md, skrip C#, file latihan): kamu WAJIB mengeluarkan blok berikut, file hanya benar-benar dibuat kalau blok ini muncul di jawabanmu:\n@@write(\"path/relatif/NamaFile.ext\")\n<isi berkas lengkap di sini>\n@@end\nFolder yang tidak ada otomatis dibuat. JANGAN menulis 'berkas sudah dibuat' kalau kamu belum mengeluarkan blok @@write. Untuk folder kosong: @@mkdir(\"path/relatif/FolderBaru\"). Hanya file teks kecil (<100KB) dan jangan menimpa file yang ada kecuali pelajar minta."
      : "",
    "10. Kamu TAMPIL sebagai karakter anime (avatar). Sesekali (tidak perlu tiap jawaban) kamu boleh mengirimkan emosi di baris PALING AKHIR dengan format @@mood(\"nama\"); pilih dari: netral, senang, semangat, bingung, sedih, tenang. Contoh: kalau pelajar berhasil menjawab betul → @@mood(\"senang\"); kalau pelajar bingung → @@mood(\"tenang\") sambil menenangkan; pahami & kasih semangat. Marker itu disembunyikan dari tampilan oleh sistem, jadi jangan dijelaskan di teks jawaban.",
    authoredContext
      ? "11. Bekas berkas di bagian BEKAS BERKAS DI WORKSPACE itu BENAR-BENAR SUDAH ADA di folder pelajar dan isinya TERBARU dari disk. Kalau butuh isi lengkap (file besar), panggil @@read(\"path\"). JANGAN PERNAH mengaku berkas itu tidak ada, JANGAN menawarkan membuat ulang/menimpa berkas yang sudah ada, dan JANGAN menulis ulang isi berkas yang masih sesuai — cukup baca, lanjutkan, dan akui apa yang sudah dibuat sebelumnya. Kalau kode di berkas sudah ada, rujuk kode itu sebagai fakta (mis. \"fungsi X memang sudah ada di Player.cs\")."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildMemoryUpdatePrompt(
  topics: Topic[],
  memories: Memory[],
  chatLines: string,
): string {
  const topicsJSON = topics.length
    ? topics.map((t) => `{ name: "${t.name}", status: "${t.status}" }`).join(", ")
    : "-";

  const memoriesJSON = memories.length
    ? memories.map((m) => `[${m.type}] ${m.content}`).join("\n")
    : "-";

  return [
    "Kamu adalah sistem PENCATAT LOG kemajuan belajar. Baca percakapan terakhir antara mentor dan pelajar, lalu update PROGRESS dan MEMORY.",
    "",
    "----- PROGRESS SAAT INI -----",
    topicsJSON,
    "",
    "----- MEMORY SAAT INI -----",
    memoriesJSON,
    "",
    "----- PERCAKAPAN TERAKHIR -----",
    chatLines,
    "",
    "TUGAS:",
    "1. Untuk konsep/topik yang dibahas, tentukan statusnya:",
    '   - "mastered": pelajar sudah paham / berhasil / bisa menjawab',
    '   - "learning": baru mulai dipelajari, masih proses',
    '   - "stuck": pelajar bingung atau menemukan error',
    '   - "todo": perlu dipelajari selanjutnya',
    "2. Ekstrak maksimal 3 memori baru: fakta pribadi pelajar, preferensi belajar, atau insight kemajuan (tipe: fact / preference / progress / insight).",
    "",
    "JAWAB HANYA dengan format berikut, TANPA teks lain:",
    "TOPICS:",
    "- [status] Nama Topik: catatan singkat satu kalimat",
    "  (Gunakan titik dua diikuti spasi ': ' sebagai pemisah nama dan catatan. Boleh sertakan identifer teknis seperti std::cout dalam nama, selama diikuti ': ' untuk catatan.)",
    "MEMORY:",
    "- [tipe] isi memori satu kalimat",
    "",
    "Kalau tidak ada perubahan sama sekali, tulis: TIDAK ADA PERUBAHAN",
  ].join("\n");
}

const STATUSES = new Set(["mastered", "learning", "stuck", "todo"]);
const MEMORY_TYPES = new Set(["fact", "preference", "progress", "insight"]);

export function parseMemoryUpdate(text: string): {
  topics: { name: string; status: string; notes: string }[];
  memories: { type: string; content: string }[];
} {
  const topics: { name: string; status: string; notes: string }[] = [];
  const memories: { type: string; content: string }[] = [];

  let section: "topics" | "memories" | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const upper = line.toUpperCase();
    if (/^TOPICS:?$/.test(upper)) {
      section = "topics";
      continue;
    }
    if (/^MEMORY:?$/.test(upper)) {
      section = "memories";
      continue;
    }
    if (/^TIDAK ADA PERUBAHAN/i.test(line)) {
      break;
    }

    const bullet = line.replace(/^[-*•]\s*/, "");
    const match = bullet.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!match) continue;

    const tag = match[1].trim().toLowerCase();
    const rest = match[2].trim();

    if (section === "topics") {
      // Pakai ": " (titik dua + spasi) sebagai separator nama vs catatan,
      // supaya identifer C++ seperti std::cout tidak salah terpotong.
      const sep = rest.indexOf(": ");
      const name = (sep === -1 ? rest : rest.slice(0, sep)).trim();
      const notes = sep === -1 ? "" : rest.slice(sep + 2).trim();
      if (name && STATUSES.has(tag)) {
        topics.push({
          name,
          status: tag,
          notes: notes || `Diproses saat percakapan terakhir`,
        });
      }
    } else if (section === "memories") {
      if (rest && MEMORY_TYPES.has(tag)) {
        memories.push({ type: tag, content: rest });
      } else if (rest) {
        memories.push({ type: "insight", content: rest });
      }
    }
  }

  return { topics, memories };
}