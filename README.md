# Lode — AI Dev Guide with Persistent Memory

App pribadi untuk belajar programming dengan bantuan AI yang **satu mentor, konsisten selamanya**. Tidak seperti ChatGPT yang lupa progress kamu, Lode selalu "ingat" karena memori + progress kamu disimpan di database dan di-inject ulang ke setiap percakapan.

## Struktur

```
sensei-mentor/
├── backend/          # API + database (Node murni, tanpa framework)
│   ├── server/       # HTTP server (node:http) + semua route API
│   └── lib/          # db (SQLite node:sqlite), ai client, template memori mentor
├── frontend/         # UI (Vite + React + TypeScript + Tailwind)
│   └── src/          # App, Chat, Sidebar, Settings, komponen tema anime
├── gemini-api-server/ # Gemini API server (port 8002, pakai Google AI Studio key)
├── openrouter-server/ # OpenRouter server (port 8010, pakai OpenRouter API key)
└── gemini-server/     # Gemini web server (port 8000, pakai cookie Gemini web)
```

## Cara pakai

### 1. Siapkan AI server

Lode mendukung beberapa backend AI. Pilih salah satu (atau jalankan beberapa sekaligus):

| Server | Port | Sumber AI | Keterangan |
|--------|------|-----------|------------|
| `gemini-api-server` | 8002 | Google AI Studio API key | Gratis, stabil, model `gemini-3.5-flash-lite` |
| `openrouter-server` | 8010 | OpenRouter API key | Banyak model, beberapa gratis |
| `gemini-server` | 8000 | Cookie Gemini web | Gratis, tapi cookie expiry perlu refresh |

**Rekomendasi**: `gemini-api-server` — gratis, tidak perlu cookie, stabil.

#### gemini-api-server (recommended)

```bash
cd gemini-api-server
python3 -m venv venv
./venv/bin/pip install fastapi uvicorn httpx pydantic python-dotenv
# Edit .env → isi GEMINI_API_KEY dari https://aistudio.google.com/apikey
systemctl --user start gemini-api-server  # atau: python3 server.py
```

#### openrouter-server

```bash
cd openrouter-server
python3 -m venv venv
./venv/bin/pip install fastapi uvicorn httpx pydantic python-dotenv
# Edit .env → isi OPENROUTER_API_KEY dari https://openrouter.ai/keys
systemctl --user start openrouter-server
```

#### gemini-server (cookie)

```bash
cd gemini-server
# Edit .env → isi SECURE_1PSID dan SECURE_1PSIDTS dari browser
systemctl --user start gemini-server
```

### 2. Install

```bash
npm run setup
```

### 3. Jalankan (dev)

```bash
npm run dev:full
```

- Frontend: http://localhost:5173
- API: http://localhost:8787 (auto-diproxy oleh Vite ke `/api`)
- AI server: http://localhost:8002 (atau :8010 / :8000 tergantung yang dipakai)

> Nama kamu otomatis diambil dari username Linux — tidak perlu mengetik lagi.

### 4. Production (build + satu port)

```bash
npm run build
npm run start     # melayani frontend + API di http://localhost:8787
```

## Fitur

- **Chat streaming** dengan AI, tampilan markdown rapi.
- **Syntax highlighting** otomatis untuk kode (highlight.js) dan **KaTeX** untuk matematika.
- **Render `<Sequence>/<Step>`** dari output Gemini jadi daftar terstruktur.
- **Memori jangka panjang**: profil kamu, progress belajar, dan catatan mentor tersimpan di SQLite (`backend/data/mentor.db`).
- **Progress otomatis** — setelah tiap percakapan, Lode mencatat topik yang dikuasai / sedang dipelajari / buntu, lalu topik yang sudah dikuasai tidak akan dijelaskan ulang.
- **Riwayat percakapan** — semua chat tersimpan, bisa dibuka kapan saja. Mentornya tidak "ganti-ganti".
- **Roadmap-anchored mentoring** — Lode mengikuti roadmap belajar (mis. `ROADMAP.md`) dan tidak melompat ke materi lanjutan sebelum dasar selesai.
- **Gaya belajar** — menyesuaikan dengan preferensi (praktek, teori, visual, cerita).
- **Thread/session isolation** — tiap percakapan terisolasi, konteks tidak bercampur.
- **Folder workspace (AI agents)** — tiap percakapan bisa diarahkan ke folder lokal tempat kamu menulis jawaban/PR di code editor (mis. Zed). Lode *membaca* folder itu (struktur + isi file) untuk mengoreksi — read-only, kamu yang menulis di editor.
- **Breathing-room UI** — reveal bertahap pesan, heading gradien animasi, blok kode "bernapas" (glow lembut), shimmer loading.
- **Tema anime** yang menyenangkan ✨

## Konfigurasi

Semua setting disimpan di database (edit lewat UI **Pengaturan**):

| Field              | Default                | Keterangan                        |
| ------------------ | ---------------------- | --------------------------------- |
| AI server URL      | `http://localhost:8002/v1` | Endpoint OpenAI-compatible      |
| API key            | (kosong)               | Kosongkan kalau server lokal      |
| Model              | (kosong)               | Kosong = pakai default server AI  |
| Folder workspace default | (kosong)            | Dipakai tiap percakapan baru (bisа diubah per-percakapan lewat tombol **Folder** di chat) |
| Bahasa / Level / Tujuan / Gaya belajar | —      | Dipakai AI untuk menyesuaikan pengajaran |

> Catatan: DB berisi data pribadi & API key. File `backend/data/` di-gitignore, jangan pernah di-commit.

## Cara kerja folder workspace (agent)

1. Di halaman Chat, klik tombol **+ Folder** (atau **Folder** kalau sudah ter-set).
2. Pilih folder lewat **"Pilih folder dari pengelola file"** — dialog pemilih folder asli dari sistem (zenity/kdialog) yang terbuka, sekali klik, tanpa ngetik path.
3. Klik **Pindai folder** untuk memastikan path valid, lalu **Simpan folder**.
4. Ketik seperti biasa, misal *"Cek file latihan.py aku, ada error"* — Lode otomatis membaca struktur folder, dan kalau perlu detail file akan membaca isinya lalu menjawab.

Fitur ini **read-only**: Lode tidak pernah menulis/mengubah file — kamu tetap menulis di editor (Zed/VSCode/apa pun), Lode hanya membaca dan mengoreksi.

Pengamanan: folder `node_modules`, `.git`, `dist`, file biner & file besar (>400KB) otomatis dilewati.

> Tombol "Pilih folder" memakai dialog sistem (butuh `zenity`; pasang via `sudo pacman -S zenity` bila belum ada). Kalau tidak ada, path tetap bisa diketik manual.

## Port

- 5173 — Vite dev server (frontend)
- 8787 — API server (backend)
- 8002 — gemini-api-server (Google AI Studio)
- 8010 — openrouter-server (OpenRouter)
- 8000 — gemini-server (cookie Gemini web)

## Systemd services

Semua server AI bisa dijalankan sebagai service:

```bash
# Enable & start
systemctl --user enable --now gemini-api-server openrouter-server gemini-server

# Status
systemctl --user status gemini-api-server openrouter-server gemini-server

# Logs
journalctl --user -u gemini-api-server -f
```

Service files: `~/.config/systemd/user/gemini-api-server.service`, dll.

## Git push (SSH)

Push ke GitHub pakai SSH (tidak perlu password/token):

```bash
# Setup (sekali saja)
ssh-keygen -t ed25519 -C "username@github.com" -N ""
# Copy ~/.ssh/id_ed25519.pub → tambah di https://github.com/settings/keys

# Ganti remote ke SSH
git remote set-url origin git@github.com:username/repo.git

# Push
git push -u origin main
```

## Tech stack

- **Backend**: Node.js (node:http murni), SQLite (node:sqlite), TypeScript
- **Frontend**: React 19, Vite, Tailwind CSS, TypeScript
- **AI servers**: Python (FastAPI, uvicorn, httpx)
- **Markdown**: react-markdown, remark-gfm, remark-math, rehype-katex, rehype-highlight
