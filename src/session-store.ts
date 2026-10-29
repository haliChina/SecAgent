import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChatAttachment } from "./types.js";
import type { DatabaseSync } from "node:sqlite";
import {
  deleteSessionRow,
  insertMessageRow,
  insertSessionRow,
  listMessageRows,
  listSessionRows,
  nextMessageSeq,
  openSessionDb,
  readSessionDbMeta,
  readSessionRow,
  updateMessagePayload,
  updateSessionArchived,
  updateSessionAutoLoadedSkills,
  updateSessionLegacyHydrated,
  updateSessionMeta,
  withImmediateTransaction,
  writeSessionDbMeta,
  type MessageRow,
  type SessionRow,
} from "./session-db.js";

/** 从内存会话算列表预览（最后一条含文本消息，压缩空白截断）。 */
function previewOfSession(data: SessionData): string {
  /* 从后往前找第一条含文本的消息；不复制整个消息数组（长会话每次写盘都复制一遍是纯浪费）。 */
  const messages = data?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index]?.content;
    if (typeof content === "string" && content.trim()) return content.replace(/\s+/g, " ").trim().slice(0, 72);
  }
  return "";
}

export interface SessionMeta { id: string; title: string; createdAt: string; updatedAt: string; preview?: string; /** R65：归档会话不出现在常规列表，可在「已归档」分组查看/恢复。 */ archived?: boolean }
export interface ToolCallRecord { name: string; arguments: unknown; result?: unknown }
export type AssistantActivity =
  | { kind: "thinking" | "summary" | "answer"; content: string; turn?: number }
  | { kind: "skill-auto-load"; name: string; path: string }
  | { kind: "tool"; name: string; arguments: unknown; result?: unknown };
export interface HallucinationNotice { score: number; signals: Array<{ id: string; detail: string }> }
export interface SessionMessage { id: string; role: "user" | "assistant"; content: string; createdAt: string; attachments?: ChatAttachment[]; toolCalls?: ToolCallRecord[]; activities?: AssistantActivity[]; stopped?: boolean; hallucination?: HallucinationNotice; fallbackNotice?: string }
export interface SessionData { meta: SessionMeta; messages: SessionMessage[]; autoLoadedSkills?: string[]; /** 存量会话的 runtime.jsonl 工具调用回填只做一次（每次 get 都全量扫描 229MB 日志会卡住主进程）。 */ legacyHydrated?: boolean }
export interface SessionRuntimeEvent { sequence: number; at: string; stage: string; data: unknown }

/* R63：脱敏内核抽到 src/redact.ts（渲染层 TracePanel 共用单一事实源，
   并补环引用防护与深递归上限——工具结果带循环引用时旧实现会在
   appendRuntimeEvent 热路径上栈溢出崩溃主进程）。 */
import { MASKED_SECRET, maskSecretsDeep, SECRET_KEY_PATTERN } from "./redact.js";
export { MASKED_SECRET, maskSecretsDeep, SECRET_KEY_PATTERN };

/**
 * 会话存储门面（SQLite）：元数据与消息落 `<workspace>/sessions.db`，
 * 逐事件运行日志仍留 `sessions/<id>/runtime.jsonl`（追加成本低、尾部窗口
 * 读取专为大文件设计）。对外 API 与此前 JSON 文件实现保持一致。
 */
export class SessionStore {
  private root: string;
  private db: DatabaseSync;
  constructor(workspace: string) {
    this.root = path.join(workspace, "sessions");
    fs.mkdirSync(this.root, { recursive: true });
    this.db = openSessionDb(workspace);
    this.migrateLegacyJson();
  }
  list(): SessionMeta[] {
    return listSessionRows(this.db).map(metaOfRow);
  }

  /** 会话列表预览（DB 里为 null 的存量会话打开时懒回填）。 */
  previewOf(id: string): string {
    const row = readSessionRow(this.db, id);
    if (!row) return "";
    if (row.preview !== null) return row.preview;
    try {
      return previewOfSession(this.get(id));
    } catch {
      return "";
    }
  }

  create(title = "新会话", options: { listed?: boolean } = {}): SessionData {
    const now = new Date().toISOString();
    const meta: SessionMeta = { id: randomUUID(), title, createdAt: now, updatedAt: now };
    const data: SessionData = { meta, messages: [], legacyHydrated: true };
    fs.mkdirSync(this.sessionDir(meta.id), { recursive: true });
    insertSessionRow(this.db, {
      id: meta.id,
      title,
      createdAt: now,
      updatedAt: now,
      preview: null,
      archived: false,
      listed: options.listed !== false,
      legacyHydrated: true,
    });
    return data;
  }
  get(id: string): SessionData {
    const row = readSessionRow(this.db, id);
    if (!row) throw new Error(`会话不存在：${id}`);
    const session: SessionData = {
      meta: metaOfRow(row),
      messages: listMessageRows(this.db, id).map(messageOfRow),
      ...(row.autoLoadedSkills?.length ? { autoLoadedSkills: row.autoLoadedSkills } : {}),
      legacyHydrated: row.legacyHydrated,
    };
    /* 存量会话的 runtime.jsonl 工具调用回填只做一次：此前每次 get（每次
       appendMessage 都会 get）都全量 readFileSync + 逐行 JSON.parse，审计
       实测出现过 229MB 的 runtime.jsonl，主进程阵发性卡死。回填结果（无论
       是否有变更）用 legacy_hydrated 标记落库，后续读取直接跳过。 */
    if (!session.legacyHydrated) {
      const changed = this.hydrateLegacyToolCalls(session);
      session.legacyHydrated = true;
      withImmediateTransaction(this.db, () => {
        updateSessionLegacyHydrated(this.db, id, true);
        if (changed) {
          for (const message of session.messages) {
            if (message.toolCalls?.length) updateMessagePayload(this.db, message.id, payloadOf(message));
          }
        }
      });
    }
    // R65 懒回填：迁移时没有 preview 的会话，首次打开时补上（get 本就读了全量）。
    if (row.preview === null) {
      updateSessionMeta(this.db, id, { title: session.meta.title, updatedAt: session.meta.updatedAt, preview: previewOfSession(session) });
    }
    return session;
  }
  /** R65：归档/取消归档（不删数据，只翻标记）。 */
  setArchived(id: string, archived: boolean): void {
    updateSessionArchived(this.db, id, archived);
  }

  delete(id: string): void {
    if (!readSessionRow(this.db, id)) throw new Error(`会话不存在：${id}`);
    deleteSessionRow(this.db, id);
    fs.rmSync(this.sessionDir(id), { recursive: true, force: true });
  }
  appendMessage(id: string, role: SessionMessage["role"], content: string, toolCalls?: ToolCallRecord[], activities?: AssistantActivity[], attachments?: ChatAttachment[], stopped = false, hallucination?: HallucinationNotice, fallbackNotice?: string): SessionData {
    const session = this.get(id);
    const now = new Date().toISOString();
    const message: SessionMessage = { id: randomUUID(), role, content, createdAt: now, ...(attachments?.length ? { attachments } : {}), ...(toolCalls?.length ? { toolCalls } : {}), ...(activities?.length ? { activities } : {}), ...(stopped ? { stopped: true } : {}), ...(hallucination?.signals.length ? { hallucination } : {}), ...(fallbackNotice ? { fallbackNotice } : {}) };
    session.messages.push(message);
    session.meta.updatedAt = now;
    if (role === "user" && session.meta.title === "新会话") session.meta.title = content.replace(/\s+/g, " ").slice(0, 28) || "新会话";
    withImmediateTransaction(this.db, () => {
      insertMessageRow(this.db, { id: message.id, sessionId: id, seq: nextMessageSeq(this.db, id), role, content, createdAt: now, payload: payloadOf(message) });
      updateSessionMeta(this.db, id, { title: session.meta.title, updatedAt: now, preview: previewOfSession(session) });
    });
    return session;
  }
  setTitle(id: string, title: string): SessionData {
    const session = this.get(id);
    const cleanTitle = title.trim();
    if (!cleanTitle) return session;
    const updatedAt = new Date().toISOString();
    updateSessionMeta(this.db, id, { title: cleanTitle, updatedAt, preview: previewOfSession(session) });
    return { ...session, meta: { ...session.meta, title: cleanTitle, updatedAt } };
  }
  appendRuntimeEvent(id: string, event: { sequence?: number; at?: string; stage: string; data: unknown }): void {
    /* 落盘前脱敏：同一事件还会经 IPC 直播给 renderer（渲染层另行掩码）与进入
       遥测，此处只保证磁盘文件不含明文密钥。注意不改变 event 本体，只写掩码副本。 */
    const entry = JSON.stringify({ at: new Date().toISOString(), ...event, data: maskSecretsDeep(event.data) }) + "\n";
    fs.appendFileSync(path.join(this.sessionDir(id), "runtime.jsonl"), entry, "utf8");
  }
  getRuntimeEvents(id: string): SessionRuntimeEvent[] {
    /* R75（审计 P3-47）：实测单会话 runtime.jsonl 达 229MB，旧实现全量
       readFileSync+逐行 parse 后又只 slice 最后一轮——整文件进内存纯属浪费
       （大文件下 JS 对象化峰值可达 1GB 级）。改尾部窗口读取：从文件尾往前
       取一块，在块内找最后一个 user.request；找不到（说明最后一轮早于此块）
       按倍增窗口重试，上限 4MB。正常会话的最后一轮事件远小于 4MB。 */
    const file = path.join(this.sessionDir(id), "runtime.jsonl");
    if (!fs.existsSync(file)) return [];
    const parseEvents = (text: string): SessionRuntimeEvent[] => text.split("\n").flatMap((line): SessionRuntimeEvent[] => {
      if (!line) return [];
      try {
        const event = JSON.parse(line) as Partial<SessionRuntimeEvent>;
        return typeof event.sequence === "number" && typeof event.at === "string" && typeof event.stage === "string"
          ? [{ sequence: event.sequence, at: event.at, stage: event.stage, data: event.data }]
          : [];
      } catch {
        return [];
      }
    });
    const size = fs.statSync(file).size;
    const findLastRequest = (events: SessionRuntimeEvent[]): number => {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index].stage === "user.request") return index;
      }
      return -1;
    };
    let windowBytes = Math.min(524_288, size);
    while (true) {
      const fh = fs.openSync(file, "r");
      try {
        const readBytes = Buffer.alloc(Math.min(windowBytes, size));
        fs.readSync(fh, readBytes, 0, readBytes.length, Math.max(0, size - windowBytes));
        const text = readBytes.toString("utf8");
        // 窗口首行可能被截断成半个 JSON，parse 失败自然丢弃——但若整个窗口
        // 都不是从行首开始，第一行必废，从下一个换行开始读。
        const firstNewline = windowBytes < size ? text.indexOf("\n") : -1;
        const body = firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
        const events = parseEvents(body);
        const lastRequest = findLastRequest(events);
        if (lastRequest >= 0) return events.slice(lastRequest);
        if (windowBytes >= size) {
          // 整文件都没有 user.request（极端：事件全被轮转清理）——返回尾部窗口
          return events.slice(-2000);
        }
        if (windowBytes >= 4_194_304) return events.slice(-2000);
        windowBytes = Math.min(windowBytes * 2, Math.max(size, 4_194_304));
      } finally {
        fs.closeSync(fh);
      }
    }
  }
  setAutoLoadedSkills(id: string, skills: string[]): void {
    const session = this.get(id);
    const unique = [...new Set(skills)];
    updateSessionAutoLoadedSkills(this.db, id, unique, new Date().toISOString(), previewOfSession(session));
  }

  private sessionDir(id: string): string { return path.join(this.root, id); }

  /**
   * 旧版 JSON 存储的一次性导入。
   *
   * 旧布局：`sessions/index.json`（元数据 + preview）+ 每会话
   * `sessions/<id>/session.json`（全量数据）。迁移完成后原文件改名为
   * `*.migrated` 保留备份（不删除）；`meta.legacy_migrated=1` 防止重复导入，
   * 因此正常启动只多一次 existsSync。
   *
   * 触发条件刻意放宽：只要还看到 index.json 就再扫一遍——用户降级到旧版
   * 后旧版会继续写 JSON，再升级时按 updated_at 增量补录（新版本消息不丢）；
   * DB 被删除时也能从 `*.migrated` 备份回灌。
   *
   * 迁移不在构造期回填 runtime.jsonl 工具调用（229MB 日志会拖慢启动），
   * legacy_hydrated 沿旧值，交给首次 get() 懒回填。
   */
  private migrateLegacyJson(): void {
    const indexFile = path.join(this.root, "index.json");
    if (readSessionDbMeta(this.db, "legacy_migrated") === "1" && !fs.existsSync(indexFile)) return;
    const legacyIndex = this.readLegacyIndex(fs.existsSync(indexFile) ? indexFile : path.join(this.root, "index.json.migrated"));
    const entries = new Map<string, { meta: SessionMeta; preview?: string; listed: boolean; data?: SessionData }>();
    for (const meta of legacyIndex) entries.set(meta.id, { meta, ...(typeof meta.preview === "string" ? { preview: meta.preview } : {}), listed: true });
    const files: string[] = [];
    for (const dirent of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const file = [path.join(this.root, dirent.name, "session.json"), path.join(this.root, dirent.name, "session.json.migrated")].find((candidate) => fs.existsSync(candidate));
      if (!file) continue;
      files.push(file);
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8")) as SessionData;
        const id = data?.meta?.id;
        if (typeof id !== "string" || !id) continue;
        const prior = entries.get(id);
        entries.set(id, {
          // 归档标记只存在旧 index.json 里，合并时不能丢。
          meta: prior?.meta.archived ? { ...data.meta, archived: true } : data.meta,
          ...(prior?.preview !== undefined ? { preview: prior.preview } : {}),
          listed: prior?.listed ?? false,
          data,
        });
      } catch { /* 单个损坏的旧会话文件不阻塞启动 */ }
    }
    if (entries.size) {
      withImmediateTransaction(this.db, () => {
        for (const [id, entry] of entries) {
          const existing = readSessionRow(this.db, id);
          if (existing) {
            // 只有旧 JSON 更新时才覆盖（降级写回场景）；没有正文数据时不动已有消息。
            if (!entry.data || existing.updatedAt >= entry.meta.updatedAt) continue;
            deleteSessionRow(this.db, id); // 级联清掉旧消息，再整份重建
          }
          insertSessionRow(this.db, {
            id,
            title: entry.meta.title,
            createdAt: entry.meta.createdAt,
            updatedAt: entry.meta.updatedAt,
            preview: entry.preview ?? (entry.data ? previewOfSession(entry.data) : null),
            archived: entry.meta.archived === true,
            listed: entry.listed,
            ...(entry.data?.autoLoadedSkills?.length ? { autoLoadedSkills: entry.data.autoLoadedSkills } : {}),
            legacyHydrated: entry.data?.legacyHydrated === true,
          });
          (entry.data?.messages ?? []).forEach((message, seq) => {
            insertMessageRow(this.db, { id: message.id, sessionId: id, seq, role: message.role, content: message.content, createdAt: message.createdAt, payload: payloadOf(message) });
          });
        }
        writeSessionDbMeta(this.db, "legacy_migrated", "1");
      });
    } else {
      writeSessionDbMeta(this.db, "legacy_migrated", "1");
    }
    this.retireLegacyFile(indexFile);
    for (const file of files) this.retireLegacyFile(file);
  }

  private readLegacyIndex(file: string): SessionMeta[] {
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SessionMeta[];
      return Array.isArray(parsed) ? parsed.filter((meta) => typeof meta?.id === "string" && typeof meta.title === "string" && typeof meta.updatedAt === "string") : [];
    } catch {
      return [];
    }
  }

  /** 旧文件改名保留备份；目标已存在或改名失败都不影响 DB（DB 已是权威）。 */
  private retireLegacyFile(file: string): void {
    const target = `${file}.migrated`;
    if (!fs.existsSync(file) || fs.existsSync(target)) return;
    try { fs.renameSync(file, target); } catch { /* 权限/占用：留着旧文件，下次启动幂等重试 */ }
  }

  /** Backfill sessions created before tool calls were attached directly to assistant messages. */
  private hydrateLegacyToolCalls(session: SessionData): boolean {
    const log = path.join(this.sessionDir(session.meta.id), "runtime.jsonl");
    if (!fs.existsSync(log)) return false;
    const events = fs.readFileSync(log, "utf8").split("\n").flatMap((line) => {
      try { return line ? [JSON.parse(line) as { stage?: string; data?: unknown }] : []; } catch { return []; }
    });
    let changed = false;
    let assistantIndex = 0;
    let pending: ToolCallRecord[] = [];
    for (const event of events) {
      if (event.stage === "mcp.tools/call") {
        const data = event.data as { name?: unknown; arguments?: unknown };
        if (typeof data.name === "string") pending.push({ name: data.name, arguments: data.arguments ?? {} });
      }
      if (event.stage === "mcp.tools/result") {
        const data = event.data as { name?: unknown; result?: unknown };
        if (typeof data.name === "string") {
          const call = [...pending].reverse().find((item) => item.name === data.name && !("result" in item));
          if (call) call.result = data.result;
        }
      }
      if (event.stage === "assistant.response" || event.stage === "runtime.error") {
        while (assistantIndex < session.messages.length && session.messages[assistantIndex].role !== "assistant") assistantIndex++;
        const assistant = session.messages[assistantIndex];
        if (assistant && !assistant.toolCalls?.length && pending.length) {
          assistant.toolCalls = pending;
          changed = true;
        }
        pending = [];
        assistantIndex++;
      }
    }
    return changed;
  }
}

function metaOfRow(row: SessionRow): SessionMeta {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.preview !== null ? { preview: row.preview } : {}),
    ...(row.archived ? { archived: true } : {}),
  };
}

function messageOfRow(row: MessageRow): SessionMessage {
  let extra: Partial<SessionMessage> = {};
  if (row.payload) {
    try {
      const parsed = JSON.parse(row.payload) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extra = parsed as Partial<SessionMessage>;
    } catch { /* 损坏的 payload 只丢可选字段，正文仍可读 */ }
  }
  return { ...extra, id: row.id, role: row.role as SessionMessage["role"], content: row.content, createdAt: row.createdAt };
}

/** 可选字段序列化进 messages.payload；全部缺省时写 null（不占空间）。 */
function payloadOf(message: SessionMessage): string | null {
  const extra: Record<string, unknown> = {};
  if (message.attachments?.length) extra.attachments = message.attachments;
  if (message.toolCalls?.length) extra.toolCalls = message.toolCalls;
  if (message.activities?.length) extra.activities = message.activities;
  if (message.stopped) extra.stopped = true;
  if (message.hallucination?.signals.length) extra.hallucination = message.hallucination;
  if (message.fallbackNotice) extra.fallbackNotice = message.fallbackNotice;
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}
