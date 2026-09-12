export const MOODS = ["netral", "senang", "semangat", "bingung", "sedih", "tenang"] as const;
export type Mood = (typeof MOODS)[number];

const MOOD_MARKER = /@@mood\("([^"]+)"\)/g;

export function isMood(value: string): value is Mood {
  return (MOODS as readonly string[]).includes(value);
}

const NEGATED_KIND =
  /\b(jangan|janganlah|tak perlu|tidak perlu|tidak usah|tak usah|ga usah|gausah|gak usah|nggak usah|jangan sampai)\s+(bingung|khawatir|pusing|panik|gugup|capek|lelah|sedih|menyerah)\b/i;

const KEYWORDS: Record<Exclude<Mood, "netral">, RegExp> = {
  bingung:
    /\b(?:aku|saya|gw|gue|kita)\s+(bingung|bingu|kurang paham|belum paham|kurang ngerti|belum ngerti|tidak yakin aku)\b|\b(hmm|bingung\.\.\.|pusing aku)\b|\?\s*\?/i,
  sedih: /\b(sedih\.\.\.|menyesal|kecewa berat|sayang sekali|aku gagal|gagal lagi|merasa gagal|payah aku|semangatku turun)\b/i,
  senang: /\b(senang|hebat|keren|mantap|selamat|gratulasi|bagus sekali|luar biasa|hebat banget|tepat sekali|jawaban benar|pasti bisa)\b|\b(yay|hooray|horay)\b/i,
  semangat: /\b(semangat|ayo kita|ayo|yuk|kita mulai|langsung gas|gas|lanjut|waktunya|step pertama|percobaan pertama|mari kita mulai)\b/i,
  tenang: /\b(tenang|santai|pelan-pelan|satu langkah|tak apa|tak masalah|gapapa|gak papa|tidak perlu buru|slow|jangan terburu)\b/i,
};

export function detectMood(text: string): Mood {
  const negated = NEGATED_KIND.test(text);
  for (const mood of ["senang", "sedih", "bingung", "semangat", "tenang"] as const) {
    if (negated && (mood === "bingung" || mood === "sedih")) continue;
    if (mood === "bingung" && /\?\s*$/.test(text.trim()) && text.trim().length > 120) {
      continue;
    }
    if (KEYWORDS[mood].test(text)) return mood;
  }
  return "netral";
}

export function extractMoodMarker(text: string): { mood: Mood | null; clean: string } {
  let mood: Mood | null = null;
  let m: RegExpExecArray | null;
  while ((m = MOOD_MARKER.exec(text))) {
    if (isMood(m[1]) && !mood) mood = m[1];
  }
  return { mood, clean: text.replace(/@@mood\("[^"]*"\)/g, "") };
}

export function finalMood(text: string): { mood: Mood; clean: string } {
  const { mood, clean } = extractMoodMarker(text);
  return { mood: mood ?? detectMood(clean), clean };
}