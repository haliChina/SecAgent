/**
 * sessions/工具确认/设置保存 IPC 域（B2-d2 自 main.ts 拆出，纯搬家）。
 *
 * 会话读写 + 模型运行主管道（sessions:send 核心循环）+ 敏感工具
 * 确认闸门 + settings:save（含 wake 快捷键联动/回滚）。跨域依赖
 * （pluginManager/wake 判定/广播/更新管理器）经 deps 注入。
 */
import fs from "node:fs";
import { ipcMain, globalShortcut } from "electron";
import YAML from "yaml";
import { configPath, loadConfig, readSettings, saveSettings, useConfiguredModel, resolveVisionAgentConfig, type SettingsPayload } from "../config.js";
import { DEFAULT_WORKSPACE } from "../paths.js";
import { AuditStore } from "../audit.js";
import { SecAgentRuntime, type TraceEvent } from "../runtime.js";
import { generateSessionTitle } from "../session-title.js";
import { normalizeReasoningEffort } from "../reasoning.js";
import { SessionStore, type AssistantActivity, type SessionData, type ToolCallRecord } from "../session-store.js";
import { loadEnabledSkills } from "../skills.js";
import { DEFAULT_WAKE_HOTKEY, normalizeWakeHotkey } from "../wake-hotkey.js";
import { officialProvider } from "./ipc-official.js";
import { logMain } from "./main-log.js";
import { getTelemetry, initializeSentry, recordTelemetryFailure, setSentryTelemetryEnabled } from "./main-telemetry.js";
import { hashIdentifier } from "../telemetry.js";
import { readAutostart, writeAutostart } from "./autostart.js";
import { configureSpeech } from "./speech.js";
import { configureTts } from "./tts.js";
import { clearWakeAbortController, closeVoiceWakeWindow, getActiveWakeShortcut, isWakeSender, openWakeWindow, setActiveWakeShortcut, setWakeAbortController, startConfiguredVoiceWake } from "./wake.js";
import type { PluginManager } from "../plugin-manager.js";
import type { WindowsUpdateManager } from "./update-manager.js";
import type { ChatAttachment, ReasoningEffort } from "../types.js";
import type { ConversationMessage } from "../model-provider.js";

export interface SessionIpcDeps {
  getPluginManager: () => PluginManager | undefined;
  sendToAppWindows: (channel: string, payload: unknown) => void;
  getUpdateManager: () => WindowsUpdateManager | undefined;
}

export function registerSessionsIpc(deps: SessionIpcDeps): void {
  const { getPluginManager, sendToAppWindows, getUpdateManager } = deps;
  const activeSessionRuns = new Map<string, AbortController>();

function store(): SessionStore { return new SessionStore(DEFAULT_WORKSPACE); }

function classifyAgentFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/empty|invalid|malformed.*response|empty response|空响应|返回为空|模型返回|格式错误/i.test(message)) return "model.response.invalid";
  if (/timeout|timed out|超时/i.test(message)) return "model.timeout";
  if (/401|403|unauthorized|forbidden|密钥|token|认证/i.test(message)) return "model.auth_failed";
  if (/429|rate.?limit|限流/i.test(message)) return "model.rate_limited";
  if (/mcp|工具发现|discovery/i.test(message)) return "mcp.discovery.failed";
  if (/tool|工具|插件/i.test(message)) return "tool.call.failed";
  if (/模型|model|endpoint|连接|connect|network|fetch/i.test(message)) return "model.request.failed";
  return "agent.run.failed";
}

function historyInput(session: SessionData, current: string): string {
  const history = session.messages.slice(-20).map((message) => `${message.role === "user" ? "教师" : "SecAgent"}：${message.content}`).join("\n");
  return history ? `以下是当前会话的历史，请结合上下文理解最后一条新消息。\n\n${history}\n\n教师的新消息：${current}` : current;
}

function conversationInput(session: SessionData, current: string, attachments: ChatAttachment[] = []): ConversationMessage[] {
  const history = session.messages.slice(-20).map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.toolCalls?.length ? {
      toolCalls: message.toolCalls.map((call, index) => ({
        id: `history-${message.id}-${index}`,
        name: call.name,
        arguments: call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : {},
        ...(call.result !== undefined ? { result: call.result } : {})
      }))
    } : {})
  }));
  // Anthropic requires a conversation to start with a user turn. A 20-message window can
  // otherwise start at an assistant turn when older messages were truncated.
  if (history[0]?.role === "assistant") history.shift();
  return [
    ...history,
    { role: "user", content: current, ...(attachments.length ? { attachments } : {}) }
  ];
}

const QUICK_WAKE_OUTPUT_PROMPT = `这是一次快速唤起请求。最终回答必须严格以 XML 标签块开头：<tts listen_after="true|false">简短的一句话</tts>。如果你的回答是一个问题、需要用户继续回答或确认，就设置 listen_after="true"；如果回答结束后不需要继续聆听，就设置 listen_after="false"。标签内只写给用户朗读的简短口语，不要 Markdown、代码、列表、链接、表格或复杂标点，尽量简洁。必须先完整输出并闭合 <tts> 标签，再输出给屏幕显示的正式回答；正式回答不要重复 TTS 文本。`;

function normalizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ChatAttachment[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<ChatAttachment>;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.mimeType !== "string" || !candidate.mimeType.startsWith("image/") || typeof candidate.dataUrl !== "string" || !candidate.dataUrl.startsWith("data:image/")) return [];
    const size = typeof candidate.size === "number" && Number.isFinite(candidate.size) ? candidate.size : 0;
    if (size > 12 * 1024 * 1024 || candidate.dataUrl.length > 16 * 1024 * 1024) return [];
    return [{ id: candidate.id, name: candidate.name, mimeType: candidate.mimeType, dataUrl: candidate.dataUrl, size }];
  }).slice(0, 4);
}

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
const pendingToolConfirmations = new Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }>();
let toolConfirmationSeq = 0;

/** Pause the agent until the user approves a sensitive tool call (Codex-style). */
function confirmSensitiveToolCall(sessionId: string, confirmation: { tool: string; arguments: Record<string, unknown>; reason: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmationId = `tool-confirm-${++toolConfirmationSeq}`;
    const timer = setTimeout(() => {
      pendingToolConfirmations.delete(confirmationId);
      logMain("tool.confirm.timeout", { confirmationId });
      resolve(false);
    }, 5 * 60_000);
    pendingToolConfirmations.set(confirmationId, { resolve, timer });
    logMain("tool.confirm.request", { confirmationId, sessionId, tool: confirmation.tool });
    sendToAppWindows("runtime:tool-confirmation", { confirmationId, sessionId, ...confirmation });
  });
}

ipcMain.handle("runtime:tool-confirmation-reply", (_event, payload: { confirmationId: string; approved: boolean; always?: boolean; signature?: string }) => {
  const pending = pendingToolConfirmations.get(payload.confirmationId);
  if (!pending) return { ok: false, error: "确认请求已过期" };
  pendingToolConfirmations.delete(payload.confirmationId);
  clearTimeout(pending.timer);
  if (payload.approved && payload.always && payload.signature) appendGuardApproval(payload.signature);
  logMain("tool.confirm.reply", { confirmationId: payload.confirmationId, approved: payload.approved, always: Boolean(payload.always) });
  pending.resolve(payload.approved);
  return { ok: true };
});

/** Persist a "不再提示" approval straight into the yaml without a full settings rewrite. */
function appendGuardApproval(signature: string): void {
  try {
    const file = configPath(DEFAULT_WORKSPACE);
    const raw = YAML.parse(fs.readFileSync(file, "utf8")) as { guard?: { approved?: string[] } };
    const approved = new Set(raw?.guard?.approved || []);
    approved.add(signature);
    raw.guard = { ...(raw.guard || {}), approved: [...approved] };
    fs.writeFileSync(file, YAML.stringify(raw), "utf8");
  } catch (error) {
    logMain("tool.confirm.persist.failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

ipcMain.handle("settings:save", (_event, payload: SettingsPayload) => {
  const customModelMode = Boolean(payload?.customModelMode);
  let providers = Array.isArray(payload?.providers) ? payload.providers : [];
  if (!customModelMode) {
    // 自定义模型模式关闭：自定义供应商不生效，仅保留官方服务；必须登录才能使用。
    providers = providers.filter((provider) => provider.id === "sectl-official");
    if (!providers.length) {
      const baseUrl = (process.env.SECTL_OFFICIAL_API_URL || "").replace(/\/$/, "");
      if (!baseUrl) throw new Error("自定义模型模式已关闭：请先配置 SECTL_OFFICIAL_API_URL 或登录 SecAgent 官方服务");
      providers = [officialProvider(baseUrl)];
    }
  }
  const nextWakeHotkey = normalizeWakeHotkey(payload.wake?.hotkey || DEFAULT_WAKE_HOTKEY);
  const previousWakeHotkey = getActiveWakeShortcut();
  const wakeShortcutChanged = previousWakeHotkey !== nextWakeHotkey;
  let registeredNewShortcut = false;
  if (wakeShortcutChanged) {
    registeredNewShortcut = globalShortcut.register(nextWakeHotkey, () => { void openWakeWindow().catch((error) => logMain("wake.open.failed", { error: String(error) })); });
    if (!registeredNewShortcut) {
      if (previousWakeHotkey) throw new Error(`快捷键 ${nextWakeHotkey} 已被其它应用占用`);
      logMain("wake.hotkey.occupied", { hotkey: nextWakeHotkey });
    }
  }
  let saved: SettingsPayload;
  const previousAutostart = readAutostart();
  const nextAutostart = payload.autostart === true;
  const autostartChanged = previousAutostart !== nextAutostart;
  try {
    if (autostartChanged) writeAutostart(nextAutostart);
    saved = saveSettings(DEFAULT_WORKSPACE, { ...payload, providers, autostart: nextAutostart, wake: { hotkey: nextWakeHotkey, ...(payload.wake?.modelId ? { modelId: payload.wake.modelId } : {}), voiceEnabled: payload.wake?.voiceEnabled === true, voicePhrase: payload.wake?.voicePhrase } });
  } catch (error) {
    if (autostartChanged) {
      try { writeAutostart(previousAutostart); } catch { /* Keep the original save error visible. */ }
    }
    if (registeredNewShortcut) globalShortcut.unregister(nextWakeHotkey);
    throw error;
  }
  if (registeredNewShortcut) {
    if (previousWakeHotkey) globalShortcut.unregister(previousWakeHotkey);
    setActiveWakeShortcut(nextWakeHotkey);
  }
  setSentryTelemetryEnabled(saved.telemetry.enabled);
  initializeSentry();
  getTelemetry()?.setEnabled(saved.telemetry.enabled);
  // Apply the new speech-recognition preference (provider chain) immediately.
  configureSpeech(saved.speech);
  configureTts(saved.tts);
  sendToAppWindows("settings:changed", saved);
  deps.getUpdateManager()?.setPreferences(saved.updates);
  closeVoiceWakeWindow();
  if (saved.wake.voiceEnabled) void startConfiguredVoiceWake().catch((error) => {
    logMain("voice-wake.start.failed", { error: String(error) });
    recordTelemetryFailure({ type: "speech.failed", error, context: { phase: "voice-wake-start" } });
  });
  return saved;
});
ipcMain.handle("sessions:stop", (_event, id: string) => {
  const controller = activeSessionRuns.get(id);
  if (!controller) return { ok: true, stopped: false };
  controller.abort();
  return { ok: true, stopped: true };
});
ipcMain.handle("sessions:send", async (_event, id: string, text: string, modelId?: string, reasoningEffort: ReasoningEffort = "high", rawAttachments?: unknown) => {
  const attachments = normalizeAttachments(rawAttachments);
  if (typeof text !== "string" || (!text.trim() && !attachments.length)) throw new Error("消息不能为空");
  const sessionStore = store();
  const before = sessionStore.get(id);
  sessionStore.appendMessage(id, "user", text, undefined, undefined, attachments);
  const { workspace, config } = loadConfig(DEFAULT_WORKSPACE);
  useConfiguredModel(config, modelId);
  const requestedReasoningEffort: ReasoningEffort = ["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(reasoningEffort) ? reasoningEffort : "high";
  const selectedReasoningEffort = normalizeReasoningEffort(config.agent, requestedReasoningEffort);
  const audit = new AuditStore(workspace);
  const abortController = new AbortController();
  activeSessionRuns.set(id, abortController);
  let traceSequence = 0;
  const toolCalls: ToolCallRecord[] = [];
  const activities: AssistantActivity[] = [];
  let runtime: SecAgentRuntime | undefined;
  const isWakeRequest = isWakeSender(_event.sender.id);
  const shouldGenerateTitle = !before.messages.some((message) => message.role === "user");
  const preRule = await deps.getPluginManager()?.matchPreRule(text);
  const titlePromise = shouldGenerateTitle && !preRule
    ? generateSessionTitle(config, text, attachments, abortController.signal).catch((error) => {
      logMain("session.title.failed", { sessionId: id, error: error instanceof Error ? error.message : String(error) });
      return "";
    })
    : Promise.resolve("");
  if (isWakeRequest) setWakeAbortController(abortController);
  const trace = (event: Omit<TraceEvent, "sequence" | "at"> | TraceEvent) => {
    // The main process owns the sequence so its own request/error events and runtime events share
    // one strictly ordered timeline.
    const ordered: TraceEvent = { ...event, sequence: ++traceSequence, at: new Date().toISOString() };
    if (ordered.stage === "model.output.delta") {
      const data = ordered.data as { text?: unknown; kind?: unknown; turn?: unknown };
      const kind = data.kind === "thinking" || data.kind === "summary" ? data.kind : undefined;
      if (kind && typeof data.text === "string") {
        const last = activities.at(-1);
        if (last?.kind === kind) last.content += data.text;
        else activities.push({ kind, content: data.text, ...(typeof data.turn === "number" ? { turn: data.turn } : {}) });
      }
    }
    if (ordered.stage === "mcp.tools/call" || ordered.stage === "secagent.tools/call") {
      const data = ordered.data as { name?: unknown; arguments?: unknown };
      if (typeof data.name === "string") {
        toolCalls.push({ name: data.name, arguments: data.arguments ?? {} });
        activities.push({ kind: "tool", name: data.name, arguments: data.arguments ?? {} });
      }
    }
    if (ordered.stage === "secagent.skills/auto-load") {
      const skills = Array.isArray(ordered.data) ? ordered.data as Array<{ name?: unknown; path?: unknown }> : [];
      for (const skill of skills) if (typeof skill.name === "string" && typeof skill.path === "string") activities.push({ kind: "skill-auto-load", name: skill.name, path: skill.path });
    }
    if (ordered.stage === "mcp.tools/result" || ordered.stage === "secagent.tools/result") {
      const data = ordered.data as { name?: unknown; result?: unknown };
      if (typeof data.name === "string") {
        const call = [...toolCalls].reverse().find((item) => item.name === data.name && !("result" in item));
        if (call) call.result = data.result;
        const activity = [...activities].reverse().find((item): item is Extract<AssistantActivity, { kind: "tool" }> => item.kind === "tool" && item.name === data.name && !("result" in item));
        if (activity) activity.result = data.result;
      }
    }
    sessionStore.appendRuntimeEvent(id, ordered);
    getTelemetry()?.addBreadcrumb(ordered);
    const data = ordered.data && typeof ordered.data === "object" ? ordered.data as Record<string, unknown> : {};
    if (ordered.stage === "mcp.tools/error") recordTelemetryFailure({ type: "mcp.discovery.failed", context: { sessionId: hashIdentifier(id), stage: ordered.stage } });
    if ((ordered.stage === "mcp.tools/result" || ordered.stage === "secagent.tools/result") && data.result && typeof data.result === "object" && "error" in (data.result as Record<string, unknown>)) {
      recordTelemetryFailure({ type: "tool.call.failed", error: new Error("tool returned an error"), context: { sessionId: hashIdentifier(id), tool: typeof data.name === "string" ? data.name : undefined } });
    }
    if (ordered.stage === "model.response" && typeof data.status === "number" && data.status >= 400) {
      recordTelemetryFailure({ type: data.status === 408 || data.status === 504 ? "model.timeout" : data.status === 429 ? "model.rate_limited" : data.status === 401 || data.status === 403 ? "model.auth_failed" : data.status === 400 ? "model.response.invalid" : "model.request.failed", context: { sessionId: hashIdentifier(id), status: data.status } });
    }
    logMain("session.runtime", { sessionId: id, ...ordered });
    sendToAppWindows("sessions:runtime-event", { sessionId: id, ...ordered });
  };
  try {
    logMain("ipc.sessions.send", { sessionId: id, text });
    trace({ stage: "user.request", data: { text } });
    const skills = [...loadEnabledSkills(config), ...(deps.getPluginManager()?.getSkills() || [])];
    const runtimeConfig = isWakeRequest
      ? { ...config, agent: { ...config.agent, systemPrompt: `${config.agent.systemPrompt}\n\n## 快速唤起输出协议\n${QUICK_WAKE_OUTPUT_PROMPT}` } }
      : config;
    runtime = new SecAgentRuntime(runtimeConfig, audit, skills, trace, deps.getPluginManager(), { confirmToolCall: (confirmation) => confirmSensitiveToolCall(id, confirmation) });
    const visionConfig = resolveVisionAgentConfig(config);
    if (visionConfig) logMain("session.vision-model", { model: visionConfig.agent.model, provider: visionConfig.agent.provider, baseUrl: visionConfig.agent.baseUrl });
    const previousReadSkillNames = before.messages.flatMap((message) => message.toolCalls || []).filter((call) => call.name === "secagent__read_skill" || call.name === "read_skill").map((call) => typeof (call.arguments as { name?: unknown })?.name === "string" ? (call.arguments as { name: string }).name : "");
    const result = await runtime.run(historyInput(before, text), selectedReasoningEffort, conversationInput(before, text, attachments), abortController.signal, { previousAutoLoadedSkills: before.autoLoadedSkills, previousReadSkillNames, preRule, sessionId: id });
    if (result.autoLoadedSkills?.length) {
      const current = sessionStore.get(id);
      current.autoLoadedSkills = [...new Set([...(current.autoLoadedSkills || []), ...result.autoLoadedSkills])];
      // Reuse the store's normal persistence path without adding a visible message.
      sessionStore.setAutoLoadedSkills(id, current.autoLoadedSkills);
    }
    // Surface resilience findings inline; hallucination reports are persisted
    // as a structured field on the message so the renderer renders a proper
    // notice strip (GuardrailNotice) instead of appending markdown text.
    let finalMessage = result.message;
    if ("usedFallbackModels" in result && result.usedFallbackModels?.length) finalMessage += `\n\n> ⚙️ 模型稳定性：已自动切换备用模型（${result.usedFallbackModels.join(" → ")}），原模型暂时不可用。`;
    sessionStore.appendMessage(id, "assistant", finalMessage, toolCalls, activities, undefined, false, "hallucination" in result && result.hallucination?.signals.length ? result.hallucination : undefined);
    const title = await titlePromise;
    if (title) sessionStore.setTitle(id, title);
    trace({ stage: "assistant.response", data: { text: result.message } });
    return sessionStore.get(id);
  } catch (error) {
    const title = await titlePromise;
    if (title) sessionStore.setTitle(id, title);
    if (abortController.signal.aborted) {
      sessionStore.appendMessage(id, "assistant", "", toolCalls, activities, undefined, true);
      trace({ stage: "runtime.stopped", data: { toolCount: toolCalls.length } });
      return sessionStore.get(id);
    }
    const message = `执行失败：${error instanceof Error ? error.message : String(error)}`;
    sessionStore.appendMessage(id, "assistant", message, toolCalls, activities);
    trace({ stage: "runtime.error", data: { message } });
    recordTelemetryFailure({ type: classifyAgentFailure(error), error, context: { sessionId: hashIdentifier(id), model: config.agent.model, provider: config.agent.provider, inputLength: text.length, attachmentCount: attachments.length, toolCount: toolCalls.length } });
    return sessionStore.get(id);
  } finally {
    if (activeSessionRuns.get(id) === abortController) activeSessionRuns.delete(id);
    clearWakeAbortController(abortController);
    await runtime?.close().catch(() => undefined);
    audit.close();
  }
});

// A second launch focuses the running instance instead of competing for the
// wake shortcut, the tray, and the local HTTP server port.
}
