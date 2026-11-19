/**
 * sessions/工具确认/设置保存 IPC 域（B3 真源重写）。
 *
 * 本文件只剩注册 + 参数校验 + 纯委托：
 * - 会话运行编排 → session-run.ts（runSession/stopSession/normalizeAttachments）
 * - 敏感工具确认闸门 → tool-confirm.ts
 * - settings:save 编排 → settings-apply.ts
 * 跨域依赖（pluginManager/广播/更新管理器）经 deps 注入。
 */
import { ipcMain , dialog } from "electron";
import { readSettings, type SettingsPayload } from "../config.js";
import { DEFAULT_WORKSPACE } from "../paths.js";
import { SessionStore, type SessionData } from "../session-store.js";
import { hashIdentifier } from "../telemetry.js";
import { exportHistoryArchive, readHistoryArchive } from "./history-archive.js";
import { logMain } from "./main-log.js";
import { getTelemetry } from "./main-telemetry.js";
import { applySettings } from "./settings-apply.js";
import { normalizeAttachments, runSession, stopSession } from "./session-run.js";
import { confirmSensitiveToolCall, resolveToolConfirmation } from "./tool-confirm.js";
import type { PluginManager } from "../plugin-manager.js";
import type { WindowsUpdateManager } from "./update-manager.js";
import type { ReasoningEffort } from "../types.js";
import type { ToolConfirmWindowHooks } from "./tool-confirm.js";

interface SessionIpcDeps {
  getPluginManager: () => PluginManager | undefined;
  sendToAppWindows: (channel: string, payload: unknown) => void;
  getUpdateManager: () => WindowsUpdateManager | undefined;
  /** R57：敏感工具确认的窗口回调（唤起/让出前台）。 */
  toolConfirmWindowHooks?: ToolConfirmWindowHooks;
}

/** R87：渲染进程只拿“骨架”附件；真正图片在可见时走 sessions:attachment。 */
function stripAttachmentData(session: SessionData): SessionData {
  if (!session.messages.some((message) => message.attachments?.length)) return session;
  return {
    ...session,
    messages: session.messages.map((message) => message.attachments?.length
      ? { ...message, attachments: message.attachments.map((attachment) => ({ ...attachment, dataUrl: "" })) }
      : message)
  };
}

export function registerSessionsIpc(deps: SessionIpcDeps): void {
  const { sendToAppWindows } = deps;

  function store(): SessionStore { return new SessionStore(DEFAULT_WORKSPACE); }
  /* sessions:list：复用同一个 store 实例，避免每个会话各 new 一次 SessionStore
     再逐个同步读盘（N+1）。previewOf 内部仍逐文件读——会话数大时可再做批量化。 */
  ipcMain.handle("sessions:list", () => { logMain("ipc.sessions.list"); const sessionStore = store(); return sessionStore.list(); });
  ipcMain.handle("sessions:create", () => { const session = store().create(); logMain("ipc.sessions.create", { sessionId: session.meta.id }); return stripAttachmentData(session); });
  ipcMain.handle("sessions:delete", (_event, id: string) => { store().delete(id); logMain("ipc.sessions.delete", { sessionId: id }); return store().list(); });
  ipcMain.handle("sessions:archive", (_event, id: string, archived: boolean) => {
    store().setArchived(id, archived === true);
    return { ok: true };
  });
  /* R68 会话重命名：store.setTitle 同步 SQLite 中的标题与 updated_at。 */
  ipcMain.handle("sessions:rename", (_event, id: string, title: string) => {
    if (typeof title !== "string" || !title.trim() || title.trim().length > 60) throw new Error("标题必须为 1-60 个字符");
    const session = store().setTitle(id, title.trim());
    logMain("ipc.sessions.rename", { sessionId: id });
    return stripAttachmentData(session);
  });

  ipcMain.handle("sessions:get", (_event, id: string) => { logMain("ipc.sessions.get", { sessionId: id }); return stripAttachmentData(store().get(id)); });
  ipcMain.handle("sessions:attachment", (_event, sessionId: string, messageId: string, attachmentId: string) => {
    if (typeof sessionId !== "string" || typeof messageId !== "string" || typeof attachmentId !== "string") throw new Error("附件参数无效");
    const dataUrl = store().attachmentDataUrl(sessionId, messageId, attachmentId);
    if (!dataUrl) throw new Error("附件不存在或已清理");
    return dataUrl;
  });
  ipcMain.handle("sessions:runtime-events", (_event, id: string) => { logMain("ipc.sessions.runtime-events", { sessionId: id }); return store().getRuntimeEvents(id).map((item) => ({ sessionId: id, ...item })); });
  ipcMain.handle("sessions:diagnostic-upload", async (_event, id: string) => {
    if (!getTelemetry()?.isEnabled()) throw new Error("请先在设置中开启匿名诊断数据上传");
    const sessionStore = store();
    const result = await getTelemetry()!.uploadDiagnostic(sessionStore.get(id), sessionStore.getRuntimeEvents(id));
    logMain("telemetry.diagnostic.uploaded", { sessionId: hashIdentifier(id), bytes: result.bytes });
    return result;
  });

  ipcMain.handle("runtime:tool-confirmation-reply", (_event, payload: { confirmationId: string; approved: boolean; always?: boolean }) => {
    return resolveToolConfirmation(payload);
  });

  ipcMain.handle("settings:save", (_event, payload: SettingsPayload) => {
    return applySettings(payload, { sendToAppWindows, getUpdateManager: deps.getUpdateManager });
  });

  ipcMain.handle("sessions:stop", (_event, id: string) => {
    return stopSession(id);
  });

  ipcMain.handle("sessions:send", async (event, id: string, text: string, modelId?: string, reasoningEffort: ReasoningEffort = "high", rawAttachments?: unknown) => {
    const attachments = normalizeAttachments(rawAttachments);
    if (typeof text !== "string" || (!text.trim() && !attachments.length)) throw new Error("消息不能为空");
    const result = await runSession(deps, id, text, { modelId, reasoningEffort, attachments, senderId: event.sender.id });
    return result ? stripAttachmentData(result) : result;
  });

  /* R98 重新生成：复用 sessions:send 的运行管线，但以历史中该消息对应的
     提问重跑（不追加新 user 消息），新回复作为变体落库。 */
  ipcMain.handle("sessions:regenerate", async (event, id: string, messageId: string, modelId?: string, reasoningEffort: ReasoningEffort = "high") => {
    if (typeof id !== "string" || typeof messageId !== "string") throw new Error("参数无效");
    const result = await runSession(deps, id, "", { modelId, reasoningEffort, attachments: [], senderId: event.sender.id, regenerate: { messageId } });
    return result ? stripAttachmentData(result) : result;
  });

  /* R98 历史导出/导入（学习 DeepSeek chat-demo）：ZIP 归档 + 事务性替换。 */
  ipcMain.handle("sessions:export-history", async () => {
    const target = await dialog.showSaveDialog({ title: "导出会话历史", defaultPath: `secagent-history-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: "会话历史归档", extensions: ["zip"] }] });
    if (target.canceled || !target.filePath) return { canceled: true as const };
    return { canceled: false as const, ...exportHistoryArchive(store(), target.filePath) };
  });
  ipcMain.handle("sessions:import-history", async () => {
    const picked = await dialog.showOpenDialog({ title: "导入会话历史", filters: [{ name: "会话历史归档", extensions: ["zip"] }], properties: ["openFile"] });
    if (picked.canceled || !picked.filePaths[0]) return { canceled: true as const };
    const parsed = readHistoryArchive(picked.filePaths[0]);
    store().replaceAllSessions(parsed);
    return { canceled: false as const, sessions: parsed.length, messages: parsed.reduce((sum, session) => sum + session.messages.length, 0) };
  });

  /* R98 版本切换：更新组显示状态（渲染层按 visibleMessages 过滤）。 */
  ipcMain.handle("sessions:select-variant", (_event, id: string, groupId: string, targetId?: string) => {
    if (typeof id !== "string" || typeof groupId !== "string") throw new Error("参数无效");
    const result = store().setVariantSelection(id, groupId, typeof targetId === "string" && targetId ? targetId : undefined);
    return result ? stripAttachmentData(result) : result;
  });
}
