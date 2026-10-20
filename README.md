# Lode — AI Dev Guide with Persistent Memory

App pribadi untuk belajar programming dengan bantuan AI yang **satu mentor, konsisten selamanya**. Tidak seperti ChatGPT yang lupa progress kamu, Lode selalu "ingat" karena memori + progress kamu disimpan di database dan di-inject ulang ke setiap percakapan.

Dokumentasi teknis lebih dalam:
- `docs/ARSITEKTUR.md` — alur request, protokol marker, skema DB, sistem memori/progress.
- `docs/API.md` — referensi lengkap endpoint backend & gemini-server.
- `docs/HARDENING-PLAN.md` — rencana & status pengerasan sistem (guardrail, test, observability).

## Struktur

```
sensei-mentor/
├── backend/              # API + database (Node murni, tanpa framework)
│   ├── server/index.ts   # HTTP server (node:http) + semua route API
│   ├── lib/              # db (SQLite node:sqlite), ai client, memory,
│   │                     # workspace, mode, plan, mood, notes, guardrail, diff
│   └── data/             # mentor.db (di-gitignore — data pribadi)
├── frontend/             # UI (Vite + React 19 + TypeScript + Tailwind CSS)
│   └── src/              # ChatRoom, Sidebar, Plan, Riwayat File, Settings, markdown
├── gemini-server/        # Gateway AI berbasis cookie akun Gemini (Folder di-gitignore)
└── docs/                 # Dokumentasi (arsitektur, API, rencana pengerasan)
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

**Penyegaran cookie otomatis (`gemini-server/fetch_cookies.sh`):** saat start, AI server mencoba menyegarkan cookie dari Chrome headless lewat `gemini-server/fetch_cookies.sh`. Hasil fetch itu **diverifikasi dulu** ke Gemini (RPC `GetUserStatus`): cookie hanya ditulis ke `.env` kalau statusnya `AVAILABLE`. Kalau sesi Google sedang kadaluwarsa, `.env` lama **dipertahankan** dan service memakai cookie yang sudah ada (tidak ditimpa cookie mati).

Kalau status pindah ke `UNAUTHENTICATED`, login interaktif sekali-sekali:

```bash
cd gemini-server && ./fetch_cookies.sh --visible --wait 300
```

Jendela Chrome profil khusus akan terbuka di halaman login Google; setelah login selesai, skrip menulis cookie yang sudah terverifikasi ke `.env` dan menutup Chrome. Server AI yang sedang berjalan otomatis membaca ulang `.env` dan init ulang tanpa perlu restart. Opsi `--force-unauth` tersedia untuk menulis cookie tanpa verifikasi (debugging).

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
- **Mastery berbasis bukti** — tiap topik punya skor penguasaan 0-100 plus bukti konkret (mis. "menjawab 3 soal tanpa bantuan"). Kenaikan mastery dibatasi (+20/giliran, terkunci <60 sampai ada bukti `kuat`), dan status `Dikuasai` hanya bisa dicapai setelah minimal 3 bukti kuat + skor ≥ 60 — jadi tidak ada topik yang magically "mastered".
- **Penguatan wajib (reinforcement)** — topik baru yang belum mengumpulkan 3 bukti kuat tetap di-"learning" dan muncul sebagai `REINFORCEMENT WAJIB` di prompt; Lode tidak boleh membuka materi baru sampai topik itu tuntas. Kalau pelajar bertanya/melaporkan error (bukan menjawab soal), Lode menjawab pertanyaannya dulu, bukan memaksa evaluasi.
- **Review berkala (spaced review)** — topik `mastered` yang sudah ≥ 3 hari tidak diulang akan diingatkan 1 soal recall singkat sebelum materi baru.
- **Riwayat percakapan** — semua chat tersimpan, bisa dibuka kapan saja. Mentornya tidak "ganti-ganti".
- **Roadmap-anchored mentoring** — Lode mengikuti roadmap belajar (mis. `ROADMAP.md`) dan tidak melompat ke materi lanjutan sebelum dasar selesai.
- **Rencana belajar terstruktur** — plan per percakapan tersimpan di database (fase, target, prasyarat, status), jadi urutan belajar tidak hanya mengandalkan file. Lode memakai plan ini sebagai sumber kebenaran dan bisa menandai item selesai sendiri lewat marker `@@plan`; status juga bisa diubah manual dari panel **Rencana Belajar**.
- **Mode belajar per giliran** — tiap pesan dijalankan dalam salah satu mode: `Konsep`, `Latihan`, `Proyek`, atau `Uji`. Pada mode **Auto** sistem memilih sendiri dari kunci kata pesan, topik yang buntu, dan mode yang dipakai Lode di giliran sebelumnya; Lode juga bisa mengusulkan perpindahan mode lewat marker `@@mode` (disembunyikan dari tampilan). Memilih mode selain Auto menguncinya sampai dikembalikan ke Auto, dan `Proyek` otomatis jatuh ke `Konsep` kalau percakapan belum punya folder workspace. Mode efektif tersimpan per pesan, jadi statistik dan histori tahu bagian mana yang teori, latihan, atau coding.
- **Gaya belajar** — menyesuaikan dengan preferensi (praktek, teori, visual, cerita).
- **Sesi chat terisolasi** — tiap percakapan memiliki UUID sendiri; konteks dibangun dari histori percakapan tersebut, tanpa session Gemini global. Gateway bersifat **stateless**: histori penuh dikirim ulang tiap giliran dan dipangkas sesuai budget (bukan memakai sesi server).
- **Folder workspace (AI agents)** — tiap percakapan bisa diarahkan ke folder lokal tempat kamu menulis jawaban/PR di code editor (mis. Zed). Lode membaca struktur dan isi file; penulisan file hanya aktif jika diizinkan lewat Settings.
- **Riwayat file & undo** — setiap file yang ditulis Lode lewat `@@write` menyimpan versi lamanya lebih dulu, jadi tidak ada penulisan yang satu arah. Panel **Riwayat File** menampilkan file mana yang berubah, berapa baris ditambah/diubah, diff-nya, dan tombol untuk mengembalikan isi file ke versi sebelumnya; undo pun bisa dibatalkan. Folder baru dan penulisan dengan isi identik tidak dicatat sebagai perubahan.
- **Ulangi** — kalau jawaban Lode ternyata terpotong atau kurang pas, tombol **Ulangi** pada jawaban terakhir memintanya menjawab ulang pertanyaan yang sama dari context yang sama (topik/memori/plan/workspace tetap); jawaban baru **menggantikan** yang lama di tempat tanpa membuat pesan tambahan, lalu topik & memori dihitung ulang dari jawaban baru itu.
- **Buatkan Catatan** — satu output mentor bisa disulap jadi berkas markdown `.md` rapi di folder workspace lewat tombol **Buatkan Catatan**; jika model lupa memakai blok `@@write`, sistem mencoba menyembuhkan dari fence kode lalu retry, sampai fallback nama file dari judul.
- **Ekspor / Impor / Fork** — konteks percakapan (pesan, topik, memori, rencana, berkas workspace) bisa di-ekspor sebagai JSON, diimpor balik, di-**fork** (salin lengkap), atau di-**fork-clean** (sesi baru yang tetap membawa progress/konteks tanpa pesan lama).
- **Pertahanan berlapis output AI** — sebelum disimpan, respons AI divalidasi (fence kode tidak seimbang, blok duplikat, marker bocor); yang rusak dirapikan dan diberi nota sistem. History yang dikirim ke AI dibersihkan dari pesan ganda beruntun & pesan lama yang korup. Kiriman pesan juga **idempoten** (`client_msg_id`) sehingga kirim ganda tidak membuat baris duplikat.
- **Breathing-room UI** — reveal bertahap pesan, heading gradien animasi, blok kode "bernapas" (glow lembut), shimmer loading.
- **Tema anime** yang menyenangkan ✨

## Konfigurasi

Semua setting disimpan di database (edit lewat UI **Profil & Server**):

| Field                       | Default                | Keterangan                        |
| --------------------------- | ---------------------- | --------------------------------- |
| Name / Bahasa / Level / Tujuan / Gaya belajar | — | Dipakai AI untuk menyesuaikan pengajaran |
| AI server URL               | `http://127.0.0.1:8003/v1` | gemini-server lokal project ini, OpenAI-compatible |
| API secret server           | (kosong)               | Opsional; hanya untuk host non-loopback |
| Model Gemini                | (kosong)               | Server memilih model flash yang tersedia di akun |
| Folder workspace default    | (kosong)               | Dipakai tiap percakapan baru (bisa diubah per-percakapan lewat tombol **Folder** di chat) |
| Kedalaman folder            | 7 level                | Seberapa dalam struktur pohon file dibaca |
| Jumlah file di struktur     | 350                    | Batas entri pohon file (proyek Unity sering butuh 300–500) |
| Otomatis baca teks          | 0 KB                   | Isi file kecil langsung dibaca tanpa menunggu marker `@@read` (boros token, naikkan pelan) |
| Lode boleh membuat file/folder | Nonaktif            | Menyalakan izin menulis `/@@write` di workspace |

> Catatan: DB berisi data pribadi & API secret opsional. File `backend/data/` dan `gemini-server/.env` di-gitignore, jangan pernah di-commit.

## Cara kerja folder workspace (agent)

1. Di halaman Chat, klik tombol **+ Folder** (atau **Folder** kalau sudah ter-set).
2. Pilih folder lewat **"Pilih folder dari pengelola file"** — dialog pemilih folder asli dari sistem (zenity/kdialog/yad) yang terbuka, sekali klik, tanpa ngetik path.
3. Klik **Pindai folder** untuk memastikan path valid, lalu **Simpan folder**.
4. Ketik seperti biasa, misal *"Cek file latihan.py aku, ada error"* — Lode otomatis membaca struktur folder, dan kalau perlu detail file akan membaca isinya lalu menjawab.

Secara default Lode hanya membaca. Jika switch **"Lode boleh membuat file/folder"** diaktifkan, blok `@@write` dari model dapat membuat file/folder di dalam workspace yang dipilih; file di luar workspace tetap ditolak.

Pengamanan: folder `node_modules`, `.git`, `dist`, `.venv`, `Library`, `Packages`, dll.; file biner & file besar (>100KB untuk tulisan, >400KB untuk baca) otomatis dilewati. Symlink dan path lintas workspace ditolak.

> Tombol "Pilih folder" memakai dialog sistem (butuh `zenity`/`kdialog`/`yad`; pasang via `sudo pacman -S zenity` bila belum ada). Kalau tidak ada, path tetap bisa diketik manual.

## Port

- 5173 — Vite dev server (frontend)
- 8787 — API server (backend)
- 8003 — gemini-server lokal project ini (cookie auth)

## Gemini server lokal

Untuk menjalankan service AI tanpa aplikasi:

```bash
npm run ai
```

Service ini stateless: histori dan sesi percakapan disimpan oleh backend Sensei Mentor, sedangkan cookie akun dibaca dari `gemini-server/.env`. Service ini juga:

- **Menyambung jawaban terpotong otomatis** — kalau Gemini berhenti di tengah kalimat/blok kode, gateway mengirim permintaan lanjutan (maksimal `GEMINI_MAX_CONTINUE_ROUNDS` giliran) supaya jawaban tamat wajar.
- **Mendeteksi tulis-ulang** — kalau Gemini menulis ulang jawaban di tengah streaming (atau menimpanya dengan penolakan "saya hanya model bahasa"), gateway mengirim kontrol `reset` ke klien supaya isi tidak tertempel ganda; penolakan yang menimpa jawaban berarti dipertahankan jawaban aslinya.
- **Memangkas budget prompt** — riwayat panjang dipangkas sesuai `GEMINI_MAX_HISTORY_TURNS` & `GEMINI_MAX_PROMPT_CHARS` sebelum dikirim ke Gemini.

File `.env` dan cache cookie `.cache/` sudah di-gitignore. Variabel yang didukung: `HOST`, `PORT`, `API_SECRET`, `GEMINI_MODEL`, `GEMINI_INIT_TIMEOUT`, `GEMINI_REQUEST_TIMEOUT`, `GEMINI_REFRESH_INTERVAL`, `GEMINI_RETRY_DELAY`, `GEMINI_MAX_HISTORY_TURNS`, `GEMINI_MAX_PROMPT_CHARS`, `GEMINI_COOKIE_PATH`, `CORS_ORIGINS`. Jika `HOST` diganti dari loopback, `API_SECRET` wajib diisi.

## Testing & kualitas

```bash
npm run typecheck          # tsc backend + frontend
npm --prefix backend test  # vitest (guardrail, idempotency)
npm run build              # build frontend production
```

Roadmap pengerasan lebih lanjut (test gateway, lint, CI) ada di `docs/HARDENING-PLAN.md`.

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

- **Backend**: Node.js (node:http murni), SQLite (node:sqlite), TypeScript, vitest
- **Frontend**: React 19, Vite, Tailwind CSS v4, TypeScript
- **AI server**: Python (FastAPI, uvicorn, gemini-webapi cookie auth)
- **Markdown**: react-markdown, remark-gfm, remark-math, rehype-katex, rehype-highlight