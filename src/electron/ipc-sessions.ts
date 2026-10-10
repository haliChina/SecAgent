/**
 * sessions/工具确认/设置保存 IPC 域（B3 真源重写）。
 *
 * 本文件只剩注册 + 参数校验 + 纯委托：
 * - 会话运行编排 → session-run.ts（runSession/stopSession/normalizeAttachments）
 * - 敏感工具确认闸门 → tool-confirm.ts
 * - settings:save 编排 → settings-apply.ts
 * 跨域依赖（pluginManager/广播/更新管理器）经 deps 注入。
 */
import { ipcMain } from "electron";
import { readSettings, type SettingsPayload } from "../config.js";
import { DEFAULT_WORKSPACE } from "../paths.js";
import { SessionStore } from "../session-store.js";
import { hashIdentifier } from "../telemetry.js";
import { logMain } from "./main-log.js";
import { getTelemetry } from "./main-telemetry.js";
import { applySettings } from "./settings-apply.js";
import { normalizeAttachments, runSession, stopSession } from "./session-run.js";
import { confirmSensitiveToolCall, resolveToolConfirmation } from "./tool-confirm.js";
import type { PluginManager } from "../plugin-manager.js";
import type { WindowsUpdateManager } from "./update-manager.js";
import type { ReasoningEffort } from "../types.js";

interface SessionIpcDeps {
  getPluginManager: () => PluginManager | undefined;
  sendToAppWindows: (channel: string, payload: unknown) => void;
  getUpdateManager: () => WindowsUpdateManager | undefined;
}

export function registerSessionsIpc(deps: SessionIpcDeps): void {
  const { sendToAppWindows } = deps;

  function store(): SessionStore { return new SessionStore(DEFAULT_WORKSPACE); }
  const sessionPreview = (id: string): string => { try { return store().previewOf(id); } catch { return ""; } };

  ipcMain.handle("sessions:list", () => { logMain("ipc.sessions.list"); return store().list().map((meta) => ({ ...meta, preview: sessionPreview(meta.id) })); });
  ipcMain.handle("sessions:create", () => { const session = store().create(); logMain("ipc.sessions.create", { sessionId: session.meta.id }); return session; });
  ipcMain.handle("sessions:delete", (_event, id: string) => { store().delete(id); logMain("ipc.sessions.delete", { sessionId: id }); return store().list(); });
  ipcMain.handle("sessions:get", (_event, id: string) => { logMain("ipc.sessions.get", { sessionId: id }); return store().get(id); });
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
    return runSession(deps, id, text, { modelId, reasoningEffort, attachments, senderId: event.sender.id });
  });

// A second launch focuses the running instance instead of competing for the
// wake shortcut, the tray, and the local HTTP server port.
}
