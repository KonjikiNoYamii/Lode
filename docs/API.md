# API Reference — Lode

Daftar endpoint backend (`backend/server/index.ts`) dan gateway AI (`gemini-server/server.py`). Dalam mode dev, frontend Vite mem-proxy `/api` ke `http://localhost:8787`.

- Format JSON kecuali `/api/chat` yang **SSE teks** (`text/plain`, bukan `application/json`).
- Error umum: `400` (parameter invalid), `404` (tidak ditemukan), `502` (server AI tidak terjangkau / gagal), `500` (exception tak terduga). Body error: `{"error": string, "detail"?: string}`.

## Backend

### Chat

#### `POST /api/chat` — kirim pesan (streaming + agent)

Body:
```json
{ "message": "teks", "conversationId": 0, "clientMsgId": "uuid-opsional" }
```
- `conversationId` 0/kosong → buat percakapan baru. `clientMsgId` menjamin idempotensi (duplikat tidak di-insert).
- **Mode "Ulangi" (regenerate):** sertakan `regenerateMessageId` (id pesan assistant terakhir) alih-alih `message`. Backend menjawab ulang pertanyaan yang sama dengan context yang sama, tanpa menambah pesan user; jawaban baru **menggantikan** jawaban lama di tempat (`replaceMessage` — ID & posisi tetap, histori tidak menumpuk). `400` bila pesan bukan jawaban AI terakhir, `conversationId` wajib diisi.
- **Lanjutan otomatis (banyak bagian):** mentor menutup pesannya dengan marker `@@more("judul bagian berikutnya")` (disembunyikan dari tampilan & disimpan). Backend mem-beberapa-ekstra sinyal `\n@@more\n` di akhir stream; klien otomatis menembak `/api/chat` ulang dengan `{ "conversationId", "continuePart": true, "mode": <mode efektif bagian sebelumnya> }` — **tanpa pesan user baru** — sampai mentor berhenti (maksimal 3 bagian per giliran). Tiap bagian disimpan sebagai pesan assistant terpisah. `mode` opsional: memaksa mode lanjutan agar rangkaian tidak belok. Persyaratan: `conversationId` wajib, `message` tidak dipakai, dan percakapan harus sudah ada.

Respons: stream teks + marker kontrol. Header: `X-Conversation-Id`, `X-Conversation-Title` (URL-encoded, saat buat baru).
Error: `400` pesan kosong/conversationId invalid; `404` percakapan tidak ada; `502` server AI tidak terjangkau.

Marker yang bisa muncul di stream:
```
\n@@reset\n            # buang teks kumulatif, mulai ulang
@@mood:{senang|...}    # emosi mentor
@@mode:{konsep|latihan|proyek|uji}
@@plan:{id}:{status}   # status rencana berubah
@@files:{n}            # n berkas ditulis (refresh riwayat)
\n@@more\n             # masih ada bagian berikutnya → lanjut otomatis (continuePart)
@@ai-error:{urlencoded}
```

### Sistem

#### `GET /api/health` — cek koneksi AI

```json
{ "ok": bool, "upstream_status": number|null, "upstream_url": string, "body": {...}|null, "error": string|null }
```
`ok=false` tapi HTTP 200 bila upstream tidak terjangkau.

### Profil

#### `GET /api/profile`
Mengembalikan `Profile` (name, language, skill_level, goals, learning_style, mascot, workspace, ws_max_depth, ws_max_files, ws_auto_kb, ws_allow_write, ai_base_url, ai_api_key, ai_model).

#### `PUT /api/profile`
Body parsial dari field di atas. Menghasilkan `Profile` terbaru.

### Workspace

#### `GET /api/workspace/info?folder=&depth=&files=`
`{ ok:true, root, fileCount, skippedDirs }` atau `{ ok:false, error }`. `depth` (1–12) & `files` (10–3000) opsional.

#### `GET /api/workspace/tree?folder=&files=&depth=`
`{ ok:true, root, entries:[{rel,name,isDir,size}], truncated, fileCount }`.

#### `GET /api/workspace/read?folder=&file=`
`{ ok:true, content, truncated }` (file besar dipotong ~400KB) atau error.

#### `GET /api/workspace/pick?folder=`
Buka dialog folder sistem (zenity/kdialog/yad). `{ ok:true, selected, tool }` atau `{ ok:false, error }`.

### State & percakapan

#### `GET /api/state`
`{ profile, conversations:[...], topics:[...], memories:[...] }` — data awal dashboard.

#### `GET /api/conversations`
`{ conversations: [...] }` (termasuk `message_count`).

#### `GET /api/conversations/:id`
Query opsional: `?limit=&before=<messageId>`. Respons: `{ conversation_id, total_messages, messages, folder, mode, effective_mode }`.

#### `GET /api/conversations/:id/progress`
`{ conversation_id, topics, memories, plan, revisions }` — panel sisi kanan.

#### `PATCH /api/conversations/:id`
Body: `{ title?, folder?, mode? }` (mode dinormalisasi ke `auto|konsep|latihan|proyek|uji`).

#### `DELETE /api/conversations/:id`
Hapus percakapan + pesan/topik/memori/plan (+ kirim ke gateway `POST /v1/sessions/delete` bila ada `ai_session`).

#### `GET /api/conversations/:id/export`
`ConversationExportPayload` — pesan, topik, memori, plan, dan isi berkas workspace.

#### `POST /api/conversations/:id/fork`
Salin lengkap (termasuk pesan). `{ id, warnings }`.

#### `POST /api/conversations/:id/fork-clean`
Sesi baru tanpa pesan, tetap membawa topik/memori/plan/workspace. `{ id, warnings }`.

#### `POST /api/conversations/import`
Body: payload ekspor. `{ id, warnings }`. Error `400` bila format/version tidak dikenali.

### Topik

- `GET /api/topics` → `{ topics }`
- `POST /api/topics` — body `{ name, status?, notes?, conversationId?, mastery?, confidence?, evidence? }`
- `PATCH /api/topics/:id` — body parsial (`name, status, notes, mastery, confidence, evidence`)
- `DELETE /api/topics/:id`

### Rencana belajar

- `GET /api/plan?conversationId=` → `{ plan }`
- `POST /api/plan` — body `{ conversationId, title, objective?, prerequisites?, phase? }`; 404 bila percakapan tidak ada, 400 judul kosong.
- `POST /api/plan/move` — body `{ conversationId, id, dir:"up"|"down" }`
- `PATCH /api/plan/:id` — body parsial (`title, objective, prerequisites, phase, status`)
- `DELETE /api/plan/:id`

### Riwayat file (undo)

- `GET /api/revisions?conversationId=&limit=` → `{ revisions:[...] }`
- `GET /api/revisions/:id/diff` → `{ revision, diff, added, removed, truncated }` (diff LCS, konteks ±3 baris; file besar di-ringkas)
- `POST /api/revisions/:id/restore` → `{ ok, removed?, revisions:[...] }` (mengembalikan isi; status sekarang ikut dicatat sebagai revisi `source:"undo"`)

### Memori

- `GET /api/memories` → `{ memories }`
- `POST /api/memories` — body `{ type?, content }`
- `DELETE /api/memories/:id`

#### `POST /api/memory/update` — auto-catatan progress
Body: `{ conversationId }`. Membaca 4 pesan terakhir → minta model memperbarui topik/memori.
Respons: `{ summary, topics, memories }`. `502` bila model gagal.

### Catatan

#### `POST /api/notes/make` — ubah satu output mentor jadi berkas `.md`
Body: `{ conversationId, messageId }`.
- Wajib folder workspace ter-set & `ws_allow_write` aktif (400 bila tidak).
- Respons: `{ ok, files:[rel,...], failed:[{rel,error}], error? }`. Backend menyembuhkan bila model tidak memakai `@@write` (fence kode → retry tegas → fallback nama file dari judul).

### Pemeliharaan

#### `POST /api/maintenance/cleanup`
`{ ok, freedMessages, freedTopics, freedMemories, freedPlan, sizeBefore, sizeAfter, walBefore, walAfter }`.

## Gemini gateway (port 8003)

Semua endpoint non-loopback memerlukan header `Authorization: Bearer <API_SECRET>`.

#### `GET /v1/models`
`{ object:"list", data:[{id, object, model, created, owned_by}] }`.

#### `POST /v1/chat/completions`
OpenAI-compatible. Body: `{ model?, messages[], stream?, session?, thread?, tools? }`.
- `stream: true` → SSE `data: {...}` OpenAI chunks + `control:"reset"` saat tulis-ulang; bisa berisi beberapa giliran lanjutan (auto-continue).
- Provider error → HTTP `4xx/502` dengan `detail`, atau stream error `data: {"error":{"message":...}}`.

#### `POST /v1/sessions/delete`
`{ session }` → `{ ok:true, stateless:true }` (gateway tidak menyimpan sesi).

#### `GET /health`
```json
{ "status","mode","client_ready","auth","cookies_configured","rate_limited_for",
  "model","protected","uptime_seconds","last_error" }
```

### Environment gateway (`gemini-server/.env`)

| Variable | Default | Keterangan |
|----------|---------|-----------|
| `SECURE_1PSID`/`SECURE_1PSIDTS` | — | Cookie akun Gemini (wajib). |
| `HOST` / `PORT` | `127.0.0.1` / `8003` | Bind. Non-loopback wajib `API_SECRET`. |
| `API_SECRET` | — | Bearer token untuk akses gateway. |
| `GEMINI_MODEL` | `gemini-3-flash` | Model default. |
| `GEMINI_INIT_TIMEOUT` | 60s | Timeout inisialisasi klien. |
| `GEMINI_REQUEST_TIMEOUT` | 150s | Batas total satu generate. |
| `GEMINI_REFRESH_INTERVAL` | 600s | Refresh token/klien berkala. |
| `GEMINI_RETRY_DELAY` | 1.5s | Jeda retry. |
| `GEMINI_MAX_HISTORY_TURNS` | 24 | Giliran riwayat maksimal. |
| `GEMINI_MAX_PROMPT_CHARS` | 24000 | Budget prompt; lebih → riwayat tertua dipangkas. |
| `GEMINI_MAX_CONTINUE_ROUNDS` | 3 | Giliran auto-continue saat jawaban terpotong. |
| `GEMINI_COOKIE_PATH` | `./.cache/gemini-webapi` | Cache cookie. |
| `CORS_ORIGINS` | default lokal | Daftar origin diizinkan (koma).