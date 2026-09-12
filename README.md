# Sensei — Mentor Belajar dengan Memori Jangka Panjang

App pribadi untuk belajar programming dengan bantuan AI yang **satu mentor, konsisten selamanya**. Tidak seperti ChatGPT/opencode yang lupa progress kamu, Sensei selalu "ingat" karena memori + progress kamu disimpan di database dan di-inject ulang ke setiap percakapan.

## Struktur

```
sensei-mentor/
├── backend/          # API + database (Node murni, tanpa framework)
│   ├── server/       # HTTP server (node:http) + semua route API
│   └── lib/          # db (SQLite node:sqlite), ai client, template memori mentor
└── frontend/         # UI (Vite + React + TypeScript + Tailwind)
    └── src/          # App, Chat, Sidebar, Settings, komponen tema anime
```

## Cara pakai

### 1. Siapkan gemini-server (sumber AI kamu)

App ini butuh endpoint **OpenAI-compatible**. Kamu sudah punya `gemini-server` sendiri (memakai cookie Gemini web) yang menyediakan `POST /v1/chat/completions` di `http://localhost:8000`. Jalankan server itu seperti biasa.

Kalau pindah-pindah server/port, tinggal ubah di UI: **Profil & Server → AI server URL**.

### 2. Install

```bash
npm run setup
```

### 3. Jalankan (dev)

Satu perintah menjalankan semuanya (termasuk AI server):

```bash
npm run dev:full
```

- `npm run dev` — hanya app; pakai gemini-server yang sudah jalan di `:8000`.
- `npm run dev:full` — gemini-server + backend + frontend (kalau `:8000` sudah hidup, otomatis dilewati).
- `npm run ai` — jalankan gemini-server saja (aman dipanggil ulang).

- Frontend: http://localhost:5173
- API: http://localhost:8787 (auto-diproxy oleh Vite ke `/api`)
- AI server sumber: http://localhost:8000

> Nama kamu otomatis diambil dari username Linux — tidak perlu mengetik lagi.

### 4. Production (build + satu port)

```bash
npm run build
npm run start     # melayani frontend + API di http://localhost:8787
```

## Fitur

- **Chat streaming** dengan AI, tampilan markdown rapi.
- **Memori jangka panjang**: profil kamu, progress belajar, dan catatan mentor tersimpan di SQLite (`backend/data/mentor.db`).
- **Progress otomatis** — setelah tiap percakapan, Sensei mencatat topik yang dikuasai / sedang dipelajari / buntu, lalu topik yang sudah dikuasai tidak akan dijelaskan ulang.
- **Riwayat percakapan** — semua chat tersimpan, bisa dibuka kapan saja. Mentornya tidak "ganti-ganti".
- **Folder workspace (AI agents)** — tiap percakapan bisa diarahkan ke folder lokal tempat kamu menulis jawaban/PR di code editor (mis. Zed). Sensei *membaca* folder itu (struktur + isi file) untuk mengoreksi — read-only, kamu yang menulis di editor.
- **Tema anime** yang menyenangkan ✨

## Konfigurasi

Semua setting disimpan di database (edit lewat UI **Profil & Server**):

| Field              | Default                | Keterangan                        |
| ------------------ | ---------------------- | --------------------------------- |
| AI server URL      | `http://localhost:8000/v1` | Endpoint OpenAI-compatible      |
| API key            | (kosong)               | Kosongkan kalau server lokal      |
| Model              | (kosong)               | Kosong = pakai default gemini-server |
| Folder workspace default | (kosong)            | Dipakai tiap percakapan baru (bisа diubah per-percakapan lewat tombol **Folder** di chat) |
| Bahasa / Level / Tujuan / Gaya belajar | —      | Dipakai AI untuk menyesuaikan pengajaran |

> Catatan: DB berisi data pribadi & API key. File `backend/data/` di-gitignore, jangan pernah di-commit.

## Cara kerja folder workspace (agent)

1. Di halaman Chat, klik tombol **+ Folder** (atau **Folder** kalau sudah ter-set).
2. Pilih folder lewat **"Pilih folder dari pengelola file"** — dialog pemilih folder asli dari sistem (zenity/kdialog) yang terbuka, sekali klik, tanpa ngetik path.
3. Klik **Pindai folder** untuk memastikan path valid, lalu **Simpan folder**.
4. Ketik seperti biasa, misal *"Cek file latihan.py aku, ada error"* — Sensei otomatis membaca struktur folder, dan kalau perlu detail file akan membaca isinya lalu menjawab.

Fitur ini **read-only**: Sensei tidak pernah menulis/mengubah file — kamu tetap menulis di editor (Zed/VSCode/apa pun), Sensei hanya membaca dan mengoreksi.

Pengamanan: folder `node_modules`, `.git`, `dist`, file biner & file besar (>400KB) otomatis dilewati.

> Tombol "Pilih folder" memakai dialog sistem (butuh `zenity`; pasang via `sudo pacman -S zenity` bila belum ada). Kalau tidak ada, path tetap bisa diketik manual.

## Port

- 5173 — Vite dev server (frontend)
- 8787 — API server (backend)
- 8000 — gemini-server kamu (sumber AI)