import { promises as fs, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "dist",
  "build",
  "target",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
  ".turbo",
  ".DS_Store",
  // Unity / C# / game dev
  "Library",
  "Temp",
  "Logs",
  "Obj",
  "obj",
  "Builds",
  "bin",
  ".gradle",
  ".vs",
  ".um",
  "Packages",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif",
  ".mp4", ".mp3", ".wav", ".ogg", ".flac",
  ".zip", ".tar", ".gz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf",
  ".pdf", ".exe", ".dll", ".so", ".dylib",
  ".pyc", ".class", ".jar",
  ".db", ".sqlite", ".sqlite3", ".lock",
  ".min.js", ".map",
]);

// Hanya filter file duplikasi mesin atau OS yang mengotori daftar (mis. Unity .meta)
const TREE_IGNORE_EXT = new Set([
  ".meta",
]);

const TREE_IGNORE_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

export interface WorkspaceEntry {
  rel: string;
  name: string;
  isDir: boolean;
  size: number;
}

export interface ScanResult {
  root: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
  fileCount: number;
}

export async function workspaceInfo(
  dir: string,
  opts: { maxDepth?: number; maxEntries?: number } = {},
): Promise<{ root: string; fileCount: number; skippedDirs: number }> {
  const maxDepth = opts.maxDepth ?? 4;
  const maxCount = opts.maxEntries ?? 9999;
  const root = await fs.realpath(dir);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Bukan folder");

  let fileCount = 0;
  let skippedDirs = 0;
  async function count(rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    if (fileCount >= maxCount) return;
    const abs = rel ? path.join(root, rel) : root;
    let names: string[];
    try {
      names = await fs.readdir(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git") continue;
      const childAbs = path.join(abs, name);
      const st = await fs.stat(childAbs).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) {
          skippedDirs++;
          continue;
        }
        await count(rel ? `${rel}/${name}` : name, depth + 1);
      } else {
        const ext = path.extname(name).toLowerCase();
        if (TREE_IGNORE_EXT.has(ext) || TREE_IGNORE_FILES.has(name)) continue;
        fileCount++;
      }
    }
  }
  await count("", 0);
  return { root, fileCount, skippedDirs };
}

export async function scanWorkspace(
  dir: string,
  opts: { maxEntries?: number; maxDepth?: number } = {},
): Promise<ScanResult> {
  const maxEntries = opts.maxEntries ?? 200;
  const maxDepth = opts.maxDepth ?? 3;
  const root = await fs.realpath(dir);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error("Bukan folder");

  const entries: WorkspaceEntry[] = [];
  let truncated = false;
  let fileCount = 0;

  async function walk(rel: string, depth: number): Promise<void> {
    if (entries.length >= maxEntries || depth > maxDepth) {
      truncated = truncated || entries.length >= maxEntries;
      return;
    }
    const abs = rel ? path.join(root, rel) : root;
    let names: string[];
    try {
      names = await fs.readdir(abs);
    } catch {
      return;
    }

    const dirs: string[] = [];
    const files: string[] = [];
    for (const name of names) {
      const childAbs = path.join(abs, name);
      const st = await fs.stat(childAbs).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        dirs.push(name);
      } else {
        const ext = path.extname(name).toLowerCase();
        if (TREE_IGNORE_EXT.has(ext) || TREE_IGNORE_FILES.has(name)) continue;
        files.push(name);
      }
    }
    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.localeCompare(b));

    for (const name of dirs) {
      const childRel = rel ? `${rel}/${name}` : name;
      entries.push({ rel: childRel, name, isDir: true, size: 0 });
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      await walk(childRel, depth + 1);
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
    }
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }
    for (const name of files) {
      const childRel = rel ? `${rel}/${name}` : name;
      const st = await fs.stat(path.join(abs, name)).catch(() => null);
      entries.push({ rel: childRel, name, isDir: false, size: st?.size ?? 0 });
      fileCount++;
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
    }
  }

  await walk("", 0);
  return { root, entries, truncated, fileCount };
}

export async function readWorkspaceFile(
  dir: string,
  rel: string,
  cap = 20000,
): Promise<{ content: string; truncated: boolean } | null> {
  if (!rel) return null;
  const root = await fs.realpath(dir);
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) return null;

  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + path.sep)) return null;

  const st = await fs.stat(real).catch(() => null);
  if (!st || !st.isFile()) return null;
  if (st.size > 400_000) return null;
  if (BINARY_EXT.has(path.extname(real).toLowerCase())) return null;

  const buf = await fs.readFile(real);
  if (buf.includes(0)) return null;

  const text = buf.toString("utf8");
  const truncated = text.length > cap;
  return { content: truncated ? text.slice(0, cap) : text, truncated };
}

const AUTO_READ = [
  "Packages/manifest.json",
  "ProjectSettings/ProjectVersion.txt",
  "package.json",
  "README.md",
  "readme.md",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
];

export interface WorkspaceCtxOptions {
  maxDepth?: number;
  maxEntries?: number;
  autoDumpKB?: number;
}

export async function buildWorkspaceContext(
  dir: string,
  opts: WorkspaceCtxOptions = {},
): Promise<string> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxEntries = opts.maxEntries ?? 150;
  const autoDumpKB = opts.autoDumpKB ?? 0;

  let scan: ScanResult;
  try {
    scan = await scanWorkspace(dir, { maxEntries, maxDepth });
  } catch {
    return "";
  }

  const lines: string[] = [
    "=== WORKSPACE FOLDER (pelajar menulis jawaban/PR di sini pakai code editor) ===",
    `Lokasi: ${scan.root}`,
    `Struktur file (${scan.fileCount} file terdeteksi${scan.truncated ? ", sebagian ditampilkan" : ""}):`,
  ];
  for (const e of scan.entries) {
    const depth = e.rel.split("/").length - 1;
    const label = e.isDir ? `[DIR] ${e.name}/` : `[FILE] ${e.name}`;
    lines.push(`${"  ".repeat(depth)}${label}`);
  }

  const manifest = await readWorkspaceFile(dir, AUTO_READ[0], 4000).catch(
    () => null,
  );
  let manifestShown = false;
  if (manifest) {
    lines.push("", `[ISI ${AUTO_READ[0]} — dibaca otomatis]`, "```", manifest.content, "```");
    manifestShown = true;
  }
  for (const cand of AUTO_READ.slice(1)) {
    if (manifestShown && cand === "package.json") continue;
    const f = await readWorkspaceFile(dir, cand, 4000);
    if (f) {
      lines.push("", `[ISI ${cand} — dibaca otomatis]`, "```", f.content, "```");
      if (cand !== "package.json") break;
    }
  }

  if (autoDumpKB > 0) {
    const tiny = await gatherTinyFiles(dir, autoDumpKB, { maxEntries, maxDepth });
    if (tiny.truncated) {
      lines.push(
        "",
        `[Folder cukup besar — isi file teks DIBAWAH AUTODUMP (${autoDumpKB} KB), tidak ikut dibaca otomatis. Gunakan @@read untuk file tertentu.]`,
      );
    } else for (const f of tiny.files) {
      lines.push("", `[ISI ${f.rel} (otomatis, bobot kecil)]`, "```", f.content, "```");
    }
  }

  lines.push(
    "",
    "Kalau kamu perlu melihat isi file lain, tulis baris marker di PALING AWAL jawabanmu (baris pertama, sebelum konten lain):",
    'FORMAT: @@read("path/relatif/dari/folder")',
    "Sistem akan mengirim isi file itu, lalu kamu menjawab di giliran berikutnya.",
  );

  return lines.join("\n");
}

export async function gatherTinyFiles(
  dir: string,
  maxKB: number,
  opts: { maxEntries?: number; maxDepth?: number } = {},
): Promise<{ files: { rel: string; content: string }[]; truncated: boolean }> {
  let scan: ScanResult;
  try {
    scan = await scanWorkspace(dir, {
      maxEntries: opts.maxEntries ?? 400,
      maxDepth: opts.maxDepth ?? 3,
    });
  } catch {
    return { files: [], truncated: true };
  }
  if (scan.truncated) return { files: [], truncated: true };

  const cap = maxKB * 1024;
  let total = 0;
  const files: { rel: string; content: string }[] = [];
  for (const e of scan.entries) {
    if (e.isDir) continue;
    const f = await readWorkspaceFile(dir, e.rel, 4000);
    if (!f) continue;
    const cost = f.content.length + 80;
    if (total + cost > cap) return { files, truncated: false };
    total += cost;
    files.push({ rel: e.rel, content: f.content });
  }
  return { files, truncated: false };
}

// ---------- Sensei MEMBUAT file / folder (agent write) ----------

export interface AgentWriteOp {
  rel: string;
  content: string;
}

export interface WriteResult {
  rel: string;
  created: boolean;
  bytes: number;
  error?: string;
}

const WRITE_BLOCK_RE = /@@write\("([^"]+)"\)\r?\n?([\s\S]*?)\r?\n@@end/g;
const MKDIR_TOKEN_RE = /@@mkdir\("([^"]+)"\)/g;

export function parseAgentBlocks(text: string): {
  clean: string;
  writes: AgentWriteOp[];
  mkdirs: string[];
} {
  const writes: AgentWriteOp[] = [];
  const mkdirs: string[] = [];
  let clean = text;
  clean = clean.replace(WRITE_BLOCK_RE, (_, rel, content) => {
    writes.push({ rel: rel.trim(), content: content.trim() });
    return "";
  });
  clean = clean.replace(MKDIR_TOKEN_RE, (_m, rel) => {
    mkdirs.push(rel.trim());
    return "";
  });
  return { clean, writes, mkdirs };
}

const WRITE_MAX = 100_000;

function isInside(rootReal: string, target: string): boolean {
  const t = path.resolve(target);
  return t === rootReal || t.startsWith(rootReal + path.sep);
}

export async function applyWorkspaceWrites(
  dir: string,
  ops: { writes: AgentWriteOp[]; mkdirs: string[] },
): Promise<WriteResult[]> {
  const results: WriteResult[] = [];
  let root: string;
  try {
    root = await fs.realpath(dir);
  } catch {
    return [{ rel: "<root>", created: false, bytes: 0, error: "Folder workspace tidak bisa diakses" }];
  }

  for (const mk of ops.mkdirs) {
    const target = path.resolve(root, mk);
    if (!isInside(root, target)) {
      results.push({ rel: mk, created: false, bytes: 0, error: "di luar workspace" });
      continue;
    }
    try {
      await fs.mkdir(target, { recursive: true });
      results.push({ rel: `${mk}/`, created: true, bytes: 0 });
    } catch (err) {
      results.push({
        rel: mk,
        created: false,
        bytes: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const w of ops.writes) {
    const target = path.resolve(root, w.rel);
    if (!isInside(root, target)) {
      results.push({ rel: w.rel, created: false, bytes: 0, error: "di luar workspace" });
      continue;
    }
    if (BINARY_EXT.has(path.extname(w.rel).toLowerCase())) {
      results.push({ rel: w.rel, created: false, bytes: 0, error: "ekstensi file dilarang" });
      continue;
    }
    if (w.content.length > WRITE_MAX) {
      results.push({ rel: w.rel, created: false, bytes: 0, error: "isi file terlalu besar (>100KB)" });
      continue;
    }
    const created = !existsSync(target);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const realDir = await fs.realpath(path.dirname(target));
      if (!isInside(root, realDir)) {
        results.push({ rel: w.rel, created: false, bytes: 0, error: "di luar workspace" });
        continue;
      }
      await fs.writeFile(target, w.content, "utf8");
      results.push({ rel: w.rel, created, bytes: w.content.length });
    } catch (err) {
      results.push({
        rel: w.rel,
        created: false,
        bytes: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

export async function gatherFileDump(dir: string, rels: string[]): Promise<string> {
  const parts: string[] = [];
  for (const rel of rels.slice(0, 5)) {
    const f = await readWorkspaceFile(dir, rel, 20000);
    if (f) {
      parts.push(
        `\n[ISI FILE: ${rel}]${f.truncated ? " (dipotong)" : ""}\n\`\`\`\n${f.content}\n\`\`\``,
      );
    } else {
      parts.push(`\n[FILE TIDAK DITEMUKAN / TIDAK BISA DIBACA: ${rel}]`);
    }
  }
  return parts.join("\n");
}

export interface FolderPickResult {
  ok: boolean;
  selected: string | null;
  tool: string;
  error?: string;
}

const PICK_TOOLS = ["zenity", "kdialog", "yad"] as const;

function findTool(name: string): string | null {
  const seen = new Set<string>();
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const d = dir.trim();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    const p = path.join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function pickerArgs(tool: string, dir: string): string[] {
  if (tool === "zenity") {
    return [
      "--file-selection",
      "--directory",
      "--title=Pilih Folder Workspace (Sensei)",
      ...(dir ? [`--filename=${dir}${dir.endsWith("/") ? "" : "/"}`] : []),
    ];
  }
  if (tool === "kdialog") {
    return ["--getexistingdirectory", dir || os.homedir(), "--title", "Pilih Folder Workspace (Sensei)"];
  }
  // yad fallback (mendukung juga GTK dialog)
  return [
    "--file",
    "--directory",
    "--title=Pilih Folder Workspace (Sensei)",
    ...(dir ? [`--filename=${dir}${dir.endsWith("/") ? "" : "/"}`] : []),
  ];
}

export async function pickFolder(current?: string): Promise<FolderPickResult> {
  let tool: string | null = null;
  let toolPath: string | null = null;
  for (const t of PICK_TOOLS) {
    const p = findTool(t);
    if (p) {
      tool = t;
      toolPath = p;
      break;
    }
  }
  if (!tool || !toolPath) {
    return {
      ok: false,
      selected: null,
      tool: "",
      error: 'Dialog pemilih folder tidak tersedia. Pasang zenity dulu, mis. `sudo pacman -S zenity` (Arch) atau `sudo apt install zenity` (Debian/Ubuntu).',
    };
  }

  const startDir =
    current && existsSync(current)
      ? path.resolve(current)
      : os.homedir() || "";

  return new Promise((resolve) => {
    execFile(
      toolPath,
      pickerArgs(tool, startDir),
      { encoding: "utf8", timeout: 120000, windowsHide: true },
      (err, stdout) => {
        const out = (stdout ?? "").trim();
        resolve({ ok: true, selected: out || null, tool });
        void err;
      },
    );
  });
}