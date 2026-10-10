import { describe, expect, it } from "vitest";
import {
  formatNotice,
  sanitizeStale,
  sanitizeText,
  validateOutput,
} from "./guardrail";

describe("validateOutput", () => {
  it("menerima teks normal", () => {
    const r = validateOutput("Jawabanmu benar. Kode:\n```sh\necho halo\n```\nSelesai.");
    expect(r.ok).toBe(true);
    expect(r.flags).toEqual([]);
  });

  it("mendeteksi blok kode menggantung (fence ganjil)", () => {
    const r = validateOutput("Ini di tengah skrip:\n```bash\nif [ -z \"$X\" ]; then\n    echo");
    expect(r.ok).toBe(false);
    expect(r.flags).toContain("unbalanced_fence");
  });

  it("mendeteksi dua versi jawaban tertempel (blok duplikat)", () => {
    const block = [
      "# Evaluasi Jawaban & Analisis Logika",
      "Jawabanmu 100% TEPAT pada kedua pertanyaan yang diajukan.",
      "Karena user eve terdaftar di sistem, perintah id sukses, exit 0",
      "Variabel menangkap 0, lalu skrip mengeksekusi exit 0 di akhir.",
      "Alur: perintah -> ditangkap \$? -> dievaluasi oleh if -> keluar",
      "Ke terminal, sehingga echo \$? menampilkan angka nol persis.",
      "Kesimpulan: logika mengalir benar dan tanpa kesalahan berarti.",
    ].join("\n");
    const glued = `${block}\n\nPotongan skrip cek_folder.sh:\n\`\`\`bash\necho "ERROR:\n\`\`\`\n\n${block}\n\n# Kuis Lanjutan backup_file.sh`;
    const r = validateOutput(glued);
    expect(r.ok).toBe(false);
    expect(r.flags).toContain("duplicated_block");
  });

  it("tidak menandai kalimat wajar yang pendek", () => {
    const r = validateOutput("Oke. Oke. Oke. Paham. Paham. Lanjut.");
    expect(r.ok).toBe(true);
  });

  it("mendeteksi marker perintah bocor", () => {
    const r = validateOutput('Ada teks lalu @@write("notes.md") tanpa penutup.');
    expect(r.ok).toBe(false);
    expect(r.flags).toContain("marker_leak");
  });

  it("teks kosong dianggap aman", () => {
    expect(validateOutput("   ").ok).toBe(true);
  });
});

describe("sanitizeText", () => {
  it("menutup blok kode menggantung", () => {
    const out = sanitizeText("```sh\necho halo");
    expect(validateOutput(out).flags).not.toContain("unbalanced_fence");
    expect(out).toMatch(/```$/);
  });

  it("membuang marker bocor tanpa mengubah isi", () => {
    const out = sanitizeText('Jawaban @@plan(99,"done") tetap ada @@mode("konsep").');
    expect(out).toContain("Jawaban");
    expect(out).not.toContain("@@");
  });
});

describe("formatNotice", () => {
  it("menghasilkan nota hanya saat ada flag", () => {
    expect(formatNotice([])).toBe("");
    expect(formatNotice(["unbalanced_fence"])).toContain("dirapikan otomatis");
  });
});

describe("sanitizeStale", () => {
  const mk = (id: number, role: "user" | "assistant", content: string) =>
    ({ id, role, content }) as const;

  it("dedup pesan beruntun identik, pertahankan kejadian terbaru", () => {
    const out = sanitizeStale([
      mk(1, "user", "halo"),
      mk(2, "user", "halo"),
      mk(3, "assistant", "hai"),
      mk(4, "user", "lanjut"),
    ]);
    expect(out.map((m) => m.id)).toEqual([2, 3, 4]);
  });

  it("mengeluarkan pesan assistant korup berat dari history", () => {
    const out = sanitizeStale([
      mk(1, "user", "soal?"),
      mk(2, "assistant", "```bash\necho potong"),
      mk(3, "user", "bisa ulang?"),
    ]);
    expect(out.map((m) => m.id)).toEqual([1, 3]);
  });

  it("tidak pernah mengembalikan history kosong", () => {
    const out = sanitizeStale([
      mk(1, "assistant", "```tengah skrip"),
      mk(2, "assistant", "@@write(\"x\")"),
    ]);
    expect(out.length).toBeGreaterThan(0);
  });
});