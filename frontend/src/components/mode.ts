import type { LearnMode } from "@/types";

export const MODE_META: Record<LearnMode, { label: string; hint: string }> = {
  auto: { label: "Auto", hint: "Lode sendiri yang memilih mode tiap giliran" },
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
  uji: { label: "Uji", hint: "Soal penilaian tanpa banyak bantuan" },
};
