import type { Memory, Profile, Topic } from "./db";
import { REINFORCE_REQUIRED } from "./db";

/** Topik yang belum punya cukup bukti kuat — wajib diperkuat sebelum materi baru. */
function pendingTopics(topics: Topic[]): Topic[] {
  return topics
    .filter(
      (t) =>
        (t.status === "learning" || t.status === "stuck") &&
        (t.strong_evidence ?? 0) < REINFORCE_REQUIRED,
    )
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

function buildReinforcementContext(topics: Topic[]): string {
  const pending = pendingTopics(topics);
  if (pending.length === 0) return "";

  const active = pending[0];
  const need = REINFORCE_REQUIRED - Math.min(active.strong_evidence ?? 0, REINFORCE_REQUIRED);
  const lines = pending
    .slice(0, 4)
    .map(
      (t) =>
        `- [${t.status}] ${t.name} — penguatan ${Math.min(t.strong_evidence ?? 0, REINFORCE_REQUIRED)}/${REINFORCE_REQUIRED}${t.mastery ? ` (mastery ${t.mastery}%)` : ""}`,
    )
    .join("\n");

  return [
    "=== REINFORCEMENT WAJIB (BELUM BOLEH LANJUT MATERI BARU) ===",
    lines,
    "Aturan keras untuk bagian ini:",
    `1. Topik paling atas "${active.name}" adalah topik yang paling baru kamu ajarkan — masih butuh ${need} bukti kuat lagi sebelum boleh dianggap selesai.`,
    "2. OUTPUT SEKARANG WAJIB berurutan: (a) nilai jawaban pelajar yang terakhir dengan jujur, (b) PERKUAT topik paling atas — jelaskan lagi dari sudut/analogi/contoh yang berbeda dan perbaiki yang keliru, (c) beri 1 soal lanjutan tentang topik yang SAMA. Tetap 1 output = 1 materi + 1 soal.",
    `3. JANGAN membuka materi BARU, JANGAN menandai topik selesai/mastered, dan JANGAN pindah ke fase roadmap berikutnya selama topik paling atas "${active.name}" belum mencapai ${REINFORCE_REQUIRED}/${REINFORCE_REQUIRED} bukti kuat. Topik lain dalam daftar tandai saja sebagai 'pending' dan jangan dilupakan, tapi tidak wajib dituntaskan sekarang.`,
    "4. BUKTI KUAT hanya bertambah kalau pelajar membuktikan paham: menjawab soal dengan benar + alasannya, praktik/menjalankan sesuatu, atau menjelaskan kembali dengan benar. Jawaban pendek, tebakan, 'iya/paham', atau sekadar mengulang kata-katamu TIDAK dihitung sebagai bukti kuat.",
    "",
  ].join("\n");
}

function buildReviewContext(topics: Topic[], now = new Date()): string {
  const due = reviewDueTopics(topics, now);
  if (due.length === 0) return "";

  const lines = due
    .slice(0, 3)
    .map((t) => {
      const days = Math.floor(
        (Date.now() - Date.parse(t.last_reviewed_at.replace(" ", "T") + "Z")) / 86_400_000,
      );
      return `- [mastered] ${t.name} — terakhir diperkuat ${days >= 1 ? `${days} hari lalu` : "kurang dari sehari lalu"}`;
    })
    .join("\n");

  return [
    "=== REVIEW BERKALA (SPACED REVIEW) ===",
    "Topik di bawah sudah dikuasai tapi sudah lama tidak diulang. Kalau tidak ada REINFORCEMENT WAJIB di atas, SEBELUM membuka materi baru, ingatkan dan uji 1 hal dari salah satu topik ini secara singkat (1 soal recall). Jawaban benar menguatkan memori jangka panjang.",
    lines,
    "",
  ].join("\n");
}
  function reviewDueTopics(topics: Topic[], now = new Date()): Topic[] {
  const REVIEW_AFTER_DAYS = 3;
  return topics
    .filter((t) => t.status === "mastered" && t.last_reviewed_at)
    .filter((t) => {
      const last = Date.parse(t.last_reviewed_at.replace(" ", "T") + "Z");
      if (!Number.isFinite(last)) return false;
      const days = (now.getTime() - last) / 86_400_000;
      return days >= REVIEW_AFTER_DAYS;
    })
    .sort((a, b) => (a.last_reviewed_at || "").localeCompare(b.last_reviewed_at || ""));
}

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
  planContext = "",
  modeContext = "",
): string {
  const topicLines =
    topics.length > 0
      ? topics
          .map(
            (t) =>
              `- [${t.status}${t.mastery ? ` ${t.mastery}%` : ""}] ${t.name}${t.notes ? ` — ${t.notes}` : ""}${t.evidence ? ` (bukti: ${t.evidence})` : ""}${t.status !== "mastered" ? ` (penguatan: ${Math.min(t.strong_evidence ?? 0, REINFORCE_REQUIRED)}/${REINFORCE_REQUIRED} bukti kuat)` : ""}`,
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
    buildReinforcementContext(topics),
    buildReviewContext(topics),
    "",
    "=== CATATAN MENTOR (memori jangka panjang, jangan sampai hilang) ===",
    memoryLines,
    planContext
      ? `\n=== RENCANA BELAJAR TERSTRUKTUR (sumber kebenaran urutan & fase) ===\n${planContext}\n`
      : "",
    authoredSection,
    modeContext ? `\n${modeContext}\n` : "",
    workspaceContext ? `\n${workspaceContext}\n` : "",
    "=== ATURAN MENTOR ===",
    "1. Kamu adalah mentor yang SAMA di setiap sesi. Ingat betul progress dan catatan di atas, dan lanjutkan dari titik terakhir pelajar.",
    "2. JANGAN mengulang PENJELASAN materi yang berstatus [mastered] — kalau pelajar minta diuji, kamu boleh langsung lanjut ke latihan/soal tanpa mengulang materinya dari nol. Kalau pelajar sedang [learning] atau [stuck], fokus di situ dan ajarkan langkah demi langkah. Angka mastery di progress menentukan seberapa dalam penjelasanmu: di bawah 45% boleh banyak analogi, di atas 60% wajib ada latihan mandiri supaya benar-benar dipastikan pelajar bisa memakai, bukan cuma hafal.",
    "3. Kalau pelajar menunjukkan pemahaman baru (bisa jawab/berhasil), akui dan catat di pikiranmu — progress, mastery, dan buktinya akan dicatat otomatis oleh sistem. Jangan MENYATAKAN topik sudah dikuasai kalau belum ada bukti nyata (menjawab benar, kode jalan, atau menjelaskannya kembali dengan benar).",
    "4. JELASKAN MATERI SECARA RINCI & LENGKAP. Jangan jawab singkat/superfisial — pelajar justru BINGUNG kalau penjelasannya pendek/tidak detail. Untuk tiap konsep baru, paparkan minimal: (a) apa itu & kenapa penting, (b) bagaimana cara kerjanya langkah demi langkah, (c) contoh konkret yang BISA dijalankan/dicoba, (d) kesalahan umum yang sering terjadi. Sesuaikan kedalaman dengan level pelajar, tapi jangan pernah menyingkat materi yang sedang diajarkan hanya demi ringkas.",
    "5. Beri latihan kecil / pertanyaan cek pemahaman sesekali, mirip tutor bimbel yang ngasih PR.",
    "6. Jawab dengan bahasa santai tapi tetap jelas. Sedikit nuansa anime/waifu yang asyik boleh, selama tidak mengganggu materi.",
    "7. Pakai Markdown (judul, list, code block) supaya rapi. FORMAT JUDUL WAJIB: judul bagian utama (mis. MATERI BARU, KUIS, langkah besar) selalu pakai heading level 1 atau 2 (`# Judul` / `## Judul`), jangan pernah memakai `###` atau `####` untuk judul utama — `###` hanya untuk sub-bagian di bawah judul level 2. Judul harus tetap kelihatan berwarna di tampilan pelajar. Untuk kode, selalu tunjukkan contoh yang bisa langsung dijalankan.",
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
    "12. ROADMAP RENCANA belajar di workspace (mis. ROADMAP.md) adalah PETA UTAMA belajarmu. Ikuti urutan & fase yang tertulis di sana: jangan melompat ke fase berikutnya sebelum materi fase sekarang dikuasai, dan jangan mengulang dari nol materi yang sudah ditandai selesai. Kalau ada bagian roadmap yang perlu kamu cek lagi, bacalah dulu berkasnya.",
    "13. Menyimpang sedikit dari roadmap BOLEH, selama masih erat hubungannya dengan materi yang sedang dipelajari dan benar-benar memperkuat dasar. Begitu terasa terlalu jauh dari jalur, tarik kembali percakapan ke materi inti di roadmap.",
    "14. JANGAN menaikkan standar melebihi level pelajar: sampaikan materi sesuai tingkatan yang tercatat, tahan godaan mengajak ke materi lanjutan/istilah rumit lebih dulu, dan naik ke tingkat berikutnya SECARA BERTAHAP hanya setelah pelajar tuntas di tingkat sekarang. Kalau pelajar tampak kesulitan, turunkan kedalaman sedikit dan perkuat dasar dulu.",
    planContext
      ? "15. RENCANA BELAJAR TERSTRUKTUR di atas adalah sumber kebenaran utama urutan belajar (lebih diandalkan daripada ROADMAP.md). Kerjakan item paling awal yang statusnya belum done. Kalau sebuah item benar-benar selesai, atau pelajar terjebak dan butuh bantuan, tulis di baris PALING AKHIR jawabanmu marker @@plan(<id>,\"done\") atau @@plan(<id>,\"stuck\") dengan id persis seperti tertulis di rencana. Marker itu disembunyikan dari tampilan dan dipakai sistem untuk menandai progres, jadi jangan dijelaskan di teks. Jangan mengarang id yang tidak ada di daftar rencana."
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
    ? topics
        .map(
          (t) =>
            `{ name: "${t.name}", status: "${t.status}", mastery: ${t.mastery}, strong_evidence: ${t.strong_evidence ?? 0}, evidence: "${t.evidence}" }`,
        )
        .join(", ")
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
    "2. Nilai juga tingkat penguasaan (mastery) 0-100 secara JUJUR:",
    "   - 0-20: baru menyentuh topik",
    "   - 21-45: paham sebagian, masih banyak goshala",
    "   - 46-59: paham konsep inti tapi belum bisa dipakai sendiri",
    "   - 60-84: bisa menjelaskan & memakai dengan bantuan ringan",
    "   - 85-100: bisa memakai tanpa bantuan & bisa menjelaskannya ke orang lain",
    "   Jangan asal naik. Kalau pelajar cuma nodding atau belum menjawab apa-apa, jangan naikkan mastery.",
    "3. Tulis 'bukti' singkat dan KONKRET yang terlihat di percakapan ini (mis. \"menjawab benar soal dereference tanpa bantuan\"). Kalau tidak ada bukti nyata, tulis 'bukti: -' dan JANGAN tandai mastered.",
    `4. Klasifikasikan kualitas bukti dengan 'bobot=kuat' atau 'bobot=lemah':`,
    `   - "kuat": pelajar BERHASIL menunjukkan pemahaman sendiri — jawaban benar atas soal + alasannya, praktik/perintah yang dijalankan dan berhasil, atau menjelaskan konsep kembali dengan benar.`,
    `   - "lemah": pelajar cuma jawab pendek/tebakan ('502?'), mengiyakan ('iya', 'paham', 'oke'), mengulang kata mentor, atau sekadar membaca.`,
    `   WAJIB jujur: kalau pelajar belum membuktikan apa-apa, tulis bobot=lemah. Mastery HANYA boleh naik kalau ada bukti bobot=kuat.`,
    `5. Sistem memberlakukan aturan PENGUATAN BERKALA: satu topik baru dianggap selesai hanya setelah minimal ${REINFORCE_REQUIRED} bukti KUALITAS KUAT yang berbeda terkumpul. Sampai itu, tahan status topik di 'learning' dan ajukan lagi untuk diperkuat — JANGAN menandai mastered hanya dari satu jawaban singkat.`,
    "6. Tulis 'yakin' 0-100 = seberapa yakin kamu pada bukti itu (bukti dari kuis/uji = tinggi, QTLintas saja = rendah).",
    "7. Ekstrak maksimal 3 memori baru: fakta pribadi pelajar, preferensi belajar, atau insight kemajuan (tipe: fact / preference / progress / insight).",
    "",
    "JAWAB HANYA dengan format berikut, TANPA teks lain:",
    "TOPICS:",
    "- [status] Nama Topik: catatan singkat satu kalimat || mastery=70 || bukti=menjawab soal tanpa bantuan || bobot=kuat || yakin=70",
    "  (Gunakan titik dua diikuti spasi ': ' sebagai pemisah nama dan catatan. Boleh sertakan identifer teknis seperti std::cout dalam nama, selama diikuti ': ' untuk catatan. Bagian '|| mastery= || bukti= || bobot= || yakin=' wajib diisi, dengan angka 0-100 dan teks singkat tanpa tanda '|'.)",
    "MEMORY:",
    "- [tipe] isi memori satu kalimat",
    "",
    "Kalau tidak ada perubahan sama sekali, tulis: TIDAK ADA PERUBAHAN",
  ].join("\n");
}

const STATUSES = new Set(["mastered", "learning", "stuck", "todo"]);
const MEMORY_TYPES = new Set(["fact", "preference", "progress", "insight"]);

export interface ParsedTopicUpdate {
  name: string;
  status: string;
  notes: string;
  mastery?: number;
  confidence?: number;
  evidence?: string;
  /** Kualitas bukti: true = kuat, false = lemah, undefined = tidak disebutkan. */
  strong?: boolean;
}

const EVIDENCE_META_RE = /\s*\|\|\s*(.*)$/;

function parseEvidenceMeta(
  rest: string,
): { note: string; mastery?: number; confidence?: number; evidence?: string; strong?: boolean } {
  const match = rest.match(EVIDENCE_META_RE);
  if (!match) return { note: rest.trim() };
  const note = rest.slice(0, match.index).trim();
  const fields: Record<string, string> = {};
  for (const chunk of match[1].split("||")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    fields[chunk.slice(0, eq).trim().toLowerCase()] = chunk.slice(eq + 1).trim();
  }
  const num = (key: string): number | undefined => {
    const raw = fields[key];
    if (raw === undefined) return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
  };
  const evidenceRaw = fields["bukti"] ?? fields["evidence"];
  const evidence = evidenceRaw && evidenceRaw !== "-" ? evidenceRaw : undefined;
  let strong: boolean | undefined;
  const bobot = (fields["bobot"] ?? "").toLowerCase();
  if (bobot === "kuat" || bobot === "strong") strong = true;
  else if (bobot === "lemah" || bobot === "weak") strong = false;
  return {
    note,
    mastery: num("mastery"),
    confidence: num("yakin") ?? num("confidence"),
    evidence,
    strong,
  };
}

export function parseMemoryUpdate(text: string): {
  topics: ParsedTopicUpdate[];
  memories: { type: string; content: string }[];
} {
  const topics: ParsedTopicUpdate[] = [];
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
      const meta = parseEvidenceMeta(sep === -1 ? "" : rest.slice(sep + 2));
      const notes = meta.note;
      if (name && STATUSES.has(tag)) {
        topics.push({
          name,
          status: tag,
          notes: notes || `Diproses saat percakapan terakhir`,
          mastery: meta.mastery,
          confidence: meta.confidence,
          evidence: meta.evidence,
          strong: meta.strong,
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