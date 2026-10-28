import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChatAttachment } from "./types.js";

/* R65：preview 落进 index.json——此前 sessions:list 对每个会话全量 JSON.parse
   session.json（含所有消息/toolCalls/附件），会话一多主进程同步阻塞数秒（鼠标不跟手、
   OOBE 读取排队更慢）。现在 preview 随 meta 一起存 index，list 只读一个小文件。 */
/** R65：从内存会话算列表预览（最后一条含文本消息，压缩空白截断）。 */
function previewOfSession(data: SessionData): string {
  const last = [...(data?.messages ?? [])].reverse().find((m) => typeof m.content === "string" && m.content.trim());
  return last ? (last.content as string).replace(/\s+/g, " ").trim().slice(0, 72) : "";
}

export interface SessionMeta { id: string; title: string; createdAt: string; updatedAt: string; preview?: string; /** R65：归档会话不出现在常规列表，可在「已归档」分组查看/恢复。 */ archived?: boolean }
export interface ToolCallRecord { name: string; arguments: unknown; result?: unknown }
export type AssistantActivity =
  | { kind: "thinking" | "summary" | "answer"; content: string; turn?: number }
  | { kind: "skill-auto-load"; name: string; path: string }
  | { kind: "tool"; name: string; arguments: unknown; result?: unknown };
export interface HallucinationNotice { score: number; signals: Array<{ id: string; detail: string }> }
export interface SessionMessage { id: string; role: "user" | "assistant"; content: string; createdAt: string; attachments?: ChatAttachment[]; toolCalls?: ToolCallRecord[]; activities?: AssistantActivity[]; stopped?: boolean; hallucination?: HallucinationNotice; fallbackNotice?: string }
export interface SessionData { meta: SessionMeta; messages: SessionMessage[]; autoLoadedSkills?: string[] }
export interface SessionRuntimeEvent { sequence: number; at: string; stage: string; data: unknown }

/* R63：脱敏内核抽到 src/redact.ts（渲染层 TracePanel 共用单一事实源，
   并补环引用防护与深递归上限——工具结果带循环引用时旧实现会在
   appendRuntimeEvent 热路径上栈溢出崩溃主进程）。 */
import { MASKED_SECRET, maskSecretsDeep, SECRET_KEY_PATTERN } from "./redact.js";
export { MASKED_SECRET, maskSecretsDeep, SECRET_KEY_PATTERN };

export class SessionStore {
  private root: string;
  constructor(workspace: string) {
    this.root = path.join(workspace, "sessions");
    fs.mkdirSync(this.root, { recursive: true });
  }
  list(): SessionMeta[] {
    const index = this.readIndex();
    return index.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** 会话列表预览（index 优先；存量会话首次打开时懒回填）。 */
  previewOf(id: string): string {
    const indexed = this.readIndex().find((meta) => meta.id === id)?.preview;
    if (typeof indexed === "string") return indexed;
    try {
      return previewOfSession(this.get(id));
    } catch {
      return "";
    }
  }

  /** R65：把 preview 一起写进 index（写盘顺带，读列表零成本）。 */
  private touchIndex(session: SessionData): void {
    const meta = { ...session.meta, preview: previewOfSession(session) };
    const index = this.readIndex();
    const at = index.findIndex((item) => item.id === meta.id);
    if (at >= 0) index[at] = { ...index[at], ...meta };
    else index.push(meta);
    this.writeIndex(index);
  }
  create(title = "新会话", options: { listed?: boolean } = {}): SessionData {
    const now = new Date().toISOString();
    const meta: SessionMeta = { id: randomUUID(), title, createdAt: now, updatedAt: now };
    const data: SessionData = { meta, messages: [] };
    fs.mkdirSync(this.sessionDir(meta.id), { recursive: true });
    this.writeSession(data);
    if (options.listed !== false) this.writeIndex([meta, ...this.readIndex()]);
    return data;
  }
  get(id: string): SessionData {
    const file = path.join(this.sessionDir(id), "session.json");
    if (!fs.existsSync(file)) throw new Error(`会话不存在：${id}`);
    const session = JSON.parse(fs.readFileSync(file, "utf8")) as SessionData;
    if (this.hydrateLegacyToolCalls(session)) this.writeSession(session);
    // R65 懒回填：存量会话 index 里没有 preview，打开时补上（get 本就读了全量）。
    try {
      const indexed = this.readIndex().find((meta) => meta.id === id);
      if (indexed && typeof indexed.preview !== "string") this.touchIndex(session);
    } catch { /* 索引回填失败不影响读取 */ }
    return session;
  }
  /** R65：归档/取消归档（不删数据，只翻 index 标记）。 */
  setArchived(id: string, archived: boolean): void {
    const index = this.readIndex();
    const at = index.findIndex((item) => item.id === id);
    if (at < 0) return;
    index[at] = { ...index[at], archived: archived || undefined };
    this.writeIndex(index);
  }

  delete(id: string): void {
    const sessions = this.readIndex();
    if (!sessions.some((item) => item.id === id)) throw new Error(`会话不存在：${id}`);
    fs.rmSync(this.sessionDir(id), { recursive: true, force: true });
    this.writeIndex(sessions.filter((item) => item.id !== id));
  }
  appendMessage(id: string, role: SessionMessage["role"], content: string, toolCalls?: ToolCallRecord[], activities?: AssistantActivity[], attachments?: ChatAttachment[], stopped = false, hallucination?: HallucinationNotice, fallbackNotice?: string): SessionData {
    const session = this.get(id);
    const now = new Date().toISOString();
    session.messages.push({ id: randomUUID(), role, content, createdAt: now, ...(attachments?.length ? { attachments } : {}), ...(toolCalls?.length ? { toolCalls } : {}), ...(activities?.length ? { activities } : {}), ...(stopped ? { stopped: true } : {}), ...(hallucination?.signals.length ? { hallucination } : {}), ...(fallbackNotice ? { fallbackNotice } : {}) });
    session.meta.updatedAt = now;
    if (role === "user" && session.meta.title === "新会话") session.meta.title = content.replace(/\s+/g, " ").slice(0, 28) || "新会话";
    this.writeSession(session);
    this.touchIndex(session);
    return session;
  }
  setTitle(id: string, title: string): SessionData {
    const session = this.get(id);
    const cleanTitle = title.trim();
    if (!cleanTitle) return session;
    session.meta.title = cleanTitle;
    session.meta.updatedAt = new Date().toISOString();
    this.writeSession(session);
    this.touchIndex(session);
    return session;
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
    session.autoLoadedSkills = [...new Set(skills)];
    session.meta.updatedAt = new Date().toISOString();
    this.writeSession(session);
    this.touchIndex(session);
  }
  private readIndex(): SessionMeta[] {
    const file = path.join(this.root, "index.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as SessionMeta[] : [];
  }
  private writeIndex(index: SessionMeta[]): void { fs.writeFileSync(path.join(this.root, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8"); }
  private writeSession(session: SessionData): void { fs.writeFileSync(path.join(this.sessionDir(session.meta.id), "session.json"), JSON.stringify(session, null, 2) + "\n", "utf8"); }
  private sessionDir(id: string): string { return path.join(this.root, id); }
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
