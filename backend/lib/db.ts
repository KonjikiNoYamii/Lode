import { DatabaseSync } from "node:sqlite";
import { mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Role = "user" | "assistant";

export interface Profile {
  id: number;
  name: string;
  language: string;
  skill_level: string;
  goals: string;
  learning_style: string;
  mascot: string;
  workspace: string;
  ws_max_depth: number;
  ws_max_files: number;
  ws_auto_kb: number;
  ws_allow_write: number;
  ai_base_url: string;
  ai_api_key: string;
  ai_model: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: number;
  title: string;
  folder: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: Role;
  content: string;
  mood: string;
  created_at: string;
}

export interface Topic {
  id: number;
  name: string;
  status: "mastered" | "learning" | "stuck" | "todo";
  notes: string;
  conversation_id: number;
  updated_at: string;
}

export interface Memory {
  id: number;
  type: string;
  content: string;
  conversation_id: number;
  created_at: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "mentor.db"));

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Acolyte',
  language TEXT NOT NULL DEFAULT 'id',
  skill_level TEXT NOT NULL DEFAULT 'pemula',
  goals TEXT NOT NULL DEFAULT '',
  learning_style TEXT NOT NULL DEFAULT 'praktek',
  mascot TEXT NOT NULL DEFAULT 'Sensei',
  workspace TEXT NOT NULL DEFAULT '',
  ai_base_url TEXT NOT NULL DEFAULT 'http://localhost:8000/v1',
  ai_api_key TEXT NOT NULL DEFAULT '',
  ai_model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  mood TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'insight',
  content TEXT NOT NULL,
  conversation_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'learning',
  notes TEXT NOT NULL DEFAULT '',
  conversation_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

db.prepare("INSERT OR IGNORE INTO profile (id) VALUES (1)").run();

function osUsername(): string {
  try {
    const name = os.userInfo().username;
    if (name && !name.includes("\\")) return name;
  } catch {
    // proses tanpa TTY — lanjut ke fallback
  }
  return process.env.USER || process.env.LOGNAME || process.env.USERNAME || "Siswa";
}

db.prepare(
  `UPDATE profile SET name = COALESCE(NULLIF(name, ''), ?) WHERE id = 1`,
).run(osUsername());

function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function migrateTopics(): void {
  const cols = db
    .prepare("PRAGMA table_info(topics)")
    .all() as unknown as { name: string }[];
  const hasConv = cols.some((c) => c.name === "conversation_id");
  if (!hasConv) {
    // tabel lama: UNIQUE global per nama → dibangun ulang jadi per-percakapan
    db.exec(
      `CREATE TABLE topics_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'learning',
        notes TEXT NOT NULL DEFAULT '',
        conversation_id INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    );
    db.exec(
      `INSERT INTO topics_new (id, name, status, notes, conversation_id, updated_at)
       SELECT id, name, status, notes, 0, updated_at FROM topics`,
    );
    db.exec("DROP TABLE topics");
    db.exec("ALTER TABLE topics_new RENAME TO topics");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_topics_conv_name ON topics(conversation_id, name)",
  );
}

migrateTopics();

ensureColumn(
  "memories",
  "conversation_id",
  "conversation_id INTEGER NOT NULL DEFAULT 0",
);
db.exec("CREATE INDEX IF NOT EXISTS idx_memories_conv ON memories(conversation_id)");

ensureColumn("conversations", "folder", "folder TEXT NOT NULL DEFAULT ''");
ensureColumn("messages", "mood", "mood TEXT NOT NULL DEFAULT ''");
ensureColumn("profile", "workspace", "workspace TEXT NOT NULL DEFAULT ''");
ensureColumn("profile", "ws_max_depth", "ws_max_depth INTEGER NOT NULL DEFAULT 3");
ensureColumn("profile", "ws_max_files", "ws_max_files INTEGER NOT NULL DEFAULT 150");
ensureColumn("profile", "ws_auto_kb", "ws_auto_kb INTEGER NOT NULL DEFAULT 0");
ensureColumn(
  "profile",
  "ws_allow_write",
  "ws_allow_write INTEGER NOT NULL DEFAULT 1",
);

const ENV_BASE_URL = process.env.GEMINI_SERVER_BASE_URL;

function rowToProfile(row: unknown): Profile {
  const r = row as Profile;
  if (ENV_BASE_URL && r.ai_base_url === "http://localhost:8000/v1") {
    return { ...r, ai_base_url: ENV_BASE_URL };
  }
  return r;
}

export function getProfile(): Profile {
  const row = db.prepare("SELECT * FROM profile WHERE id = 1").get();
  return rowToProfile(row);
}

export function updateProfile(patch: Partial<Profile>): Profile {
  const allowed: (keyof Profile)[] = [
    "name",
    "language",
    "skill_level",
    "goals",
    "learning_style",
    "mascot",
    "workspace",
    "ws_max_depth",
    "ws_max_files",
    "ws_auto_kb",
    "ws_allow_write",
    "ai_base_url",
    "ai_api_key",
    "ai_model",
  ];
  const keys = allowed.filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return getProfile();
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => String(patch[k] ?? ""));
  db.prepare(
    `UPDATE profile SET ${sets}, updated_at = datetime('now') WHERE id = 1`,
  ).run(...values);
  return getProfile();
}

export function listConversations(): Conversation[] {
  return db
    .prepare(
      `SELECT c.*, COUNT(m.id) AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       GROUP BY c.id
       ORDER BY c.updated_at DESC`,
    )
    .all() as unknown as Conversation[];
}

export function createConversation(title: string, folder = ""): number {
  const result = db
    .prepare("INSERT INTO conversations (title, folder) VALUES (?, ?)")
    .run(title, folder);
  return Number(result.lastInsertRowid);
}

export function getConversation(id: number): Conversation | null {
  const row = db
    .prepare(
      `SELECT c.*, COUNT(m.id) AS message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.id = ?
       GROUP BY c.id`,
    )
    .get(id);
  return (row as unknown as Conversation | undefined) ?? null;
}

export function patchConversation(
  id: number,
  patch: { title?: string; folder?: string },
): void {
  const keys = ["title", "folder"].filter(
    (k) => patch[k as keyof typeof patch] !== undefined,
  );
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => String(patch[k as keyof typeof patch] ?? ""));
  db.prepare(
    `UPDATE conversations SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...values, String(id));
}

export function deleteConversation(id: number): void {
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM topics WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM memories WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  walCheckpoint();
}

export interface MaintenanceResult {
  freedMessages: number;
  freedTopics: number;
  freedMemories: number;
  sizeBefore: number;
  sizeAfter: number;
  walBefore: number;
  walAfter: number;
}

export function dbFilePath(): string {
  return path.join(DATA_DIR, "mentor.db");
}

function walCheckpoint(): void {
  try {
    db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
  } catch {
    // checkpoint gagal — tidak fatal
  }
}

export function runMaintenance(): MaintenanceResult {
  const mainPath = dbFilePath();
  const walPath = `${mainPath}-wal`;
  const shmPath = `${mainPath}-shm`;
  const readBytes = (f: string) => {
    try {
      return statSync(f).size;
    } catch {
      return 0;
    }
  };

  const sizeBefore = readBytes(mainPath) + readBytes(walPath) + readBytes(shmPath);
  const walBefore = readBytes(walPath);

  const freedMessages = Number(
    db
      .prepare(
        "DELETE FROM messages WHERE conversation_id NOT IN (SELECT id FROM conversations)",
      )
      .run().changes,
  );

  const freedTopics = Number(
    db
      .prepare(
        "DELETE FROM topics WHERE conversation_id NOT IN (SELECT id FROM conversations)",
      )
      .run().changes,
  );

  const freedMemories = Number(
    db
      .prepare(
        "DELETE FROM memories WHERE conversation_id NOT IN (SELECT id FROM conversations)",
      )
      .run().changes,
  );

  db.prepare("PRAGMA optimize").all();
  walCheckpoint();

  const sizeAfter = readBytes(mainPath) + readBytes(walPath) + readBytes(shmPath);
  const walAfter = readBytes(walPath);
  return { freedMessages, freedTopics, freedMemories, sizeBefore, sizeAfter, walBefore, walAfter };
}

function touchConversation(id: number): void {
  db.prepare(
    "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
  ).run(id);
}

export function addMessage(
  conversationId: number,
  role: Role,
  content: string,
  mood = "",
): void {
  db.prepare(
    "INSERT INTO messages (conversation_id, role, content, mood) VALUES (?, ?, ?, ?)",
  ).run(conversationId, role, content, mood);
  touchConversation(conversationId);
}

export function listMessages(conversationId: number): Message[] {
  return db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC",
    )
    .all(conversationId) as unknown as Message[];
}

export function listTopics(): Topic[] {
  return db
    .prepare(
      `SELECT * FROM topics
       ORDER BY CASE status
         WHEN 'mastered' THEN 0
         WHEN 'todo' THEN 1
         WHEN 'learning' THEN 2
         WHEN 'stuck' THEN 3
         ELSE 4 END DESC,
         updated_at DESC`,
    )
    .all() as unknown as Topic[];
}

export function listTopicsByConversation(conversationId: number): Topic[] {
  return db
    .prepare(
      `SELECT * FROM topics
       WHERE conversation_id = ?
       ORDER BY CASE status
         WHEN 'mastered' THEN 0
         WHEN 'todo' THEN 1
         WHEN 'learning' THEN 2
         WHEN 'stuck' THEN 3
         ELSE 4 END DESC,
         updated_at DESC`,
    )
    .all(conversationId) as unknown as Topic[];
}

const TOPIC_STATUSES = new Set(["mastered", "learning", "stuck", "todo"]);

export function upsertTopic(
  name: string,
  status: string,
  notes: string = "",
  conversationId = 0,
): number {
  const cleanName = name.trim().slice(0, 120);
  if (!cleanName) return 0;
  const cleanStatus = TOPIC_STATUSES.has(status) ? status : "learning";
  const existing = db
    .prepare(
      "SELECT id FROM topics WHERE name = ? COLLATE NOCASE AND conversation_id = ?",
    )
    .get(cleanName, conversationId) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE topics SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(cleanStatus, notes.slice(0, 300), existing.id);
    return existing.id;
  }
  const result = db
    .prepare(
      "INSERT INTO topics (name, status, notes, conversation_id) VALUES (?, ?, ?, ?)",
    )
    .run(cleanName, cleanStatus, notes.slice(0, 300), conversationId);
  return Number(result.lastInsertRowid);
}

export function patchTopic(
  id: number,
  patch: { name?: string; status?: string; notes?: string },
): void {
  const allowed = ["name", "status", "notes"];
  const keys = allowed.filter((k) => patch[k as keyof typeof patch] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => String(patch[k as keyof typeof patch]));
  db.prepare(
    `UPDATE topics SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...values, String(id));
}

export function deleteTopic(id: number): void {
  db.prepare("DELETE FROM topics WHERE id = ?").run(id);
}

export function listMemories(): Memory[] {
  return db
    .prepare("SELECT * FROM memories ORDER BY id DESC LIMIT 100")
    .all() as unknown as Memory[];
}

export function listMemoriesByConversation(conversationId: number): Memory[] {
  return db
    .prepare(
      "SELECT * FROM memories WHERE conversation_id = ? ORDER BY id DESC LIMIT 100",
    )
    .all(conversationId) as unknown as Memory[];
}

export function addMemory(
  type: string,
  content: string,
  conversationId = 0,
): void {
  const clean = content.trim().slice(0, 500);
  if (!clean) return;
  const dup = db
    .prepare(
      "SELECT id FROM memories WHERE conversation_id = ? AND content = ? COLLATE NOCASE",
    )
    .get(conversationId, clean) as { id: number } | undefined;
  if (dup) return;
  db.prepare(
    "INSERT INTO memories (type, content, conversation_id) VALUES (?, ?, ?)",
  ).run(type.slice(0, 40) || "insight", clean, conversationId);
}

export function deleteMemory(id: number): void {
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}