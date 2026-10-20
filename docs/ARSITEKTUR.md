# Arsitektur Lode (Sensei Mentor)

> Ringkasan teknis sistem: komponen, alur request, protokol marker AI, memori/progress, skema DB, dan keamanan. Dibuat dari kode aktual (commit terakhir `31f1165`).

## 1. Komponen

```
┌──────────────┐   /api (proxy Vite, atau langsung saat prod)
│  Frontend     │ ───────────────────────────────┐
│  React 19 +   │                                ▼
│  Vite + TW4    │                    ┌───────────────────────┐
└──────────────┘                     │  Backend (Node murni)  │
        ▲                            │  backend/server/index  │
        │ SSE + control marker       │  + lib/*               │
        │ (text/event-stream)        └───────────┬───────────┘
        │                                        │ HTTP OpenAI-compatible
        │                                        ▼
        │                          ┌──────────────────────────┐
        │                          │ gemini-server (FastAPI)   │
        │                          │ port 8003 · cookie auth   │
        │                          │ /v1/chat/completions dll  │
        └──────────────────────────┘──────────────────────────┘
```

| Bagian | Peran |
|--------|-------|
| `backend/` | API + database. HTTP murni (`node:http`, tanpa framework), TypeScript, SQLite via `node:sqlite` (WAL mode). Semua logika mentor & agent di sini. |
| `frontend/` | SPA React 19 + Vite + Tailwind CSS v4. Membaca API, menstream chat, merender markdown, panel progress/plan/riwayat. |
| `gemini-server/` | Gateway AI stateless berbasis cookie akun Gemini (paket `gemini-webapi`). Menyediakan endpoint OpenAI-compatible. Folder ini di-gitignore (sensitif). |

Alam data: satu file `backend/data/mentor.db` (SQLite). `backend/data/` di-gitignore.

## 2. Alur satu giliran chat (`POST /api/chat`)

Endpoint ini mengembalikan **SSE** (`text/plain`), bukan JSON. Alur di `backend/server/index.ts`:

1. **Validasi & idempotensi** — pesan wajib non-kosong; `conversationId` 0 = buat percakapan baru (title = 36 karakter pertama pesan, folder = `profile.workspace`, `ai_session = randomUUID()`). Pesan user langsung di-insert dengan `client_msg_id` opsional; bila `client_msg_id` duplikat dalam percakapan, baris tidak dibuat dua kali (`backend/lib/db.ts` `addMessage` + unique index `ux_messages_conv_clientmsg`).
2. **Serialisasi giliran** — `beginChatTurn()` mengantre request chat lewat rantai Promise (`chatQueue`) supaya dua giliran tidak saling menimpa konteks.
3. **Bangun konteks** — gabungan:
   - `ACTIVE_CHAT_WINDOW = 50` pesan terakhir → `sanitizeStale(...)` (dedup beruntun identik + buang pesan assistant lama `risk high`) → `.slice(-50)`.
   - topik & memori milik percakapan;
   - `buildWorkspaceContext` (pohon folder + auto-dump bila `ws_auto_kb > 0`);
   - `buildAuthoredFilesContext` (isi terkini berkas yang pernah ditulis Lode);
   - `buildPlanContext` (rencana belajar), `buildModeContext` (mode giliran);
   - `buildSystemPrompt` (profil, progress, reinforcement, review, aturan mentor).
4. **Pilih mode giliran** — `chooseMode(...)`; mode efektif tersimpan (lihat bagian 6).
5. **Round 1 stream** — `parseRound1` menahan jawaban selama buffer < 1024 byte **atau** belum terlihat `\n\n`, sambil menangkap marker `@@read(...)`. Kalau ada marker `@@read`, jawaban dipegang (tidak di-stream) untuk menyiapkan Round 2.
6. **Eksekusi `@@write`/`@@mkdir`** — `parseAgentBlocks` mengekstrak blok; bila folder + `ws_allow_write`, `applyWorkspaceWrites` menulis file (sandbox path), lalu `recordFileWrites` menyimpan snapshot lama ke `file_revisions` (dasar panel undo).
7. **Guard penolakan** — bila jawaban belum terkirim & terdeteksi frasa "saya hanya model bahasa" dkk. (`looksLikeRefusal`), ulangi sekali dengan payload sama. Bila streaming sudah terlanjur tampil lalu ditimpa penolakan, kirim `\n@@reset\n` ke klien, ulangi sekali; jawaban yang masih berupa penolakan diubah jadi pesan error.
8. **Round 2 (bila perlu)** — ada `@@read` (file dibaca via `gatherFileDump`, dikirim sebagai pesan user tambahan), atau bila user minta buat berkas tapi model tidak mengeluarkan blok `@@write`.
9. **Finalisasi & persist** — `finalMood` (baca marker `@@mood`), lalu `validateOutput` (guardrail):
   - `ok` → simpan apa adanya;
   - tidak `ok` → `sanitizeText` (tutup fence ganjil, buang marker bocor, rapikan newline) + strip nota `> ⚠️ **Catatan sistem:** ...` ke bagian akhir.
   Setelah `addMessage(cid, "assistant", ...)`, backend mengirim marker kontrol ke klien: `@@mood:`, `@@mode:`, `@@plan:id:status`, `@@files:n` bila ada.
10. **Sisa** — update `conversations.ai_mode`, `patchPlanItem` untuk tiap `@@plan`.

### Round 2 menambah file

Error/write dari Round 2 ditangani sama; setelahnya `finalText` digabung dengan catatan `[FILE/FOLDER DITULIS ...]`.

### Auto-create berkas (`askedCreate`)

Jika user memakai kata kerja buat/tulis + target file/folder, dan jawaban model ternyata tanpa blok `@@write`, backend meminta model menulis **hanya satu blok** `@@write` di Round 2.

## 3. Protokol marker

### Model → sistem (diparsis & di-strip dari tampilan)

| Marker | Diproses oleh | Arti |
|--------|---------------|------|
| `@@read("rel")` | `index.ts` (`READ_MARKER`) | Minta isi file workspace; memicu Round 2. |
| `@@write("rel")\n<isi>\n@@end` | `parseAgentBlocks` (workspace.ts) | Tulis berkas; di-strip dari tampilan. |
| `@@mkdir("rel")` | `parseAgentBlocks` | Buat folder kosong. |
| `@@mode("konsep"\|"latihan"\|"proyek"\|"uji")` | `stripModeMarkers` | Pindah mode, disimpan ke `conversations.ai_mode`. |
| `@@plan(<id>,"todo"\|"learning"\|"done"\|"stuck")` | `stripPlanMarkers` | Update status item rencana. |
| `@@mood("senang"\|...)` | `finalMood` | Emosi mentor untuk avatar. |

Stripping streaming aman: `createMarkerStripper` menahan ekor buffer yang mungkin awal marker (`@@mo`, `@@read("a`), supaya marker yang terpotong antar-chunk tidak pernah bocor ke layar. `stripMarkers` juga memakai `stripPlanMarkers`/`stripModeMarkers` dengan sink `Map` untuk menangkap update.

### Sistem → klien (baris kontrol dalam aliran SSE teks)

| Marker | Contoh | Arti |
|--------|--------|------|
| Reset | `\n@@reset\n` | Klien membuang seluruh teks kumulatif & mulai ulang (Gemini menulis ulang jawaban). |
| Mood | `@@mood:senang` | Emosi mentor saat ini. |
| Mode | `@@mode:latihan` | Mode efektif giliran ini. |
| Plan | `@@plan:3:done` | Status item plan berubah. |
| Files | `@@files:2` | Ada N berkas yang ditulis (refresh panel Riwayat File). |
| Error | `@@ai-error:<urlencoded>` | Kesalahan provider — hanya ditampilkan, tidak disimpan. |

`stripStreamMood` / `applyStreamReset` / `extractStreamResult` di `ChatRoom.tsx` memproses marker ini sisi klien. `X-Conversation-Id` / `X-Conversation-Title` (URL-encoded) dikirim sebagai header respons `/api/chat`.

## 4. Regenerate ("Ulangi") lewat `/api/chat`

Fitur sambung manual (`/api/chat/continue`) sudah **dihapus** — jawaban terpotong ditangani auto-continue di gateway (bagian 5), dan kalau hasilnya masih kurang, pengguna memakai **Ulangi** untuk menjawab ulang dari nol:

- Payload `/api/chat` dengan `{ conversationId, regenerateMessageId }` (tanpa `message`).
- Backend memvalidasi: `regenerateMessageId` harus pesan `assistant` **terakhir** dari percakapan itu; pertanyaan yang diulang diambil dari pesan user sebelumnya (`400` bila bukan).
- Tidak ada pesan user baru yang di-insert; history yang dikirim ke model = jendela 50 pesan **minus jawaban lama**, jadi model menjawab ulang pertanyaan, bukan melanjutkan jawaban lama.
- Flow round 1 / round 2 / guardrail dijalankan identik dengan kirim normal. Setelah stream selesai, jawaban baru **mengganti** yang lama lewat `replaceMessage(cid, messageId, content, mood, mode)` di `db.ts` — ID & posisi pesan tetap, jadi histori/memori tidak menumpuk dua jawaban.
- Kalau stream gagal, jawaban lama tetap utuh di DB (tidak hilang).
- Sisi klien: tombol **Ulangi** hanya muncul pada pesan assistant terakhir; saat selesai ia memicu `/api/memory/update` ulang supaya topik/memori dihitung dari jawaban baru (konsisten, bukan akumulasi dobel).

## 5. Gemin gateway (`gemini-server/server.py`)

Endpoint: `POST /v1/chat/completions` (stream & non-stream), `GET /v1/models`, `POST /v1/sessions/delete` (stateless — hanya mencatat), `GET /health`.

- **Stateless** — `thread`/`session` dari klien diabaikan; konteks selalu dikirim ulang lewat `messages`. Sesi "percakapan" disimpan backend.
- **Prompt builder** (`_build_prompt`): sistem → `[INSTRUKSI SISTEM]` (+ kalimat anti-penolakan), riwayat → `[RIWAYAT PERCAKAPAN]`, terakhir → `[PERMINTAAN TERAKHIR]`. Pesan non-teks diabaikan; budget `GEMINI_MAX_HISTORY_TURNS` + `GEMINI_MAX_PROMPT_CHARS`.
- **Restart detection** (`_looks_like_restart`): selama streaming, teks kumulatif normal selalu "menambahkan di ekor". Kalau awalan tidak lagi cocok (`new_full` tidak diawali `sent`) dan pemendekan > `_RESTART_SHRINK`, dianggap tulis-ulang → kirim `reset` + isi penuh lagi ke klien.
- **Refusal overwrite** (`_is_refusal_overwrite`): jawaban berarti yang ditimpa penolakan dipertahankan (just stop streaming).
- **Auto-continue** (`_looks_truncated`): bila jawaban berhenti tanpa tanda penutup wajar (`_COMPLETE_TAIL`) atau blok kode menggantung, kirim `_continuation_prompt` sampai `GEMINI_MAX_CONTINUE_ROUNDS` (default 3).
- **Auth & sekurity**: `API_SECRET` wajib bila `HOST` bukan loopback; cookie dibaca ulang saat `.env` berubah; latch `_mark_auth_blocked` menahan retry selama `GEMINI_AUTH_RETRY_COOLDOWN`; cache cookie di `chmod 700`. Penyegaran cookie (`fetch_cookies.sh`) **memverifikasi** hasil ambil ke Gemini (`GetUserStatus`) sebelum menimpa `.env` — cookie yang tidak valid tidak menimpa cookie lama yang mungkin masih berlaku.

> Catatan: `_complete_once` masih memegang `asyncio.Semaphore(1)` *di dalam* `wait_for` — masalah "antrean kehabisan budget" di daftar Fase 2, belum disentuh.

## 6. Progress, memori, dan mode

### Topik & mastery (`backend/lib/db.ts`, `memory.ts`)

- Status topik: `mastered | learning | stuck | todo`. Unique per `(conversation_id, name)`.
- Rule mastery: kenaikan max **+20/giliran**; `mastered` baru mutlak skor ≥ 60 **dan** `strong_evidence ≥ REINFORCE_REQUIRED (=3)`. Tanpa bukti kuat mastery dicap di 45; dengan < 3 bukti kuat dicap di 59.
- "Bukti kuat" hanya dari jawaban benar + alasan, praktik berhasil, atau menjelaskan ulang dengan benar (ditandai `bobot=kuat` di parser `parseMemoryUpdate`).
- **Reinforcement wajib** — topik `learning`/`stuck` yang `strong_evidence < 3` masuk blok `REINFORCEMENT WAJIB` di system prompt; Lode dilarang buka materi baru hingga tuntas. Kalau pelajar bertanya / melaporkan error (bukan menjawab soal), ia menjawab langsung tanpa evaluasi.
- **Spaced review** — topik `mastered` yang `last_reviewed_at` ≥ 3 hari masuk `REVIEW BERKALA`.

### Auto-update progress (`POST /api/memory/update`)

Mengambil 4 pesan terakhir percakapan → `buildMemoryUpdatePrompt` → `chatText` (non-stream) → `parseMemoryUpdate`:

```
TOPICS:
- [status] Nama Topik: catatan || mastery=70 || bukti=... || bobot=kuat || yakin=70
MEMORY:
- [fact|preference|progress|insight] ...
TIDAK ADA PERUBAHAN   (bila nihil)
```

Catatan: dipanggil dari sisi klien setelah satu giliran selesai (tombol/API), bukan di dalam aliran `/api/chat`.

### Mode belajar (`backend/lib/mode.ts`)

`chooseMode` urut: mode terkunci manual (`conversations.mode ≠ auto`) → kata kunci pesan (`MODE_INTENT`: uji/latihan/proyek/konsep) → ada topik stuck → lanjutkan `ai_mode` giliran kemarin → mastery ≥ 60 → default `konsep`. `proyek` tanpa folder jatuh ke `konsep`. Mode efektif tiap pesan disimpan di `messages.mode` dan dikirim balik via marker `@@mode:`.

## 7. Skema database (`backend/lib/db.ts`)

```
profile           (id=1)                     — nama, bahasa, level, gaya, folder default,
                                                  ws_max_depth/files/auto_kb/allow_write,
                                                  ai_base_url/api_key/model
conversations     id, title, folder, mode, ai_mode,
                  ai_session, created_at, updated_at
messages          id, conversation_id FK, role, content, mood, mode,
                  client_msg_id (unique partial per conversation), created_at
memories          id, type, content, conversation_id, created_at
topics            id, name, status, notes, mastery, confidence, evidence,
                  strong_evidence, last_reviewed_at, conversation_id, updated_at
workspace_files   id, conversation_id, rel (unique per conversation)
plan_items        id, conversation_id, phase, title, objective, prerequisites,
                  status, order_index, updated_at
file_revisions    id, conversation_id, rel, content, existed, bytes,
                  added, removed, source ('lode'|'undo'), created_at
```

Migrasi otomatis saat start: `ensureColumn` (tambah kolom lama), `migrateTopics` (membangun ulang tabel topics agar unique per percakapan), `dropLegacyReviewCards` (hapus tabel sisa fitur kartu review), dan backfill nilai default (`ws_max_depth=7`, `ws_max_files=350`, `ai_base_url=8003`). `runMaintenance()` menghapus data yatim (pesan/topik/memori/plan/workspace tanpa percakapan) + `PRAGMA optimize` + `wal_checkpoint` — tombol "Bersihkan data lama" di UI.

## 8. Ekspor / impor / fork

Format: `{"format":"lode-conversation","version":1,...}` (`ConversationExportPayload`).

- `GET /api/conversations/:id/export` — pesan, topik, memori, plan, dan isi berkas workspace (rel + content).
- `POST /api/conversations/import` — buat percakapan baru dari payload (pesan/context disalin). `warnings` untuk topik duplikat, dll.
- `POST /api/conversations/:id/fork` — salin lengkap (termasuk pesan). `fork-clean` = `importConversationContext(..., { includeMessages: false })`: **tanpa pesan**, tapi tetap membawa topik/memori/plan/workspace → sesi baru yang "masih tahu progress".

Sesi `ai_session`/`ai_thread` tidak diekspor (selalu kosong saat impor).

## 9. Keamanan

- **Workspace sandbox** (`workspace.ts`): semua path di-resolve & diverifikasi `isInside(root)` (termasuk setelah `mkdir`/`realpath`); symlink ditolak; ekstensi biner/`WRITE_MAX` (>100KB) ditolak; `SKIP_DIRS` (node_modules, .git, dist, Library, Packages, dll) dilewati; pembacaan file besar (>400KB) dipotong.
- **Folder picker** mendukung `zenity` → `kdialog` → `yad` (dialog sistem, tanpa ngetik path).
- **Auth AI**: cookie `SECURE_1PSID`/`SECURE_1PSIDTS` hanya di `gemini-server/.env` (chmod 600, gitignored); `API_SECRET` wajib untuk host non-loopback (start.sh & server.py memeriksa); perbandingan pakai `secrets.compare_digest`.
- **Postingan idempoten**: `client_msg_id` + unique index `ux_messages_conv_clientmsg` mencegah duplikat karena kirim ganda.
- **Output AI tidak pernah ditulis mentah** sampai lolos guardrail; marker perintah selalu di-strip dari tampilan dan history.

## 10. Pengujian

- `npm run typecheck` — tsc backend + frontend.
- `npm --prefix backend test` — vitest: `backend/lib/guardrail.test.ts` (fence/truncation/duplikasi/leak/sanitize) & `backend/lib/idempotency.test.ts`.
- Test gateway (pytest), lint, dan CI masih di daftar Fase 3 (lihat `HARDENING-PLAN.md`).