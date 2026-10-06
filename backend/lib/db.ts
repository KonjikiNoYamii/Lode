const MASTERY_MAX_GAIN_PER_TURN = 20;
const MASTERY_MASTERED_MIN = 60;
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
  mode: string;
  ai_mode: string;
  ai_thread: string;
  ai_session: string;
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
  mode: string;
  created_at: string;
}

export interface Topic {
  id: number;
  name: string;
  status: "mastered" | "learning" | "stuck" | "todo";
  notes: string;
  mastery: number;
  confidence: number;
  evidence: string;
  last_reviewed_at: string;
  conversation_id: number;
  updated_at: string;
}

export type PlanStatus = "todo" | "learning" | "done" | "stuck";

export interface PlanItem {
  id: number;
  conversation_id: number;
  phase: number;
  title: string;
  objective: string;
  prerequisites: string;
  status: PlanStatus;
  order_index: number;
  updated_at: string;
}

export interface Memory {
  id: number;
  type: string;
  content: string;
  conversation_id: number;
  created_at: string;
}

export interface FileRevision {
  id: number;
  conversation_id: number;
  rel: string;
  content: string;
  existed: number;
  bytes: number;
  added: number;
  removed: number;
  source: string;
  created_at: string;
}

const DATA_DIR = path.resolve(process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data"));
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
  mascot TEXT NOT NULL DEFAULT 'Lode',
  workspace TEXT NOT NULL DEFAULT '',
  ai_base_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:8003/v1',
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

CREATE TABLE IF NOT EXISTS workspace_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL DEFAULT 0,
  rel TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_conv_rel ON workspace_files(conversation_id, rel);

CREATE TABLE IF NOT EXISTS plan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL DEFAULT 0,
  phase INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  prerequisites TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  order_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_conv ON plan_items(conversation_id, phase, order_index);

CREATE TABLE IF NOT EXISTS file_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL DEFAULT 0,
  rel TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  existed INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'lode',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revisions_conv ON file_revisions(conversation_id, id);
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
ensureColumn("conversations", "mode", "mode TEXT NOT NULL DEFAULT 'auto'");
ensureColumn("conversations", "ai_mode", "ai_mode TEXT NOT NULL DEFAULT ''");
ensureColumn("messages", "mode", "mode TEXT NOT NULL DEFAULT ''");
ensureColumn(
  "conversations",
  "ai_thread",
  "ai_thread TEXT NOT NULL DEFAULT ''",
);
ensureColumn(
  "conversations",
  "ai_session",
  "ai_session TEXT NOT NULL DEFAULT ''",
);
ensureColumn("messages", "mood", "mood TEXT NOT NULL DEFAULT ''");
ensureColumn("profile", "workspace", "workspace TEXT NOT NULL DEFAULT ''");
ensureColumn("topics", "mastery", "mastery INTEGER NOT NULL DEFAULT 0");
ensureColumn("topics", "confidence", "confidence INTEGER NOT NULL DEFAULT 0");
ensureColumn("topics", "evidence", "evidence TEXT NOT NULL DEFAULT ''");
ensureColumn("topics", "last_reviewed_at", "last_reviewed_at TEXT NOT NULL DEFAULT ''");

// Fitur kartu review (spaced repetition) sudah dihapus. Buang sisa datanya
// supaya tidak ada tabel yatim yang masih ikut ditulis atau di-backup.
function dropLegacyReviewCards(): void {
  db.exec("DROP TABLE IF EXISTS review_cards");
  db.exec("DROP TABLE IF EXISTS app_flags");
  // Mode "ingat" ikut dihapus; kembalikan percakapan lama ke mode otomatis.
  db.prepare("UPDATE conversations SET ai_mode = '' WHERE ai_mode = 'ingat'").run();
  db.prepare("UPDATE messages SET mode = '' WHERE mode = 'ingat'").run();
}

dropLegacyReviewCards();
ensureColumn("profile", "ws_max_depth", "ws_max_depth INTEGER NOT NULL DEFAULT 7");
ensureColumn("profile", "ws_max_files", "ws_max_files INTEGER NOT NULL DEFAULT 350");
ensureColumn("profile", "ws_auto_kb", "ws_auto_kb INTEGER NOT NULL DEFAULT 0");
ensureColumn(
  "profile",
  "ws_allow_write",
  "ws_allow_write INTEGER NOT NULL DEFAULT 0",
);

db.prepare("UPDATE profile SET ws_max_depth = 7 WHERE id = 1 AND ws_max_depth = 3").run();
db.prepare("UPDATE profile SET ws_max_files = 350 WHERE id = 1 AND ws_max_files = 150").run();

const LEGACY_AI_BASE_URL = "http://localhost:8002/v1";
const OVERRIDE_AI_BASE_URL = process.env.GEMINI_SERVER_BASE_URL?.trim();
const DEFAULT_AI_BASE_URL = OVERRIDE_AI_BASE_URL || "http://127.0.0.1:8003/v1";
const LEGACY_AI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"];
const DEFAULT_AI_MODEL = process.env.GEMINI_MODEL?.trim() || "";

db.prepare(
  "UPDATE profile SET ai_base_url = ?, ai_api_key = '' WHERE id = 1 AND ai_base_url = ?",
).run(DEFAULT_AI_BASE_URL, LEGACY_AI_BASE_URL);
db.prepare(
  "UPDATE profile SET ai_model = ? WHERE id = 1 AND TRIM(ai_model) = ''",
).run(DEFAULT_AI_MODEL);
for (const legacyModel of LEGACY_AI_MODELS) {
  db.prepare("UPDATE profile SET ai_model = ? WHERE id = 1 AND ai_model = ?").run(
    DEFAULT_AI_MODEL,
    legacyModel,
  );
}

function rowToProfile(row: unknown): Profile {
  const r = row as Profile;
  if (OVERRIDE_AI_BASE_URL && r.ai_base_url === "http://127.0.0.1:8003/v1") {
    return { ...r, ai_base_url: DEFAULT_AI_BASE_URL };
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

export function createConversation(
  title: string,
  folder = "",
  aiSession = "",
): number {
  const result = db
    .prepare(
      "INSERT INTO conversations (title, folder, ai_session) VALUES (?, ?, ?)",
    )
    .run(title, folder, aiSession);
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
  patch: {
    title?: string;
    folder?: string;
    mode?: string;
    ai_mode?: string;
    ai_thread?: string;
    ai_session?: string;
  },
): void {
  const keys = ["title", "folder", "mode", "ai_mode", "ai_thread", "ai_session"].filter(
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
  db.prepare("DELETE FROM workspace_files WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM plan_items WHERE conversation_id = ?").run(id);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  walCheckpoint();
}

export interface MaintenanceResult {
  freedMessages: number;
  freedTopics: number;
  freedMemories: number;
  freedPlan: number;
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

  db.prepare(
    "DELETE FROM workspace_files WHERE conversation_id NOT IN (SELECT id FROM conversations)",
  ).run();

  const freedPlan = Number(
    db
      .prepare(
        "DELETE FROM plan_items WHERE conversation_id NOT IN (SELECT id FROM conversations)",
      )
      .run().changes,
  );

  db.prepare("PRAGMA optimize").all();
  walCheckpoint();

  const sizeAfter = readBytes(mainPath) + readBytes(walPath) + readBytes(shmPath);
  const walAfter = readBytes(walPath);
  return { freedMessages, freedTopics, freedMemories, freedPlan, sizeBefore, sizeAfter, walBefore, walAfter };
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
  mode = "",
): void {
  db.prepare(
    "INSERT INTO messages (conversation_id, role, content, mood, mode) VALUES (?, ?, ?, ?, ?)",
  ).run(conversationId, role, content, mood, mode);
  touchConversation(conversationId);
}

export function countMessages(conversationId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?")
    .get(conversationId) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function listMessages(
  conversationId: number,
  limit?: number,
  beforeId?: number,
): Message[] {
  if (limit && limit > 0) {
    if (beforeId && beforeId > 0) {
      const rows = db
        .prepare(
          "SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
        )
        .all(conversationId, beforeId, limit) as unknown as Message[];
      return rows.reverse();
    }
    const rows = db
      .prepare(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(conversationId, limit) as unknown as Message[];
    return rows.reverse();
  }
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

export interface ConversationExportPayload {
  format: "lode-conversation";
  version: 1;
  exported_at: string;
  conversation: Omit<Conversation, "id" | "message_count"> & { folder?: string };
  messages: Array<
    Pick<Message, "role" | "content" | "mood" | "mode"> & { created_at?: string }
  >;
  topics: Array<
    Pick<Topic, "name" | "status" | "notes" | "mastery" | "confidence" | "evidence"> & {
      updated_at?: string;
      last_reviewed_at?: string;
    }
  >;
  memories: Array<Pick<Memory, "type" | "content"> & { created_at?: string }>;
  plan_items: Array<
    Pick<PlanItem, "phase" | "title" | "objective" | "prerequisites" | "status" | "order_index"> & {
      updated_at?: string;
    }
  >;
  workspace_files: Array<{ rel: string; content: string | null; updated_at?: string }>;
}

export function exportConversationContext(id: number): ConversationExportPayload | null {
  const conv = getConversation(id);
  if (!conv) return null;
  const base = db.prepare("SELECT title, folder, mode, ai_mode, created_at, updated_at FROM conversations WHERE id = ?").get(id) as {
    title: string;
    folder: string;
    mode: string;
    ai_mode: string;
    created_at: string;
    updated_at: string;
  };
  const messages = db
    .prepare("SELECT role, content, mood, mode, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC")
    .all(id) as Array<Pick<Message, "role" | "content" | "mood" | "mode"> & { created_at: string }>;
  const topics = db
    .prepare("SELECT name, status, notes, mastery, confidence, evidence, updated_at, last_reviewed_at FROM topics WHERE conversation_id = ? ORDER BY id ASC")
    .all(id) as Array<Pick<Topic, "name" | "status" | "notes" | "mastery" | "confidence" | "evidence"> & { updated_at: string; last_reviewed_at: string }>;
  const memories = db
    .prepare("SELECT type, content, created_at FROM memories WHERE conversation_id = ? ORDER BY id ASC")
    .all(id) as Array<Pick<Memory, "type" | "content"> & { created_at: string }>;
  const plan_items = db
    .prepare("SELECT phase, title, objective, prerequisites, status, order_index, updated_at FROM plan_items WHERE conversation_id = ? ORDER BY phase ASC, order_index ASC, id ASC")
    .all(id) as Array<Pick<PlanItem, "phase" | "title" | "objective" | "prerequisites" | "status" | "order_index"> & { updated_at: string }>;
  const workspace_files = db
    .prepare("SELECT rel, updated_at FROM workspace_files WHERE conversation_id = ? ORDER BY id ASC")
    .all(id) as Array<{ rel: string; updated_at: string }>;
  return {
    format: "lode-conversation",
    version: 1,
    exported_at: new Date().toISOString(),
    conversation: {
      title: base.title,
      folder: base.folder,
      mode: base.mode as any,
      ai_mode: base.ai_mode,
      created_at: base.created_at,
      updated_at: base.updated_at,
      ai_thread: "",
      ai_session: "",
    } as any,
    messages,
    topics,
    memories,
    plan_items,
    workspace_files: workspace_files.map((r) => ({ rel: r.rel, content: null, updated_at: r.updated_at })),
  };
}


const TOPIC_STATUSES = new Set(["todo", "learning", "stuck", "mastered"]);

export interface ImportConversationResult {
  id: number;
  warnings: string[];
}

export function importConversationContext(input: ConversationExportPayload): ImportConversationResult {
  const warnings: string[] = [];
  const title = String(input.conversation.title || "Tanpa judul").slice(0, 120);
  const folder = String(input.conversation.folder || "");
  const mode = String(input.conversation.mode || "auto");
  const aiMode = String(input.conversation.ai_mode || "");
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const createdAt = (input.conversation.created_at && String(input.conversation.created_at).trim()) || ts;
  const updatedAt = (input.conversation.updated_at && String(input.conversation.updated_at).trim()) || ts;
  const aiSession = "";
  const aiThread = "";
  const conv = db.prepare("INSERT INTO conversations (title, folder, mode, ai_mode, ai_thread, ai_session, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(title, folder, mode, aiMode, aiThread, aiSession, createdAt, updatedAt || ts);
  const newCid = Number(conv.lastInsertRowid);
  if (!newCid) throw new Error("Gagal membuat percakapan baru");

  if (Array.isArray(input.messages)) {
    const ins = db.prepare("INSERT INTO messages (conversation_id, role, content, mood, mode, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const m of input.messages) {
      const role = m.role === "assistant" || m.role === "user" || m.role === "system" ? m.role : "user";
      const content = String(m.content || "");
      const mood = String(m.mood || "");
      const mode = String(m.mode || "");
      const createdAt = m.created_at || new Date().toISOString().replace("T", " ").slice(0, 19);
      ins.run(newCid, role, content, mood, mode, createdAt);
    }
  }

  if (Array.isArray(input.topics)) {
    const ins = db.prepare("INSERT INTO topics (name, status, notes, conversation_id, updated_at, mastery, confidence, evidence, last_reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const t of input.topics) {
      const name = String(t.name || "").trim().slice(0, 120);
      if (!name) continue;
      const status = TOPIC_STATUSES.has(String(t.status)) ? String(t.status) : "learning";
      const notes = String(t.notes || "").slice(0, 300);
      const evidence = String(t.evidence || "").slice(0, 300);
      const mastery = clampPercent(t.mastery, 0);
      const confidence = clampPercent(t.confidence, 0);
      const updatedAt = t.updated_at || new Date().toISOString().replace("T", " ").slice(0, 19);
      const lastReviewedAt = t.last_reviewed_at || "";
      try {
        ins.run(name, status, notes, newCid, updatedAt, mastery, confidence, evidence, lastReviewedAt);
      } catch (e) {
        warnings.push(`Topik terlewat (kemungkinan duplikat nama): ${name}`);
      }
    }
  }

  if (Array.isArray(input.memories)) {
    const ins = db.prepare("INSERT INTO memories (type, content, conversation_id, created_at) VALUES (?, ?, ?, ?)");
    for (const mem of input.memories) {
      const type = String(mem.type || "insight").slice(0, 40);
      const content = String(mem.content || "").slice(0, 500);
      if (!content) continue;
      const createdAt = mem.created_at || new Date().toISOString().replace("T", " ").slice(0, 19);
      try {
        ins.run(type, content, newCid, createdAt);
      } catch {
        // ignore
      }
    }
  }

  if (Array.isArray(input.plan_items)) {
    const ins = db.prepare("INSERT INTO plan_items (conversation_id, phase, title, objective, prerequisites, status, order_index, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const p of input.plan_items) {
      const phase = Number.isFinite(Number(p.phase)) ? Math.max(1, Math.trunc(Number(p.phase))) : 1;
      const title = String(p.title || "Tanpa judul");
      const objective = String(p.objective || "");
      const prerequisites = String(p.prerequisites || "");
      const sst = String(p.status);
      const status = sst === "todo" || sst === "in_progress" || sst === "done" || sst === "skipped" ? sst : "todo";
      const orderIndex = Number.isFinite(Number(p.order_index)) ? Math.trunc(Number(p.order_index)) : 0;
      const updatedAt = p.updated_at || new Date().toISOString().replace("T", " ").slice(0, 19);
      ins.run(newCid, phase, title, objective, prerequisites, status, orderIndex, updatedAt);
    }
  }

  if (Array.isArray(input.workspace_files)) {
    const ins = db.prepare("INSERT INTO workspace_files (conversation_id, rel, updated_at) VALUES (?, ?, ?) ON CONFLICT(conversation_id, rel) DO UPDATE SET updated_at = excluded.updated_at");
    for (const wf of input.workspace_files) {
      const rel = String(wf.rel || "").trim();
      if (!rel) continue;
      const updatedAt = wf.updated_at || new Date().toISOString().replace("T", " ").slice(0, 19);
      try {
        ins.run(newCid, rel, updatedAt);
      } catch {
        // ignore
      }
    }
  }

  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(newCid);
  walCheckpoint();
  return { id: newCid, warnings };
}
export function upsertWorkspaceFile(conversationId: number, rel: string): void {
  const clean = rel.trim();
  if (!clean) return;
  db.prepare(
    `INSERT INTO workspace_files (conversation_id, rel)
     VALUES (?, ?)
     ON CONFLICT(conversation_id, rel) DO UPDATE SET updated_at = datetime('now')`,
  ).run(conversationId, clean);
}


export function listWorkspaceFiles(conversationId: number): WorkspaceFileRecord[] {
  return db
    .prepare(
      "SELECT * FROM workspace_files WHERE conversation_id = ? ORDER BY updated_at DESC, rel ASC",
    )
    .all(conversationId) as unknown as WorkspaceFileRecord[];
}

const PLAN_STATUSES = new Set(["todo", "learning", "done", "stuck"]);


export function writeTopic(
  name: string,
  status: string,
  notes: string,
  conversationId: number,
  extra: TopicEvidence,
): TopicWriteResult {
  const cleanName = name.trim().slice(0, 120);
  if (!cleanName) {
    return { id: 0, status: "", mastery: 0, downgraded: false };
  }
  const requested = TOPIC_STATUSES.has(status) ? status : "learning";
  const existing = db
    .prepare(
      `SELECT id, mastery, confidence, evidence, last_reviewed_at FROM topics
       WHERE name = ? COLLATE NOCASE AND conversation_id = ?`,
    )
    .get(cleanName, conversationId) as
    | {
        id: number;
        mastery: number;
        confidence: number;
        evidence: string;
        last_reviewed_at: string;
      }
    | undefined;

  const prevMastery = existing?.mastery ?? 0;
  const evidence = (extra.evidence ?? existing?.evidence ?? "").trim().slice(0, 300);
  const proposed = extra.mastery === undefined ? prevMastery : clampPercent(extra.mastery);
  const mastery =
    proposed > prevMastery
      ? Math.min(proposed, prevMastery + MASTERY_MAX_GAIN_PER_TURN)
      : proposed;
  const confidence =
    extra.confidence === undefined
      ? (existing?.confidence ?? 0)
      : clampPercent(extra.confidence, existing?.confidence ?? 0);

  const ruled = enforceEvidenceRules(requested, mastery, evidence);

  if (existing) {
    db.prepare(
      `UPDATE topics SET status = ?, notes = ?, mastery = ?, confidence = ?, evidence = ?,
         last_reviewed_at = CASE WHEN ? <> '' THEN datetime('now') ELSE last_reviewed_at END,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      ruled.status,
      notes.slice(0, 300),
      ruled.mastery,
      confidence,
      evidence,
      evidence,
      existing.id,
    );
    return { id: existing.id, ...ruled };
  }

  const result = db
    .prepare(
      `INSERT INTO topics (name, status, notes, mastery, confidence, evidence, last_reviewed_at, conversation_id)
       VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? <> '' THEN datetime('now') ELSE '' END, ?)`,
    )
    .run(
      cleanName,
      ruled.status,
      notes.slice(0, 300),
      ruled.mastery,
      confidence,
      evidence,
      evidence,
      conversationId,
    );
  const newId = Number(result.lastInsertRowid);
  return { id: newId, ...ruled };
}


export function listPlanItems(conversationId: number): PlanItem[] {
  return db
    .prepare(
      `SELECT * FROM plan_items
       WHERE conversation_id = ?
       ORDER BY phase ASC, order_index ASC, id ASC`,
    )
    .all(conversationId) as unknown as PlanItem[];
}

function nextOrderIndex(conversationId: number, phase: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(MAX(order_index), -1) AS m FROM plan_items WHERE conversation_id = ? AND phase = ?",
    )
    .get(conversationId, phase) as { m: number };
  return Number(row.m) + 1;
}


export function movePlanItem(
  conversationId: number,
  id: number,
  dir: "up" | "down",
): void {
  const item = db
    .prepare(
      "SELECT id, phase, order_index FROM plan_items WHERE id = ? AND conversation_id = ?",
    )
    .get(id, conversationId) as
    | { id: number; phase: number; order_index: number }
    | undefined;
  if (!item) return;
  const cmp = dir === "up" ? "<" : ">";
  const order = dir === "up" ? "DESC" : "ASC";
  const sibling = db
    .prepare(
      `SELECT id, order_index FROM plan_items
       WHERE conversation_id = ? AND phase = ? AND order_index ${cmp} ?
       ORDER BY order_index ${order}
       LIMIT 1`,
    )
    .get(conversationId, item.phase, item.order_index) as
    | { id: number; order_index: number }
    | undefined;
  if (!sibling) return;
  const a = item.order_index;
  const b = sibling.order_index;
  db.prepare(
    "UPDATE plan_items SET order_index = ? WHERE id = ?",
  ).run(b, item.id);
  db.prepare(
    "UPDATE plan_items SET order_index = ? WHERE id = ?",
  ).run(a, sibling.id);
}
// ---------- riwayat file (backup & undo) ----------

const REVISION_KEEP = 200;

export interface RevisionInput {
  conversationId: number;
  rel: string;
  prev: string | null;
  next: string;
  added?: number;
  removed?: number;
  source?: string;
}

/** Simpan isi file SEBELUM perubahan, supaya perubahan bisa dibatalkan. */

export function patchPlanItem(
  id: number,
  patch: {
    title?: string;
    objective?: string;
    prerequisites?: string;
    phase?: number;
    status?: string;
  },
): void {
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 200);
    if (!title) return;
    sets.push("title = ?");
    values.push(title);
  }
  if (patch.objective !== undefined) {
    sets.push("objective = ?");
    values.push(patch.objective.trim().slice(0, 500));
  }
  if (patch.prerequisites !== undefined) {
    sets.push("prerequisites = ?");
    values.push(patch.prerequisites.trim().slice(0, 300));
  }
  if (patch.phase !== undefined) {
    const phase = Number(patch.phase);
    if (Number.isFinite(phase) && phase > 0) {
      sets.push("phase = ?");
      values.push(Math.min(Math.trunc(phase), 99));
    }
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    values.push(PLAN_STATUSES.has(patch.status) ? patch.status : "todo");
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(
    `UPDATE plan_items SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...values);
}


export function recordFileRevision(input: RevisionInput): number {
  const rel = input.rel.trim().slice(0, 300);
  if (!rel || !input.conversationId) return 0;
  const result = db
    .prepare(
      `INSERT INTO file_revisions (conversation_id, rel, content, existed, bytes, added, removed, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.conversationId,
      rel,
      input.prev ?? "",
      input.prev === null ? 0 : 1,
      Buffer.byteLength(input.prev ?? "", "utf8"),
      Math.max(0, Math.trunc(input.added ?? 0)),
      Math.max(0, Math.trunc(input.removed ?? 0)),
      String(input.source ?? "lode").slice(0, 20),
    );
  db.prepare(
    `DELETE FROM file_revisions
     WHERE conversation_id = ? AND id NOT IN (
       SELECT id FROM file_revisions WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
     )`,
  ).run(input.conversationId, input.conversationId, REVISION_KEEP);
  return Number(result.lastInsertRowid);
}


export function patchTopic(
  id: number,
  patch: {
    name?: string;
    status?: string;
    notes?: string;
    mastery?: number;
    confidence?: number;
    evidence?: string;
  },
): void {
  const current = db
    .prepare(
      "SELECT status, mastery, confidence, evidence FROM topics WHERE id = ?",
    )
    .get(id) as
    | { status: string; mastery: number; confidence: number; evidence: string }
    | undefined;
  if (!current) return;

  const keys: string[] = [];
  const values: (string | number)[] = [];

  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 120);
    if (name) {
      keys.push("name = ?");
      values.push(name);
    }
  }
  if (patch.notes !== undefined) {
    keys.push("notes = ?");
    values.push(patch.notes.slice(0, 300));
  }

  const evidence =
    patch.evidence !== undefined
      ? patch.evidence.trim().slice(0, 300)
      : current.evidence;
  const requestedMastery =
    patch.mastery === undefined
      ? current.mastery
      : clampPercent(patch.mastery, current.mastery);
  const mastery =
    requestedMastery > current.mastery
      ? Math.min(requestedMastery, current.mastery + MASTERY_MAX_GAIN_PER_TURN)
      : requestedMastery;
  const confidence =
    patch.confidence === undefined
      ? current.confidence
      : clampPercent(patch.confidence, current.confidence);

  const requestedStatus =
    patch.status !== undefined && TOPIC_STATUSES.has(patch.status)
      ? patch.status
      : current.status;
  const ruled = enforceEvidenceRules(requestedStatus, mastery, evidence);

  keys.push("status = ?", "mastery = ?", "confidence = ?", "evidence = ?");
  values.push(ruled.status, ruled.mastery, confidence, evidence);
  keys.push(
    "last_reviewed_at = CASE WHEN ? <> '' THEN datetime('now') ELSE last_reviewed_at END",
  );
  values.push(evidence);

  values.push(id);
  db.prepare(
    `UPDATE topics SET ${keys.join(", ")}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...values);
}


export function getFileRevision(id: number): FileRevision | undefined {
  return db.prepare("SELECT * FROM file_revisions WHERE id = ?").get(id) as
    | FileRevision
    | undefined;
}


export function getTopic(id: number): Topic | undefined {
  return db.prepare("SELECT * FROM topics WHERE id = ?").get(id) as Topic | undefined;
}

function clampPercent(value: number | undefined, fallback = 0): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export interface TopicEvidence {
  mastery?: number;
  confidence?: number;
  evidence?: string;
}

export interface TopicWriteResult {
  id: number;
  status: string;
  mastery: number;
  downgraded: boolean;
}

function enforceEvidenceRules(  status: string,
  mastery: number,
  evidence: string,
): { status: string; mastery: number; downgraded: boolean } {
  if (status !== "mastered") return { status, mastery, downgraded: false };
  if (evidence && mastery >= MASTERY_MASTERED_MIN) {
    return { status, mastery, downgraded: false };
  }
  return {
    status: "learning",
    mastery: evidence ? mastery : Math.min(mastery, MASTERY_MASTERED_MIN - 1),
    downgraded: true,
  };
}


export function listFileRevisions(
  conversationId: number,
  limit = 20,
): FileRevision[] {
  return db
    .prepare(
      `SELECT * FROM file_revisions
       WHERE conversation_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(
      conversationId,
      Math.max(1, Math.min(100, Math.trunc(limit) || 20)),
    ) as unknown as FileRevision[];
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


export function deleteMemory(id: number): void {
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
}

export interface WorkspaceFileRecord {
  id: number;
  conversation_id: number;
  rel: string;
  updated_at: string;
}


export function deletePlanItem(id: number): void {
  db.prepare("DELETE FROM plan_items WHERE id = ?").run(id);
}


export function deleteTopic(id: number): void {
  db.prepare("DELETE FROM topics WHERE id = ?").run(id);
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


export function createPlanItem(
  conversationId: number,
  input: { title: string; objective?: string; prerequisites?: string; phase?: number },
): number {
  const cleanTitle = input.title.trim().slice(0, 200);
  if (!cleanTitle) return 0;
  const phase = Number.isFinite(input.phase) && Number(input.phase) > 0
    ? Math.min(Math.trunc(Number(input.phase)), 99)
    : 1;
  const result = db
    .prepare(
      `INSERT INTO plan_items (conversation_id, phase, title, objective, prerequisites, order_index)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      conversationId,
      phase,
      cleanTitle,
      (input.objective ?? "").trim().slice(0, 500),
      (input.prerequisites ?? "").trim().slice(0, 300),
      nextOrderIndex(conversationId, phase),
    );
  return Number(result.lastInsertRowid);
}


