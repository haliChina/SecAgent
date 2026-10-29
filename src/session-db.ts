/**
 * 会话数据库（node:sqlite）。
 *
 * 此前会话全量存 `sessions/<id>/session.json`，appendMessage 每次都要把整份
 * JSON 序列化重写；列表靠 index.json 副本，容易出现两份元数据不一致。改用
 * SQLite：元数据一行、消息一行，追加只 insert，列表只扫元数据列。
 *
 * Electron 42 内置 Node 24，`node:sqlite` 是内建模块，不引入 any 依赖。
 * 连接按 DB 真实路径模块级缓存：SessionStore 在 IPC/唤醒/CLI 多处 new，
 * 共享同一个 DatabaseSync 才能复用 WAL 与事务状态（同步 API，单线程无竞态）。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SESSION_SCHEMA_VERSION = 1;

export interface SessionRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** null = 尚未计算（懒回填），空串 = 确实没有可预览文本。 */
  preview: string | null;
  archived: boolean;
  /** wake 会话 listed=0：不进常规列表，但仍可按 id 读取。 */
  listed: boolean;
  autoLoadedSkills?: string[];
  legacyHydrated: boolean;
}

export interface MessageRow {
  id: string;
  sessionId: string;
  seq: number;
  role: string;
  content: string;
  createdAt: string;
  /** JSON：attachments/toolCalls/activities/stopped/hallucination/fallbackNotice。 */
  payload: string | null;
}

const connections = new Map<string, DatabaseSync>();

function sessionDbPath(workspace: string): string {
  return path.resolve(workspace, "sessions.db");
}

export function openSessionDb(workspace: string): DatabaseSync {
  const file = sessionDbPath(workspace);
  const cached = connections.get(file);
  if (cached) return cached;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      preview TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      listed INTEGER NOT NULL DEFAULT 1,
      auto_loaded_skills TEXT,
      legacy_hydrated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT,
      UNIQUE(session_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_list ON sessions(listed, updated_at DESC);
  `);
  const version = readSessionDbMeta(db, "schema_version");
  if (version !== undefined && Number(version) > SESSION_SCHEMA_VERSION) {
    db.close();
    throw new Error(`会话数据库版本 ${version} 高于当前支持的 ${SESSION_SCHEMA_VERSION}，请升级 SecAgent`);
  }
  writeSessionDbMeta(db, "schema_version", String(SESSION_SCHEMA_VERSION));
  connections.set(file, db);
  return db;
}

export function closeSessionDb(workspace: string): void {
  const file = sessionDbPath(workspace);
  const db = connections.get(file);
  if (!db) return;
  connections.delete(file);
  db.close();
}

export function closeAllSessionDbs(): void {
  for (const [file, db] of connections) {
    connections.delete(file);
    db.close();
  }
}

/** BEGIN IMMEDIATE 包住多表写入（appendMessage 的 insert + 元数据 update）。 */
export function withImmediateTransaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* 事务可能已由 SQLite 回滚 */ }
    throw error;
  }
}

export function readSessionDbMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return row?.value;
}

export function writeSessionDbMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function listSessionRows(db: DatabaseSync): SessionRow[] {
  return (db.prepare("SELECT * FROM sessions WHERE listed = 1 ORDER BY updated_at DESC").all() as Array<Record<string, unknown>>).map(sessionRow);
}

export function readSessionRow(db: DatabaseSync, id: string): SessionRow | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? sessionRow(row) : undefined;
}

export function insertSessionRow(db: DatabaseSync, row: SessionRow): void {
  db.prepare("INSERT INTO sessions (id, title, created_at, updated_at, preview, archived, listed, auto_loaded_skills, legacy_hydrated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.title, row.createdAt, row.updatedAt, row.preview, row.archived ? 1 : 0, row.listed ? 1 : 0, row.autoLoadedSkills?.length ? JSON.stringify(row.autoLoadedSkills) : null, row.legacyHydrated ? 1 : 0);
}

export function updateSessionMeta(db: DatabaseSync, id: string, meta: { title: string; updatedAt: string; preview: string }): void {
  db.prepare("UPDATE sessions SET title = ?, updated_at = ?, preview = ? WHERE id = ?")
    .run(meta.title, meta.updatedAt, meta.preview, id);
}

export function updateSessionArchived(db: DatabaseSync, id: string, archived: boolean): number {
  return Number(db.prepare("UPDATE sessions SET archived = ? WHERE id = ?").run(archived ? 1 : 0, id).changes);
}

export function updateSessionAutoLoadedSkills(db: DatabaseSync, id: string, skills: string[], updatedAt: string, preview: string): void {
  db.prepare("UPDATE sessions SET auto_loaded_skills = ?, updated_at = ?, preview = ? WHERE id = ?")
    .run(skills.length ? JSON.stringify(skills) : null, updatedAt, preview, id);
}

export function updateSessionLegacyHydrated(db: DatabaseSync, id: string, hydrated: boolean): void {
  db.prepare("UPDATE sessions SET legacy_hydrated = ? WHERE id = ?").run(hydrated ? 1 : 0, id);
}

export function deleteSessionRow(db: DatabaseSync, id: string): void {
  // messages 由 ON DELETE CASCADE 一并清理。
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function listMessageRows(db: DatabaseSync, sessionId: string): MessageRow[] {
  return (db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC").all(sessionId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    role: String(row.role),
    content: String(row.content),
    createdAt: String(row.created_at),
    payload: typeof row.payload === "string" ? row.payload : null,
  }));
}

export function nextMessageSeq(db: DatabaseSync, sessionId: string): number {
  const row = db.prepare("SELECT COALESCE(MAX(seq), -1) + 1 AS next FROM messages WHERE session_id = ?").get(sessionId) as { next?: number } | undefined;
  return Number(row?.next ?? 0);
}

export function insertMessageRow(db: DatabaseSync, row: MessageRow): void {
  db.prepare("INSERT INTO messages (id, session_id, seq, role, content, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.sessionId, row.seq, row.role, row.content, row.createdAt, row.payload);
}

export function updateMessagePayload(db: DatabaseSync, id: string, payload: string | null): void {
  db.prepare("UPDATE messages SET payload = ? WHERE id = ?").run(payload, id);
}

function sessionRow(row: Record<string, unknown>): SessionRow {
  const skills = typeof row.auto_loaded_skills === "string" ? parseSkills(row.auto_loaded_skills) : undefined;
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    preview: typeof row.preview === "string" ? row.preview : null,
    archived: Number(row.archived) === 1,
    listed: Number(row.listed) === 1,
    ...(skills?.length ? { autoLoadedSkills: skills } : {}),
    legacyHydrated: Number(row.legacy_hydrated) === 1,
  };
}

function parseSkills(raw: string): string[] | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
  } catch {
    return undefined;
  }
}
