# Rencana Pengerasan Sistem (Hardening Plan)

> Tujuan: mencegah kelas masalah "output AI kacau / meracuni data" — pesan ganda-ke-tempel, skrip terpotong, history beracun, kirim ganda — serta membangun fondasi kualitas (test, lint, observability) agar proyek tidak lagi bergantung pada keberuntungan ("vibecoding").

Dibuat: 2026-10-09. Diperbarui: 2026-10-12.

**Status saat ini:**
- **Fase 1 — SELESAI & TERVERSI.** Guardrail + idempotensi sudah dikerjakan dan di-commit (`048cd9a`, `03aa8fa`, `31f1165`), dengan unit test (`backend/lib/guardrail.test.ts`, `backend/lib/idempotency.test.ts` — 14 test, `npm --prefix backend test`). Guardrail jalan **report-only**: yang aktif baru validasi + perapian ringan (tutup fence, buang marker bocor, nota sistem); **auto-repair retry dua kali belum diaktifkan** — masih sesuai "keluar dari keputusan #2".
- **Fase 2 & 3 — BELUM dikerjakan** (lock outside `wait_for` pada gateway, `X-Turn-Id`, log file, `/metrics`, test gateway, lint, CI).

Untuk detail apa saja yang benar-benar terpasang vs direncanakan, lihat bagian 4.7 "Catatan implementasi".

---

## 1. Masalah yang mendasari (dari pengalaman nyata)

1. **Pesan AI rusak tersimpan permanen di DB** — Gemini menulis ulang jawaban di tengah streaming, deteksi restart lama gagal, dua versi tertempel jadi satu pesan (duplikasi + skrip terpotong). Pesan rusak ini lalu dikirim sebagai history ke Gemini berikutnya dan *meracuni* giliran-giliran selanjutnya.
2. **AI mengulang materi / memaksa pola** — reinforcement turn menulis ulang materi lengkap dari nol; AI mengevaluasi jawaban padahal pelajar hanya bertanya/minta ulang.
3. **Tidak ada idempotensi** — kirim ganda dari klien bisa membuat baris user/assistant duplikat di DB.
4. **Tidak ada pengujian** — repo 0 test, 0 lint, hanya `tsc --noEmit`. Regresi (mis. rusaknya deteksi restart) mudah lolos.
5. **Observability rendah** — server AI dulu berjalan tanpa file log; tidak ada request-id; debugging butuh tebak-tebakan.

Yang sudah diperbaiki & di-commit sebelumnya (sejarah):
- `fix(mentor): stop repeating full material in reinforcement turns` (`fa2da7a`)
- `fix(mentor): answer non-test questions without forcing reinforcement evaluation` (`1d06169`)
- Perbaikan deteksi restart berbasis prefix di `gemini-server/server.py` (belum ter-commit, folder di-ignore git)
- Pembersihan manual pesan rusak 1489/1491 di konversasi 85 (backup: `backend/data/mentor.db.bak-cleanup`)

---

## 2. Diagnosis dari kode (di mana celah berada)

| No | Celah | Bukti di kode |
|----|-------|---------------|
| 1 | Output AI disimpan mentah tanpa validasi (fence/truncation/duplikasi/marker bocor) | `backend/server/index.ts:1098` — `addMessage(cid,"assistant",finalText,...)`; tidak ada cek. `messages` tak punya unique constraint (skema `backend/data/mentor.db`) |
| 2 | History dikirim apa adanya termasuk pesan korup | `backend/server/index.ts:582-583` — `listMessages(cid).slice(-50)` tanpa pembersihan |
| 3 | Tidak ada idempotensi kirim user | `ChatRoom.tsx:502-664`; guard `sending` dari closure state bisa lolos 2x dalam 1 tick; tak ada `clientMsgId` |
| 4 | Dead code membingungkan | `ai_thread` ditulis (`index.ts:1121`) lalu dikosongkan (`:568`) tapi tak pernah direplay; `parseAiThread` (`backend/lib/ai.ts:15`) tidak dipanggil |
| 5 | Lock gateway mengurangi budget request yang antre | `gemini-server/server.py:643` `_complete_once` menunggu `Semaphore(1)` *di dalam* `wait_for` |
| 6 | Tanpa request-id & tanpa log file | `start.sh` menjalankan `server.py` ke stdout; tidak ada `X-Request-Id` |
| 7 | Tanpa test/lint | tidak ada `*.test.ts`, `pytest`, eslint, ruff; hanya `typecheck` |
| 8 | Tampilan klien bisa melenceng dari DB | `ChatRoom.tsx:626-637` merakit teks lokal dari stream; DB adalah sumber kebenaran saat reload |

---

## 3. Keputusan yang sudah dikunci

1. **Output korup setelah 1x auto-repair retry gagal** → simpan versi hasil dibersihkan + sisipkan nota `> ⚠️ [bagian respons terpotong/duplikat dirapikan otomatis]`. History tetap mengalir.
2. **Agresivitas deteksi** → *report-only dulu* (log + counter), auto-repair dibuat tapi **belum diaktifkan** sampai false-positive terbukti rendah.
3. **Urutan eksekusi** → bertahap, review tiap fase sebelum lanjut.
4. **CI/lint/test** → dikerjakan di Fase 3; keputusan final (lokal saja vs GitHub Actions) diambil saat tiba di fase itu.

---

## 4. Fase 1 — Guardrail validasi output AI + idempotensi

**Prioritas tertinggi: menghentikan "pesan rusak" dan duplikat sejak titik lahir.**

### 4.1 `backend/lib/guardrail.ts` (file baru)
Fungsi murni, mudah diuji:

- `countCodeFences(text): number` — hitung jumlah ````` ``` ````; ganjil ⇒ fence bocor/terpotong.
- `hasOpenFence(text): boolean` — fence dibuka tapi tidak ditutup sampai akhir teks ⇒ truncation.
- `detectTruncation(text)` — heuristic: fence terbuka di EOF; baris terakhir terputus di tengah token sintaks (`echo "ERR`, `$0 <nama`, dll); akhir teks tanpa penanda struktur yang diprediksi soal.
- `detectDuplicatedBlocks(text)` — rolling-hash blok baris ternormalisasi; blok duplikat ≥ ~300 char dalam 1 pesan terdeteksi. (Konservatif: label/kalimat pendek yang berulang wajar **tidak** dihitung.)
- `detectMarkerLeak(text)` — `@@write(` tanpa `@@end`, `@@plan`/`@@mode`/`@@mood` invalid yang lolos strip.
- `sanitizeText(text): {text, flags, risk}` — perbaikan ringan yang aman: strip marker bocor tanpa mengubah pesan, tutup fence yang jelas, buang duplikat blok; isi `flags` + `risk` untuk report.
- `validateOutput(text): GuardResult {ok, flags: string[], risk: "low"|"high"}`.

### 4.2 Wire ke alur chat (`backend/server/index.ts`)
- Sebelum persist (`:1098`): `finalText = guardrail.validateOutput(...)`.
  - `ok` → simpan seperti biasa.
  - tidak `ok` + `risk high` → **report** (counter + log), lalu:
    1. jalankan 1x **auto-repair retry** (prompt + catatan "perbaiki respons yang terpotong/duplikat tanpa mengubah maksud"),
    2. masih gagal → simpan `sanitizeText()` + nota `> ⚠️ [...dirapikan otomatis]`,
    3. selama fase report-only: simpan versi dibersihkan tanpa menunggu aktifnya retry (keputusan kunci #1 tetap berlaku).
- Persist disertai kolom baru `messages.guard_flags` (opsional, JSON) supaya laporan bisa dipantau.

### 4.3 History bersih sebelum dikirim ke AI (`index.ts:583`)
- `sanitizeStale(messages)`:
  - dedup pesan **beruntun identik** (user & assistant) — menghentikan racun kirim ganda lama.
  - pesan lama yang gagal validasi berat dikeluarkan dari prompt (atau dipotong ke titik "bersih" terakhir).
- Ditetapkan berlaku ke **history yang dikirim**, tanpa wajib mengubah isi DB (kecuali saat penyimpanan berikutnya).

### 4.4 Idempotensi kirim user
- DB: tambah kolom `messages.client_msg_id TEXT` + `CREATE UNIQUE INDEX ... ON messages(conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL`.
- Backend `addMessage` user di `index.ts:577`: terima `clientMsgId`; jika duplikat → jangan insert lagi.
- Frontend `ChatRoom.tsx:502`:
  - `clientMsgId = crypto.randomUUID()` per kiriman, ikut body.
  - guard `send()` pindah ke `useRef` (bukan closure `sending`) agar 2 panggilan dalam 1 tick tak lolos.

### 4.5 Rapikan dead code
- Hapus `ai_thread` / `parseAiThread` (`ai.ts:15`) atau libatkan benar; gateway stateless ⇒ **hapus** + bersihkan kolom `ai_thread` dari insert (`db.ts:393`).

### 4.6 Test Fase 1 (unit, belum Fase 3 penuh)
- Vitest untuk `guardrail.ts` (fence/truncation/duplikasi/leak/sanitize) — termasuk kasus pesan 1489 asli sebagai fixture.
- Vitest untuk `sanitizeStale`, parser `clientMsgId` duplikat.
- *Belum* infra CI — cukup `npm test` lokal di backend.

**Definisi selesai Fase 1:** guardrail + report aktif di produksi; `clientMsgId` aktif; tidak ada lagi pesan ganda/terpotong baru di DB; history tetap bersih saat pengujian dunia nyata 1 minggu.

### 4.7 Catatan implementasi (2026-10-12)

Yang benar-benar terpasang dibanding rencana di atas:

| Rencana | Status |
|--------|--------|
| 4.1 `guardrail.ts` (fence, duplikasi, marker leak, `sanitizeText`, `validateOutput`) | ✅ Diimplementasikan persis |
| 4.2 Wire sebelum persist (`index.ts`) + nota `> ⚠️ ... dirapikan otomatis` | ✅ Aktif (report-only: validasi → sanitasi ringan → nota). `messages.guard_flags` **tidak** dipakai; flag hanya untuk keputusan alur, tidak disimpan. |
| 4.2 Auto-repair retry saat output korup | ⏸️ Belum — sesuai keputusan #2, retry baru untuk kasus penolakan (refusal), bukan korupsi. |
| 4.3 `sanitizeStale(messages)` sebelum dikirim ke AI | ✅ Dedup beruntun identik + kecualikan pesan assistant lama `risk: high`, tanpa mengubah DB. |
| 4.4 Idempotensi `client_msg_id` (kolom + unique index + guard di `addMessage` + `crypto.randomUUID()` di `ChatRoom`) | ✅ Lengkap |
| 4.5 Hapus dead code `ai_thread`/`parseAiThread` | ⚠️ Parsial — `AiThread` masih dipertukarkan antar-round (dipakai untuk lanjutan dalam satu giliran), tapi tidak lagi disimpan ke DB; kolom `ai_thread` masih ada di skema untuk kompatibilitas. |
| 4.6 Test Fase 1 (vitest) | ✅ Kerja: 2 file test, 14 assert. |

Di luar rencana, beberapa perbaikan bertetangga ikut dikerjakan dalam Fase 1: **Buatkan Catatan** (`/api/notes/make`), round tambahan "create file" bila model lupa mengeluarkan blok `@@write`, dan round "Ulangi"/regenerate (`/api/chat` + `regenerateMessageId` — jawaban baru mengganti yang lama di tempat, tidak ada pesan ganda). Tombol sambung manual **Lanjutkan** (`/api/chat/continue`) sempat dibuat lalu **dihapus** karena bisa dipakai tanpa batas; jawaban terpotong kini ditangani auto-continue gateway + Ulangi.

---

## 5. Fase 2 — Gateway AI + observability

- `gemini-server/server.py`:
  - Lock `Semaphore` dipindah **di luar** `wait_for` pada `_complete_once` (`:638-645`) agar request yang antri tidak kehabisan budget.
  - Dukung `X-Turn-Id`: semua baris log menyertakan turn id; backend mengirim header.
  - Log default ke file berotasi (`logs/gemini-server.log`), bukan stdout saja.
  - Endpoint `/metrics` (JSON): total generate, reset events, refusals, retries, errors, latency (avg/p95).
  - *Regression test* untuk `_looks_like_restart` (append/trim/rewrite-parsial/rewrite-penuh).
- Backend observability:
  - Log JSON per giliran (durasi, chars AI, resets, marker terdeteksi, hasil guardrail, bytes persist, error).
  - Import `X-Turn-Id` dari frontend (atau generate di backend) dan teruskan ke gateway.
- `scripts/scan-db` (TS/Node atau Python): scan `messages` untuk korup lama (fence ganjil, blok duplikat, truncation), laporkan & tawarkan repair — otomatisasi pembersihan manual yang pernah dilakukan untuk pesan 1489/1491.

---

## 6. Fase 3 — Fondasi kualitas (test, lint, CI)

- **Test backend** (vitest): `guardrail`, parser marker (read/write/plan/mode/mood), `memory.ts` (REINFORCE_REQUIRED, evidence rules, seksi prompt, struktur), `parseMemoryUpdate`, `sanitizeStale`.
- **Test gateway** (pytest, mock `generate_content_stream`): restart detection, `_event_stream` reset forwarding, refusal overwrite, `_run_complete` retry, budget `MAX_PROMPT_CHARS`.
- **Test frontend** (vitest): pindahkan fungsi murni `applyStreamReset`/`stripStreamMood`/`extractStreamResult` dari `ChatRoom.tsx:72-104` ke `frontend/src/lib/stream.ts`, lalu uji.
- **Lint**: eslint (backend + frontend), ruff (gemini-server).
- **Script agregat**: `npm run check` (typecheck + lint + test semua paket). Tambah skrip `test` di tiap `package.json`.
- **CI** (keputusan akhir saat Fase 3): `.github/workflows/ci.yml` (typecheck + lint + test pada push/PR). Remote sudah GitHub.
- Dokumentasi singkat di README: alur pertahanan berlapis.

---

## 7. Urutan eksekusi & review

1. **Fase 1** — segera setelah rencana disetujui. *Review:* pantau report-only selama 1 minggu penggunaan nyata → nil false-positive.
2. **Fase 2** — lanjut setelah Fase 1 stabil.
3. **Fase 3** — gabungan akhir; aktifkan auto-repair guardrail hanya jika false-positive dari Fase 1 rendah.

Catatan operasional: `gemini-server/` di-ignore git (sensitif, cookie akun). Perbaikan di sana tidak ikut versi; back up secara manual bila perlu.