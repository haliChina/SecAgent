/**
 * 会话运行域真源（B3 自 ipc-sessions.ts 拆出）。
 *
 * sessions:send 的完整业务编排：trace 管线（activities/toolCalls
 * 聚合 + telemetry + 广播）、标题生成、错误分类、唤醒请求特化、
 * 运行中止注册表。IPC 层只做参数校验与纯委托。逻辑逐字搬运自
 * B2-d2 版 ipc-sessions.ts，行为零变化。
 */
import { DEFAULT_WORKSPACE } from "../paths.js";
import { loadConfig, useConfiguredModel, resolveVisionAgentConfig } from "../config.js";
import { AuditStore } from "../audit.js";
import { SecAgentRuntime, type TraceEvent } from "../runtime.js";
import { generateSessionTitle } from "../session-title.js";
import { normalizeReasoningEffort } from "../reasoning.js";
import { SessionStore, type AssistantActivity, type SessionData, type ToolCallRecord } from "../session-store.js";
import { loadEnabledSkills } from "../skills.js";
import { hashIdentifier } from "../telemetry.js";
import { logMain } from "./main-log.js";
import { getTelemetry, recordTelemetryFailure } from "./main-telemetry.js";
import { isWakeSender, setWakeAbortController, clearWakeAbortController } from "./wake.js";
import { confirmSensitiveToolCall } from "./tool-confirm.js";
import type { PluginManager } from "../plugin-manager.js";
import type { ChatAttachment, ReasoningEffort } from "../types.js";
import type { ConversationMessage } from "../model-provider.js";

interface SessionRunDeps {
  getPluginManager: () => PluginManager | undefined;
  sendToAppWindows: (channel: string, payload: unknown) => void;
}

interface SessionRunOptions {
  modelId?: string;
  reasoningEffort: ReasoningEffort;
  attachments: ChatAttachment[];
  senderId: number;
}

const activeSessionRuns = new Map<string, AbortController>();

function store(): SessionStore { return new SessionStore(DEFAULT_WORKSPACE); }

export function stopSession(id: string): { ok: true; stopped: boolean } {
  const controller = activeSessionRuns.get(id);
  if (!controller) return { ok: true, stopped: false };
  controller.abort();
  return { ok: true, stopped: true };
}

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

export function normalizeAttachments(value: unknown): ChatAttachment[] {
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

export async function runSession(deps: SessionRunDeps, id: string, text: string, options: SessionRunOptions): Promise<SessionData | undefined> {
  const { senderId, modelId, reasoningEffort, attachments } = options;
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
  const isWakeRequest = isWakeSender(senderId);
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
    deps.sendToAppWindows("sessions:runtime-event", { sessionId: id, ...ordered });
  };
  try {
    logMain("ipc.sessions.send", { sessionId: id, text });
    trace({ stage: "user.request", data: { text } });
    const skills = [...loadEnabledSkills(config), ...(deps.getPluginManager()?.getSkills() || [])];
    const runtimeConfig = isWakeRequest
      ? { ...config, agent: { ...config.agent, systemPrompt: `${config.agent.systemPrompt}\n\n## 快速唤起输出协议\n${QUICK_WAKE_OUTPUT_PROMPT}` } }
      : config;
    runtime = new SecAgentRuntime(runtimeConfig, audit, skills, trace, deps.getPluginManager(), { confirmToolCall: (confirmation) => confirmSensitiveToolCall(id, confirmation, deps.sendToAppWindows) });
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
}
