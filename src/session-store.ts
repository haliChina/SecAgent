import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ChatAttachment } from "./types.js";

export interface SessionMeta { id: string; title: string; createdAt: string; updatedAt: string }
export interface ToolCallRecord { name: string; arguments: unknown; result?: unknown }
export type AssistantActivity =
  | { kind: "thinking" | "summary" | "answer"; content: string; turn?: number }
  | { kind: "skill-auto-load"; name: string; path: string }
  | { kind: "tool"; name: string; arguments: unknown; result?: unknown };
export interface HallucinationNotice { score: number; signals: Array<{ id: string; detail: string }> }
export interface SessionMessage { id: string; role: "user" | "assistant"; content: string; createdAt: string; attachments?: ChatAttachment[]; toolCalls?: ToolCallRecord[]; activities?: AssistantActivity[]; stopped?: boolean; hallucination?: HallucinationNotice; fallbackNotice?: string }
export interface SessionData { meta: SessionMeta; messages: SessionMessage[]; autoLoadedSkills?: string[] }
export interface SessionRuntimeEvent { sequence: number; at: string; stage: string; data: unknown }

/* 密钥脱敏：工具调用参数/结果可能含用户口令与 API Key。runtime.jsonl 落盘、
   renderer 历史（sessions:runtime-events）与诊断上传都读同一份数据，写入前
   统一掩码；key 命中即整值替换，不猜测值的格式。归一化 key 再匹配，防零宽
   字符/软连字符/空格/点号绕过（如 api\u200bkey）。 */
const SECRET_KEY_PATTERN = /api[_-]?key|password|passwd|pwd|token|secret|credential|access[_-]?key|authorization|private[_-]?key|passphrase/i;
export const MASKED_SECRET = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
export function maskSecretsDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecretsDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.replace(/[\u200b-\u200d\ufeff\xad\s.\u00b7]/g, "");
      out[key] = SECRET_KEY_PATTERN.test(normalizedKey) ? MASKED_SECRET : maskSecretsDeep(entry);
    }
    return out;
  }
  return value;
}

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

  /** 会话列表预览：最后一条含文本的消息，压缩空白后截断（无消息返回空串）。 */
  previewOf(id: string): string {
    try {
      const data = this.get(id);
      const last = [...(data?.messages ?? [])].reverse().find((m) => typeof m.content === "string" && m.content.trim());
      return last ? last.content.replace(/\s+/g, " ").trim().slice(0, 72) : "";
    } catch {
      return "";
    }
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
    return session;
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
    this.writeIndex(this.readIndex().map((item) => item.id === id ? session.meta : item));
    return session;
  }
  setTitle(id: string, title: string): SessionData {
    const session = this.get(id);
    const cleanTitle = title.trim();
    if (!cleanTitle) return session;
    session.meta.title = cleanTitle;
    session.meta.updatedAt = new Date().toISOString();
    this.writeSession(session);
    this.writeIndex(this.readIndex().map((item) => item.id === id ? session.meta : item));
    return session;
  }
  appendRuntimeEvent(id: string, event: { sequence?: number; at?: string; stage: string; data: unknown }): void {
    /* 落盘前脱敏：同一事件还会经 IPC 直播给 renderer（渲染层另行掩码）与进入
       遥测，此处只保证磁盘文件不含明文密钥。注意不改变 event 本体，只写掩码副本。 */
    const entry = JSON.stringify({ at: new Date().toISOString(), ...event, data: maskSecretsDeep(event.data) }) + "\n";
    fs.appendFileSync(path.join(this.sessionDir(id), "runtime.jsonl"), entry, "utf8");
  }
  getRuntimeEvents(id: string): SessionRuntimeEvent[] {
    const file = path.join(this.sessionDir(id), "runtime.jsonl");
    if (!fs.existsSync(file)) return [];
    const events = fs.readFileSync(file, "utf8").split("\n").flatMap((line): SessionRuntimeEvent[] => {
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
    let lastRequest = -1;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].stage === "user.request") {
        lastRequest = index;
        break;
      }
    }
    return lastRequest >= 0 ? events.slice(lastRequest) : events;
  }
  setAutoLoadedSkills(id: string, skills: string[]): void {
    const session = this.get(id);
    session.autoLoadedSkills = [...new Set(skills)];
    session.meta.updatedAt = new Date().toISOString();
    this.writeSession(session);
    this.writeIndex(this.readIndex().map((item) => item.id === id ? session.meta : item));
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
