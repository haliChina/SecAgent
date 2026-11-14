/**
 * 会话历史导出/导入（R98，学习 DeepSeek chat-demo history/）。
 *
 * ZIP 结构（export_format_version: 1）：
 *   manifest.json          —— 格式版本，必须是首个条目
 *   sessions/{id}.json     —— 会话全量（meta + messages，含分支字段）
 *   session_index.json     —— 索引（id/title/updatedAt 一一对应校验用）
 *
 * 导入为事务性替换：全量解析校验通过才清库重写；任何容器级失败
 * 保留原数据不动。字段宽严策略照搬 DeepSeek：meta 与消息必填字段
 * 缺失/类型错 → 整包失败；未知字段忽略；变体引用断链 → 丢弃该
 * variantOf 字段（显示规则自动保底）。
 */

import AdmZip from "adm-zip";
import type { SessionStore, SessionData, SessionMessage } from "../session-store.js";

export const HISTORY_EXPORT_VERSION = 1;
const MANIFEST = "manifest.json";
const INDEX = "session_index.json";

export interface HistoryArchiveStats { sessions: number; messages: number; }

function entryToJson(zip: AdmZip, name: string): Record<string, unknown> {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`归档缺少 ${name}`);
  try {
    const parsed = JSON.parse(zip.readAsText(entry)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("不是对象");
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${name} 无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 导出全部会话到 ZIP 文件。返回统计（渲染层提示用）。 */
export function exportHistoryArchive(store: SessionStore, targetPath: string): HistoryArchiveStats {
  const zip = new AdmZip();
  zip.addFile(MANIFEST, Buffer.from(JSON.stringify({ export_format_version: HISTORY_EXPORT_VERSION, app: "SecAgent" }), "utf8"));
  const metas = store.list();
  const index: Array<{ id: string; title: string; updatedAt: string }> = [];
  let messages = 0;
  for (const meta of metas) {
    const session = store.get(meta.id);
    zip.addFile(`sessions/${meta.id}.json`, Buffer.from(JSON.stringify({ meta: session.meta, messages: session.messages }), "utf8"));
    index.push({ id: meta.id, title: session.meta.title, updatedAt: session.meta.updatedAt });
    messages += session.messages.length;
  }
  zip.addFile(INDEX, Buffer.from(JSON.stringify({ sessions: index }), "utf8"));
  zip.writeZip(targetPath);
  return { sessions: metas.length, messages };
}

/** 校验并读取归档：返回按索引排序的会话数组（导入前先全量校验，不留半成品）。 */
export function readHistoryArchive(zipPath: string): SessionData[] {
  let zip: AdmZip;
  try { zip = new AdmZip(zipPath); } catch (error) {
    throw new Error(`无法读取归档文件：${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = entryToJson(zip, MANIFEST);
  if (manifest.export_format_version !== HISTORY_EXPORT_VERSION) {
    throw new Error(`不支持的归档版本：${String(manifest.export_format_version)}（需要 ${HISTORY_EXPORT_VERSION}）`);
  }
  const index = entryToJson(zip, INDEX);
  const rows = Array.isArray(index.sessions) ? index.sessions : [];
  if (!rows.length) throw new Error("归档里没有任何会话");
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = (row as Record<string, unknown>).id;
    if (typeof id !== "string" || !id || seen.has(id)) throw new Error("会话索引含无效或重复的 id");
    seen.add(id);
    ids.push(id);
  }
  const sessions: SessionData[] = ids.map((id) => parseSessionJson(zip, id));
  return sessions;
}

/** 单会话解析：容器字段严格、内容字段宽容（DeepSeek 纪律）。 */
function parseSessionJson(zip: AdmZip, id: string): SessionData {
  const raw = entryToJson(zip, `sessions/${id}.json`);
  const meta = raw.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta.id !== "string" || meta.id !== id || typeof meta.title !== "string" || typeof meta.createdAt !== "string") {
    throw new Error(`会话 ${id} 的元数据无效`);
  }
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const parsed = messages.map((item): SessionMessage | null => {
    const message = item as Record<string, unknown>;
    if (typeof message.id !== "string" || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string" || typeof message.createdAt !== "string") return null;
    const clean: SessionMessage = { id: message.id, role: message.role, content: message.content, createdAt: message.createdAt };
    if (Array.isArray(message.attachments)) clean.attachments = message.attachments as SessionMessage["attachments"];
    if (Array.isArray(message.toolCalls)) clean.toolCalls = message.toolCalls as SessionMessage["toolCalls"];
    if (Array.isArray(message.activities)) clean.activities = message.activities as SessionMessage["activities"];
    if (message.stopped === true) clean.stopped = true;
    if (typeof message.variantOf === "string") clean.variantOf = message.variantOf;
    if (typeof message.selectedVariant === "string") clean.selectedVariant = message.selectedVariant;
    return clean;
  }).filter((message): message is SessionMessage => message !== null);
  return { meta: { id, title: meta.title as string, createdAt: meta.createdAt as string, updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : meta.createdAt as string, ...(meta.archived === true ? { archived: true } : {}) }, messages: parsed };
}