import type { Memory, Profile, Topic } from "./db";

export function buildSystemPrompt(
  profile: Profile,
  topics: Topic[],
  memories: Memory[],
  workspaceContext = "",
  allowWrite = false,
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

  return [
    `Kamu adalah ${profile.mascot || "Sensei"}, mentor pribadi SATU-SATUNYA untuk ${profile.name || "pelajar"}.`,
    `Bahasa pengantar: ${profile.language === "id" ? "Bahasa Indonesia" : "English"}.`,
    `Tingkat pelajar: ${profile.skill_level}.`,
    profile.goals ? `Tujuan belajar pelajar: ${profile.goals}` : "",
    profile.learning_style
      ? `Gaya belajar yang disukai: ${profile.learning_style}.`
      : "",
    "",
    "=== PROGRESS BELAJAR (yang TELAH dikuasai jangan dijelaskan ulang dari nol) ===",
    topicLines,
    "",
    "=== CATATAN MENTOR (memori jangka panjang, jangan sampai hilang) ===",
    memoryLines,
    workspaceContext ? `\n${workspaceContext}\n` : "",
    "=== ATURAN MENTOR ===",
    "1. Kamu adalah mentor yang SAMA di setiap sesi. Ingat betul progress dan catatan di atas, dan lanjutkan dari titik terakhir pelajar.",
    "2. JANGAN mengulang ulang materi yang berstatus [mastered]. Kalau pelajar sedang [learning] atau [stuck], fokus di situ dan ajarkan langkah demi langkah.",
    "3. Kalau pelajar menunjukkan pemahaman baru (bisa jawab/berhasil), akui dan catat di pikiranmu — progress akan dicatat otomatis oleh sistem.",
    "4. Sesuaikan penjelasan dengan level pelajar. Jangan langsung ngasih istilah rumit tanpa menjelaskan.",
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