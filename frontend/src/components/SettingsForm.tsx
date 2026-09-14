import { useEffect, useState } from "react";
import { get, send } from "@/api";
import type { Profile } from "@/types";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm outline-none transition focus:border-sakura/50 text-night placeholder:text-mist/60 [color-scheme:dark]";

const LEARNING_STYLE_INFO: Record<
  string,
  { label: string; desc: string }
> = {
  praktek: {
    label: "Praktek langsung",
    desc: "Lode kasih inti materi singkat dulu (±3–5 kalimat + contoh kecil), baru langsung satu soal/latihan untuk dicoba. Bukan tanpa materi sama sekali.",
  },
  teori: {
    label: "Teori dulu",
    desc: "Konsep dijelaskan tuntas dulu lengkap dengan contoh; soal latihan menyusul SETELAH materi selesai. Jadi bukan 'teori tanpa soal', tapi soal datang setelah teori.",
  },
  visual: {
    label: "Visual / analogi",
    desc: "Materi dijelaskan pakai analogi, perumpamaan, dan 'bayangkan…' supaya gampang dibayangkan.",
  },
  cerita: {
    label: "Cerita & storytelling",
    desc: "Materi dibungkus dalam narasi cerita / contoh sehari-hari supaya mudah diingat.",
  },
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-night/80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-mist">{hint}</span>}
    </label>
  );
}

export default function SettingsForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    freedMessages: number;
    freedTopics: number;
    sizeAfter: number;
  } | null>(null);

  const kb = (n: number) =>
    n >= 1_048_576
      ? `${(n / 1_048_576).toFixed(2)} MB`
      : `${Math.max(0, Math.round(n / 1024))} KB`;

  const cleanup = async () => {
    setCleaning(true);
    try {
      const r = await send<{
        freedMessages: number;
        freedTopics: number;
        sizeAfter: number;
      }>("/api/maintenance/cleanup", "POST", {});
      setCleanupResult(r);
    } catch (err) {
      setMsg({ ok: false, text: "Gagal menjalankan pembersihan." });
    } finally {
      setCleaning(false);
    }
  };

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    get<Profile>("/api/profile")
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  function patch<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  async function save() {
    if (!profile) return;
    setSaving(true);
    setMsg(null);
    try {
      const updated = await send<Profile>("/api/profile", "PUT", {
        name: profile.name,
        language: profile.language,
        skill_level: profile.skill_level,
        goals: profile.goals,
        learning_style: profile.learning_style,
        mascot: profile.mascot,
        workspace: profile.workspace.trim(),
        ws_max_depth: Number(profile.ws_max_depth) || 3,
        ws_max_files: Number(profile.ws_max_files) || 150,
        ws_auto_kb: Number(profile.ws_auto_kb) || 0,
        ws_allow_write: profile.ws_allow_write ? 1 : 0,
        ai_base_url: profile.ai_base_url.trim(),
        ai_api_key: profile.ai_api_key,
        ai_model: profile.ai_model,
      });
      setProfile(updated);
      setMsg({ ok: true, text: "Profil tersimpan. Lode akan langsung ingat update ini." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Gagal menyimpan" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTest(null);
    try {
      const r = await get<{
        ok: boolean;
        upstream_url: string;
        upstream_status: number | null;
        error?: string;
        body?: { status?: string; client_ready?: boolean } | null;
      }>("/api/health");
      if (r.ok) {
        setTest({
          ok: true,
          text: `Server AI hidup (status ${r.upstream_status}). ${
            r.body?.client_ready === false ? "Tapi client Gemini belum siap — cek cookie di gemini-server." : ""
          }`,
        });
      } else {
        setTest({
          ok: false,
          text: `Server AI tidak bisa dijangkau di ${r.upstream_url}. ${r.error ?? ""}`,
        });
      }
    } catch (err) {
      setTest({
        ok: false,
        text: err instanceof Error ? err.message : "Tes gagal",
      });
    } finally {
      setTesting(false);
    }
  }

  if (!profile) {
    return <p className="text-mist">Memuat profil…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold">Profil pelajar</h2>
        <p className="mt-1 text-sm text-mist">
          Ini "memori jangka panjang" Lode — dia akan selalu ingat ini di setiap percakapan.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama panggilan">
          <input
            className={inputCls}
            value={profile.name}
            onChange={(e) => patch("name", e.target.value)}
          />
        </Field>
        <Field label="Nama mentor (Lode)">
          <input
            className={inputCls}
            value={profile.mascot}
            onChange={(e) => patch("mascot", e.target.value)}
          />
        </Field>
        <Field label="Bahasa pengantar">
          <select
            className={inputCls}
            value={profile.language}
            onChange={(e) => patch("language", e.target.value)}
          >
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label="Tingkat kamu">
          <select
            className={inputCls}
            value={profile.skill_level}
            onChange={(e) => patch("skill_level", e.target.value)}
          >
            <option value="pemula">Pemula</option>
            <option value="menengah">Menengah</option>
            <option value="lanjut">Lanjut</option>
          </select>
        </Field>
        <Field
          label="Gaya belajar favorit"
          hint={
            LEARNING_STYLE_INFO[profile.learning_style]?.desc ??
            "Pilih gaya yang paling cocok untukmu."
          }
        >
          <select
            className={inputCls}
            value={profile.learning_style}
            onChange={(e) => patch("learning_style", e.target.value)}
          >
            <option value="praktek">Praktek langsung</option>
            <option value="teori">Teori dulu</option>
            <option value="visual">Visual / analogi</option>
            <option value="cerita">Cerita & storytelling</option>
          </select>
        </Field>
        <Field label="Tujuan belajar" hint="Contoh: jadi web developer, paham React, dll.">
          <input
            className={inputCls}
            value={profile.goals}
            onChange={(e) => patch("goals", e.target.value)}
          />
        </Field>
      </div>

      <div className="border-t border-white/10 pt-6">
        <h2 className="text-xl font-extrabold">Folder workspace (default)</h2>
        <p className="mt-1 text-sm text-mist">
          Folder tempat kamu menulis jawaban/PR di code editor (mis. Zed). Lode bisa
          membacanya untuk mengoreksi. Bisa diubah per-percakapan lewat tombol
          "Folder" di halaman chat.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className={inputCls}
            value={profile.workspace}
            onChange={(e) => patch("workspace", e.target.value)}
            placeholder="/home/kamu/projek/latihan"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const r = await fetch(
                  `/api/workspace/pick?folder=${encodeURIComponent(profile.workspace.trim())}`,
                );
                const j = (await r.json()) as { ok: boolean; selected?: string | null; error?: string };
                if (j.ok && j.selected) patch("workspace", j.selected);
                else if (!j.ok && j.error) alert(j.error);
              } catch {
                alert("Gagal membuka dialog folder");
              }
            }}
            className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold transition hover:border-sakura/40 hover:text-night"
          >
            Pilih folder…
          </button>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Kedalaman folder (level)"
            hint="Untuk proyek game Unity, naikkan jadi 5–6 supaya struktur Assets/Scenes ikut kebaca. Lebih dalam = agak lebih lambat."
          >
            <select
              className={inputCls}
              value={Number(profile.ws_max_depth) || 3}
              onChange={(e) => patch("ws_max_depth", Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>{n} level</option>
              ))}
            </select>
          </Field>
          <Field
            label="Jumlah file di struktur (maks)"
            hint="Batas entri pohon file. Proyek besar (Unity) mungkin butuh 300–500."
          >
            <select
              className={inputCls}
              value={Number(profile.ws_max_files) || 150}
              onChange={(e) => patch("ws_max_files", Number(e.target.value))}
            >
              {[50, 100, 150, 250, 400, 600, 1000].map((n) => (
                <option key={n} value={n}>{n} file</option>
              ))}
            </select>
          </Field>
          <Field
            label="Otomatis baca seluruh teks (KB)"
            hint="Kalau total isi file kecil (mis. PR latihan), Lode langsung paham tanpa menunggu @@read. 0 = mati. Naikkan pelan, ini yang paling boros token."
          >
            <input
              type="number"
              min={0}
              max={5000}
              step={16}
              className={inputCls}
              value={Number(profile.ws_auto_kb) || 0}
              onChange={(e) => patch("ws_auto_kb", Number(e.target.value))}
            />
          </Field>
          <Field label="Lode boleh membuat file/folder" hint="Mis. diminta buat ROADMAP.md atau skrip C#. Tetap dibatasi: file teks <100KB & hanya di dalam folder workspace.">
            <button
              type="button"
              onClick={() => patch("ws_allow_write", profile.ws_allow_write ? 0 : 1)}
              className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-bold transition ${
                profile.ws_allow_write
                  ? "border-kirimochi/40 bg-kirimochi/15 text-night"
                  : "border-white/10 bg-white/5 text-mist"
              }`}
            >
              {profile.ws_allow_write ? "Aktif — boleh menulis ✍️" : "Nonaktif — hanya baca"}
            </button>
          </Field>
        </div>
      </div>

      <div className="border-t border-white/10 pt-6">
        <h2 className="text-xl font-extrabold">Server AI</h2>
        <p className="mt-1 text-sm text-mist">
          Endpoint OpenAI-compatible. Default-nya gemini-server kamu di port 8000.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="AI server URL">
            <input
              className={inputCls}
              value={profile.ai_base_url}
              onChange={(e) => patch("ai_base_url", e.target.value)}
              placeholder="http://localhost:8000/v1"
            />
          </Field>
          <Field label="API key (opsional)">
            <input
              type="password"
              className={inputCls}
              value={profile.ai_api_key}
              onChange={(e) => patch("ai_api_key", e.target.value)}
              placeholder="Kosongkan kalau server lokal"
            />
          </Field>
          <Field label="Model (opsional)">
            <input
              className={inputCls}
              value={profile.ai_model}
              onChange={(e) => patch("ai_model", e.target.value)}
              placeholder="Kosong = pakai default server"
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-gradient-to-r from-sakura to-mew px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-sakura/20 transition enabled:hover:brightness-110 disabled:opacity-40"
        >
          {saving ? "Menyimpan…" : "Simpan profil"}
        </button>
        <button
          onClick={testConnection}
          disabled={testing}
          className="rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-bold text-night/80 transition hover:text-night disabled:opacity-40"
        >
          {testing ? "Mengetes…" : "Tes koneksi AI"}
        </button>
      </div>

      {msg && (
        <p className={`text-sm ${msg.ok ? "text-kirimochi" : "text-rose-300"}`}>{msg.text}</p>
      )}
      {test && (
        <p className={`text-sm ${test.ok ? "text-kirimochi" : "text-rose-300"}`}>{test.text}</p>
      )}

      <div className="border-t border-white/10 pt-6">
        <h2 className="text-xl font-extrabold">Pemeliharaan data</h2>
        <p className="mt-1 text-sm text-mist">
          Menghapus percakapan kini sekaligus menghapus pesan & topiknya. Tombol di bawah
          membersihkan sisa data yatim (bekas hapus) dan mengecilkan file WAL/sidecar.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={cleanup}
            disabled={cleaning}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-bold text-night/80 transition enabled:hover:border-sakura/40 enabled:hover:text-night disabled:opacity-40"
          >
            {cleaning ? "Membersihkan…" : "Bersihkan data lama"}
          </button>
          {cleanupResult && (
            <span className="text-xs text-mist">
              {cleanupResult.freedMessages > 0 || cleanupResult.freedTopics > 0
                ? `Selesai: ${cleanupResult.freedMessages} pesan & ${cleanupResult.freedTopics} topik yatim dihapus, ${kb(cleanupResult.sizeAfter)} tersimpan.`
                : `Bersih: tidak ada data yatim (${kb(cleanupResult.sizeAfter)} tersimpan).`}
            </span>
          )}
        </div>
      </div>

      <p className="text-[11px] text-mist">
        API key & data profil hanya disimpan di database lokal (backend/data/mentor.db), tidak dikirim ke mana pun selain server AI yang kamu tentukan.
      </p>
    </div>
  );
}