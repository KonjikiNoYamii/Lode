# Lode — AI Dev Guide with Persistent Memory

App pribadi untuk belajar programming dengan bantuan AI yang **satu mentor, konsisten selamanya**. Tidak seperti ChatGPT yang lupa progress kamu, Lode selalu "ingat" karena memori + progress kamu disimpan di database dan di-inject ulang ke setiap percakapan.

## Struktur

```
sensei-mentor/
├── backend/              # API + database (Node murni, tanpa framework)
│   ├── server/           # HTTP server (node:http) + semua route API
│   └── lib/              # db (SQLite node:sqlite), ai client, template memori mentor
├── frontend/             # UI (Vite + React + TypeScript + Tailwind)
│   └── src/              # App, Chat, Sidebar, Settings, komponen tema anime
└── gemini-server/         # Copy lokal gemini-server berbasis cookie akun Gemini
```

## Cara pakai

### 1. Siapkan cookie akun Gemini

Project ini memakai copy `gemini-server` di dalam repo. Folder ini **sensitif dan sengaja tidak di-commit** (sudah masuk `.gitignore`), jadi jangan dihapus dan jangan di-push. Autentikasinya memakai cookie sesi Google/Gemini, **bukan** Google API key, dan tidak memakai server Gemini project lain.

1. Buka https://gemini.google.com dan login ke akun yang mau dipakai.
2. Buka DevTools (`F12`) → **Application/Storage** → **Cookies** → `https://gemini.google.com`.
3. Salin nilai `__Secure-1PSID` dan `__Secure-1PSIDTS`.
4. Siapkan file konfigurasi:

```bash
cp gemini-server/.env.example gemini-server/.env
```

Isi `gemini-server/.env` dengan `SECURE_1PSID=<cookie>` dan `SECURE_1PSIDTS=<cookie>`. Jangan pernah commit file ini. `npm run ai` akan membuat virtualenv, memasang dependency dari `gemini-server/requirements.txt`, lalu menjalankan service lokal.

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
- gemini-server lokal: http://127.0.0.1:8003 (cookie auth)

> Nama kamu otomatis diambil dari username Linux — tidak perlu mengetik lagi.

### 4. Production (build + app satu port)

Jalankan `npm run ai` di terminal terpisah, lalu:

```bash
npm run build
npm run start
```

Frontend + API dilayani di http://localhost:8787; service AI tetap berjalan lokal di port 8003.

## Fitur

- **Chat streaming** dengan AI, tampilan markdown rapi.
- **Syntax highlighting** otomatis untuk kode (highlight.js) dan **KaTeX** untuk matematika.
- **Render `<Sequence>/<Step>`** dari output Gemini jadi daftar terstruktur.
- **Memori persisten**: profil, histori, progress, dan catatan mentor tersimpan di SQLite (`backend/data/mentor.db`) dan tetap bisa dibuka kembali.
- **Progress otomatis** — setelah tiap percakapan, Lode mencatat topik yang dikuasai / sedang dipelajari / buntu, lalu topik yang sudah dikuasai tidak akan dijelaskan ulang.
- **Riwayat percakapan** — semua chat tersimpan, bisa dibuka kapan saja. Mentornya tidak "ganti-ganti".
- **Roadmap-anchored mentoring** — Lode mengikuti roadmap belajar (mis. `ROADMAP.md`) dan tidak melompat ke materi lanjutan sebelum dasar selesai.
- **Rencana belajar terstruktur** — plan per percakapan tersimpan di database (fase, target, prasyarat, status), jadi urutan belajar tidak hanya mengandalkan file. Lode memakai plan ini sebagai sumber kebenaran dan bisa menandai item selesai sendiri lewat marker `@@plan`; status juga bisa diubah manual dari panel **Rencana Belajar**.
- **Gaya belajar** — menyesuaikan dengan preferensi (praktek, teori, visual, cerita).
- **Sesi chat terisolasi** — tiap percakapan memiliki UUID sendiri; konteks dibangun dari histori percakapan tersebut, tanpa session Gemini global. Request chat diproses berurutan agar tidak menimpa context.
- **Folder workspace (AI agents)** — tiap percakapan bisa diarahkan ke folder lokal tempat kamu menulis jawaban/PR di code editor (mis. Zed). Lode membaca struktur dan isi file; penulisan file hanya aktif jika diizinkan lewat Settings.
- **Breathing-room UI** — reveal bertahap pesan, heading gradien animasi, blok kode "bernapas" (glow lembut), shimmer loading.
- **Tema anime** yang menyenangkan ✨

## Konfigurasi

Semua setting disimpan di database (edit lewat UI **Pengaturan**):

| Field              | Default                | Keterangan                        |
| ------------------ | ---------------------- | --------------------------------- |
| AI server URL      | `http://127.0.0.1:8003/v1` | gemini-server lokal project ini |
| API secret server  | (kosong)               | Opsional; hanya untuk host non-loopback |
| Model              | (kosong)               | Server memilih model flash yang tersedia di akun |
| Folder workspace default | (kosong)            | Dipakai tiap percakapan baru (bisа diubah per-percakapan lewat tombol **Folder** di chat) |
| Bahasa / Level / Tujuan / Gaya belajar | —      | Dipakai AI untuk menyesuaikan pengajaran |

> Catatan: DB berisi data pribadi & API secret opsional. File `backend/data/` dan `gemini-server/.env` di-gitignore, jangan pernah di-commit.

## Cara kerja folder workspace (agent)

1. Di halaman Chat, klik tombol **+ Folder** (atau **Folder** kalau sudah ter-set).
2. Pilih folder lewat **"Pilih folder dari pengelola file"** — dialog pemilih folder asli dari sistem (zenity/kdialog) yang terbuka, sekali klik, tanpa ngetik path.
3. Klik **Pindai folder** untuk memastikan path valid, lalu **Simpan folder**.
4. Ketik seperti biasa, misal *"Cek file latihan.py aku, ada error"* — Lode otomatis membaca struktur folder, dan kalau perlu detail file akan membaca isinya lalu menjawab.

Secara default Lode hanya membaca. Jika switch **"Lode boleh membuat file/folder"** diaktifkan, blok `@@write` dari model dapat membuat file/folder di dalam workspace yang dipilih; file di luar workspace tetap ditolak.

Pengamanan: folder `node_modules`, `.git`, `dist`, file biner & file besar (>400KB) otomatis dilewati.

> Tombol "Pilih folder" memakai dialog sistem (butuh `zenity`; pasang via `sudo pacman -S zenity` bila belum ada). Kalau tidak ada, path tetap bisa diketik manual.

## Port

- 5173 — Vite dev server (frontend)
- 8787 — API server (backend)
- 8003 — gemini-server lokal project ini (cookie auth)

## Gemini server lokal

Untuk menjalankan service AI tanpa aplikasi:

```bash
npm run ai
```

Service ini stateless: histori dan sesi percakapan disimpan oleh backend Sensei Mentor, sedangkan cookie akun dibaca dari `gemini-server/.env`. File `.env` dan cache cookie `.cache/` sudah di-gitignore. Jika `HOST` diganti dari loopback, `API_SECRET` wajib diisi.

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
- **AI server**: Python (FastAPI, uvicorn, gemini-webapi cookie auth)
- **Markdown**: react-markdown, remark-gfm, remark-math, rehype-katex, rehype-highlight
