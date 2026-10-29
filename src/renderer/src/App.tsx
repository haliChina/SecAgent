import { ACCENT, ACCENT_SKY, ACCENT_DEEP } from "./components/ui/parts/theme.js";
import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { LoaderCircle, Volume2 } from "lucide-react";
import { SettingsApp } from "./components/SettingsApp.js";
import { WindowErrorBoundary } from "./components/ErrorBoundary.js";
import { WakeOverlay } from "./components/WakeOverlay.js";
import { VoiceWakeListener } from "./components/VoiceWakeListener.js";
import { MessageActivities } from "./components/MessageActivities.js";
import { AttachmentStrip } from "./components/AttachmentStrip.js";
import { MarkdownContent } from "./components/MarkdownContent.js";
import { WorkspaceFileStrip } from "./components/WorkspaceFileStrip.js";
import { stripWorkspaceFilesMarkup } from "../../workspace-file-contract.js";
import { reasoningEffortLabels } from "./constants.js";
import type { TraceEvent } from "./constants.js";
import { isOfficialModel, isOfficialTierModel, isOfficialVisionModel, reasoningEffortsForModel, toolTitle } from "./utils.js";
import { officialTiers, tierDefaultId } from "./constants.js";
import { buildQuotedUserMessage, webSearchUrl } from "../../quoted-message.js";
import { selectionInElement, copyText, UserQuotedContent } from "./components/MessageQuoted.js";
import { ToolConfirmationDialog } from "./components/ToolConfirmationDialog.js";
import { TracePanel } from "./components/TracePanel.js";
import { DeliverableCard } from "./components/DeliverableCard.js";
import { SessionSidebar } from "./components/SessionSidebar.js";
import { AiStatus, AuroraBackdrop, DaySeparator, DeleteButton, FluidOrb, MatrixOrb, PromptBar, ScrollProgress, ThoughtLine, VoicePill, AuiGuardrailNotice, AuiMessageActions, AuiErrorState, AuiStoppedRun, WebSearch, type WebSource, daySeparatorId, daySeparatorLabel } from "./components/ui/Bits.js";

/** web_search 工具结果 → rare-ui WebSearch 组件的 WebSource 归一化
 * （兼容 BigModel search_result 与 DeepSeek results 两种载荷）。 */
/* R65：sources 的 React key 此前是「调用内 index」——同一消息多次调用 web_search
   合并后 key 大量重复（两次调用都产 "0","1","2"…），popLayout 下 exit/enter 竞态，
   这就是「show less 只收回部分、再 show more 卡片越叠越多」的根因。
   现在的 id 带上调用序号与 URL，保证全局唯一且跨渲染稳定。 */
function normalizeWebSearchSources(result: unknown, callIndex = 0): WebSource[] {
  /* R64：runWebSearch 返回 { provider, query, hits }（hits 才是结果数组），
     此前只认 results → 恒空 → 「Searched 0 sites」。兼容三种形状：
     裸数组 / { results }（MCP 类工具）/ { hits }（自研 web_search）。 */
  const source = result && typeof result === "object" && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
  const list: unknown[] = Array.isArray(result) ? result : source && Array.isArray(source.results) ? source.results : source && Array.isArray(source.hits) ? source.hits : [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item, index) => ({
    id: `${callIndex}:${index}:${String(item.url ?? item.link ?? "")}`,
    title: String(item.title ?? "无标题"),
    url: String(item.url ?? item.link ?? ""),
    snippet: typeof item.snippet === "string" ? item.snippet : typeof item.content === "string" ? String(item.content).slice(0, 200) : undefined,
    favicon: typeof item.favicon === "string" ? item.favicon : typeof item.site_icon === "string" ? String(item.site_icon) : typeof item.siteIcon === "string" ? String(item.siteIcon) : undefined,
  })).filter((source) => source.url);
}

function webSearchSourcesFor(toolCalls: { name: string; result?: unknown }[] | undefined): WebSource[] {
  return (toolCalls || []).filter((call) => call.name === "web_search").flatMap((call, callIndex) => normalizeWebSearchSources(call.result, callIndex));
}

/* R65：正文引用——assistant 回答里的 [1] [2] 标注替换为指向对应搜索结果的
   markdown 链接（rareui 演示同款「回答有引用」体验）。围栏代码块内不替换。 */
function citationify(content: string, sources: WebSource[]): string {
  if (!sources.length) return content;
  return content.split(/(```[\s\S]*?```)/g).map((part) => part.startsWith("```") ? part : part.replace(/\[(\d{1,2})\]/g, (match, digits: string) => {
    const source = sources[Number(digits) - 1];
    return source && /^https?:/i.test(source.url) ? `[${digits}](${source.url})` : match;
  })).join("");
}

type VoiceInputMode = "streaming" | "hold";
type VoiceDropAction = "send" | "cancel" | "edit";
type PendingVoiceSend = { messageId: string; sessionId: string };

export function App() {
  const bridge = window.secagent;
  const route = new URLSearchParams(window.location.search);
  if (route.has("settings")) return <WindowErrorBoundary crashTitle="设置页遇到错误" windowTitle="SecAgent设置"><SettingsApp /></WindowErrorBoundary>;
  if (route.has("wake")) return <WakeOverlay />;
  if (route.has("voice-wake")) return <VoiceWakeListener />;
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [session, setSession] = useState<SessionData | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const [composerDragging, setComposerDragging] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");
  const [defaultEffort, setDefaultEffort] = useState<ReasoningEffort>("high");
  const [customModelMode, setCustomModelMode] = useState(false);
  /* R59 多任务：运行态按会话记账（主进程 activeSessionRuns 本就按会话键控）。
     runningSessionIds/finishingSessionIds 驱动渲染；ref 镜像供异步闭包取新鲜值。
     旧的单一全局 sending/finishing 是"新会话出现老会话思考提示 + 停止按钮"
     串台的根因。 */
  const [runningSessionIds, setRunningSessionIds] = useState<string[]>([]);
  const [finishingSessionIds, setFinishingSessionIds] = useState<string[]>([]);
  const runningSessionsRef = useRef<string[]>([]);
  const finishingSessionsRef = useRef<string[]>([]);
  const markRunning = (id: string) => {
    if (!runningSessionsRef.current.includes(id)) { runningSessionsRef.current = [...runningSessionsRef.current, id]; setRunningSessionIds(runningSessionsRef.current); }
  };
  const markFinishing = (id: string) => {
    if (!finishingSessionsRef.current.includes(id)) { finishingSessionsRef.current = [...finishingSessionsRef.current, id]; setFinishingSessionIds(finishingSessionsRef.current); }
  };
  const clearRun = (id: string) => {
    runningSessionsRef.current = runningSessionsRef.current.filter((candidate) => candidate !== id);
    setRunningSessionIds(runningSessionsRef.current);
    finishingSessionsRef.current = finishingSessionsRef.current.filter((candidate) => candidate !== id);
    setFinishingSessionIds(finishingSessionsRef.current);
  };
  /** 视口当前会话是否在运行 / 在收尾；任意会话在运行（状态球、TracePanel 用）。 */
  const sessionRunning = Boolean(session && runningSessionIds.includes(session.meta.id));
  const sessionFinishing = Boolean(session && finishingSessionIds.includes(session.meta.id));
  const anyRunning = runningSessionIds.length > 0;
  const anyFinishing = finishingSessionIds.length > 0;
  const [recording, setRecording] = useState(false);
  const [speechProcessing, setSpeechProcessing] = useState(false);
  /** ASR 采集流的 React 侧句柄（audioRef 是 ref 不触发渲染；仅用于喂给状态球取电平）。 */
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [voicePendingSend, setVoicePendingSend] = useState(false);
  const [speechMode, setSpeechMode] = useState<VoiceInputMode | null>(null);
  const [voiceDropZone, setVoiceDropZone] = useState<VoiceDropAction>("send");
  const [speechStatus, setSpeechStatus] = useState("");
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number; messageId: string; text: string; role: SessionMessage["role"]; selection: string } | null>(null);
  const [quotedText, setQuotedText] = useState("");
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [readingStatus, setReadingStatus] = useState<"loading" | "playing" | null>(null);
  // Codex-style sensitive tool-call confirmation, pending user decision.
  const [toolConfirmation, setToolConfirmation] = useState<{ confirmationId: string; tool: string; arguments: Record<string, unknown>; reason: string } | null>(null);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  /* R65 模型回退链详细进度（用户点名）：主进程 model.request/failed +
     model.fallback/switch 事件早就有，但渲染层只显示最终 fallbackNotice——
     中间每一步失败/切换用户全程不可见。这里实时聚合当前会话的回退过程。 */
  const [modelFallback, setModelFallback] = useState<{ sessionId: string; failed: Array<{ model: string; kind: string; message: string }>; current?: string; switchCount: number } | null>(null);
  /* R65：web_search 执行中的实时卡——工具一开跑就显示 Searching（rareui 演示
     行为），result 事件落地即切 Searched N，消息落库后由消息内卡片接管。 */
  const liveWebSearch = useMemo(() => {
    if (!sessionRunning || !session) return null;
    /* R68：流式实时卡与落地后消息卡同口径——此前只取「最后一次」web_search
       的 result，多轮搜索时流式卡显示 3 个来源、落地后 flatMap 出 7 个，
       正文 [n] 引用与卡片编号在过渡期对不上（用户反馈「计算逻辑把
       show more/less 期间的计数算乱了」）。改为聚合本轮全部已完成结果，
       callIndex 随收集顺序递增，与 webSearchSourcesFor 完全一致；
       最后一次事件是 call（未返回）才显示 searching。 */
    const sources: WebSource[] = [];
    let callIndex = 0;
    let searching = false;
    let query: string | undefined;
    for (const item of trace) {
      if (item.sessionId !== session.meta.id) continue;
      const data = (item.data ?? {}) as { name?: unknown; arguments?: { query?: unknown } | undefined; result?: unknown };
      if (item.stage === "secagent.tools/result" && data.name === "web_search") {
        sources.push(...normalizeWebSearchSources(data.result, callIndex));
        callIndex += 1;
        searching = false;
      } else if (item.stage === "secagent.tools/call" && data.name === "web_search") {
        searching = true;
        if (typeof data.arguments?.query === "string") query = data.arguments.query;
      }
    }
    if (!sources.length && !searching) return null;
    return { searching, query, sources };
  }, [trace, session, sessionRunning]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const answerContentRef = useRef<HTMLDivElement>(null);
  const executionSummaryRef = useRef<HTMLButtonElement>(null);
  // R56 流式跟随滚动：follow=true 时容器钉在底部（思考/工具调用内容增长自动下滚）；
  // 用户手动上滚即置 false（暂停跟随、自由浏览），滚回底部附近自动恢复。
  const followOutputRef = useRef(true);
  const answerStartScrollPending = useRef(false);
  /* R27 PromptBar 桥：onAttach 必须返回 Promise，但文件选择器是回调式——
     pendingAttachResolveRef 暂存 resolve，input change 后由 addImageFiles 兑现；
     pendingDictationResolveRef 同理暂存听写 promise，finishVoiceInput 收尾时兑现。 */
  const pendingAttachResolveRef = useRef<((names: string[]) => void) | null>(null);
  const pendingDictationResolveRef = useRef<((text: string) => void) | null>(null);
  // Official tiers first, then custom models clustered by provider so the
  // submenu can render a labelled group header per provider. The relay's
  // virtual-vision model is a vision-tool backend only, never a main model.
  const orderedModels = useMemo(() => {
    const visible = models.filter((model) => !isOfficialVisionModel(model));
    const official = visible.filter(isOfficialModel);
    const custom = visible.filter((model) => !isOfficialModel(model));    const clustered: ModelOption[] = [];
    const byProvider = new Map<string, ModelOption[]>();
    for (const model of custom) {
      const group = model.providerLabel || "自定义模型";
      const bucket = byProvider.get(group);
      if (bucket) bucket.push(model);
      else { byProvider.set(group, [model]); }
    }
    for (const bucket of byProvider.values()) clustered.push(...bucket);
    return [...official, ...clustered];
  }, [models]);
  const modelGroupLabel = (model: ModelOption): string => isOfficialModel(model) ? "官方服务" : (model.providerLabel || "自定义模型");
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const reasoningEfforts = useMemo(() => reasoningEffortsForModel(selectedModel), [selectedModel]);
  useEffect(() => {
    bridge.setWakeContext({ sessionId: session?.meta.id, modelId: selectedModelId || undefined, reasoningEffort: customModelMode ? reasoningEffort : defaultEffort });
  }, [bridge, session?.meta.id, selectedModelId, reasoningEffort, defaultEffort, customModelMode]);
  useEffect(() => {
    if (!reasoningEfforts.includes(reasoningEffort)) {
      // R29：模型切换档位收缩时（如 GLM-5 的 max → Qwen 只到 high），
      // 回退到新列表中不超过当前档位的最高档，而不是直接掉到最低档。
      const rank: Record<ReasoningEffort, number> = { none: 0, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6 };
      const current = rank[reasoningEffort];
      const fallback = [...reasoningEfforts].sort((a, b) => rank[a] - rank[b]).filter((candidate) => rank[candidate] <= current).pop();
      setReasoningEffort(fallback ?? reasoningEfforts[0] ?? "high");
    }
  }, [reasoningEffort, reasoningEfforts]);
  const initializing = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<{ context: AudioContext; stream: MediaStream; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode } | undefined>(undefined);
  const recordingRef = useRef(false);
  /** 选定的输入音频设备 ID（settings.speech.audio.input；undefined = 系统默认）。 */
  const audioInputRef = useRef<string | undefined>(undefined);
  const voicePendingSendRef = useRef<PendingVoiceSend | undefined>(undefined);
  const speechInputId = useRef(0);
  const speechSessionRef = useRef<{
    id: number;
    mode: VoiceInputMode;
    insert: { start: number; end: number };
    previewRange: { start: number; end: number };
    result: string;
    stopped: boolean;
    stopRequested: boolean;
    canceled: boolean;
    resolve?: (result: { text: string; error?: string }) => void;
    settleTimer?: number;
    timeout?: number;
  }>(undefined);
  const voicePressRef = useRef<{
    pointerId: number;
    timer: number;
    started: boolean;
    released: boolean;
    insert: { start: number; end: number };
    originX: number;
    originY: number;
    startPromise?: Promise<boolean>;
  }>(undefined);
  const voiceCancelZoneRef = useRef<HTMLDivElement>(null);
  const voiceEditZoneRef = useRef<HTMLDivElement>(null);
  const speechAudio = useRef<HTMLAudioElement | null>(null);
  const speechRun = useRef(0);

  const setRecordingState = (value: boolean) => {
    recordingRef.current = value;
    setRecording(value);
  };
  const logSpeech = (stage: string, data: Record<string, unknown> = {}) => {
    const payload = { stage, ...data };
    console.debug("[speech]", payload);
    bridge.logSpeech(payload);
  };
  const settleSpeechSession = (session: NonNullable<typeof speechSessionRef.current>, result: { text: string; error?: string }) => {
    if (!session.resolve) return;
    if (session.settleTimer !== undefined) window.clearTimeout(session.settleTimer);
    if (session.timeout !== undefined) window.clearTimeout(session.timeout);
    session.settleTimer = undefined;
    session.timeout = undefined;
    const resolve = session.resolve;
    session.resolve = undefined;
    resolve(result);
  };
  const waitForSpeechResult = (session: NonNullable<typeof speechSessionRef.current>) => new Promise<{ text: string; error?: string }>((resolve) => {
    session.resolve = resolve;
    session.timeout = window.setTimeout(() => settleSpeechSession(session, { text: session.result }), 10000);
    if (session.stopped) {
      session.settleTimer = window.setTimeout(() => settleSpeechSession(session, { text: session.result }), 250);
    }
  });

  useEffect(() => {
    if (!bridge || initializing.current) return;
    initializing.current = true;
    void (async () => {
      // The remote official model catalog can be slow or temporarily unavailable.
      // Start it in the background so restoring the session remains responsive.
      const modelsPromise = bridge.listModels()
        .then((configured) => {
          setModels(configured);
          return configured;
        })
        .catch(() => [] as ModelOption[]);
      const list = await bridge.listSessions();
      const [active, savedSettings] = await Promise.all([
        list[0] ? bridge.getSession(list[0].id) : bridge.createSession(),
        bridge.getSettings()
      ]);
      const customMode = Boolean(savedSettings.customModelMode);
      setCustomModelMode(customMode);
      const savedInput = (savedSettings as { speech?: { audio?: { input?: string } } }).speech?.audio?.input;
      audioInputRef.current = savedInput && savedInput !== "auto" && savedInput !== "default" ? savedInput : undefined;
      const defaultReasoning = (savedSettings.defaultReasoningEffort || "high") as ReasoningEffort;
      setDefaultEffort(defaultReasoning);
      setReasoningEffort(defaultReasoning);
      setSessions(list);
      setSession(active);
      requestAnimationFrame(() => textareaRef.current?.focus());
      const configured = await modelsPromise;
      const mainModels = configured.filter((model) => !isOfficialVisionModel(model));
      const preferred = mainModels.find((model) => model.id === savedSettings.defaultModelId)
        || mainModels.find((model) => isOfficialTierModel(model) && model.model === tierDefaultId)
        || mainModels[0];
      setSelectedModelId(preferred?.id || "");
    })();
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onSettingsChanged(() => {
      void bridge.getSettings().then((current) => {
        const input = (current as { speech?: { audio?: { input?: string } } } | null)?.speech?.audio?.input;
        audioInputRef.current = input && input !== "auto" && input !== "default" ? input : undefined;
      }).catch(() => undefined);
      void bridge.listModels().then((models) => {
        setModels(models);
        void bridge.getSettings().then((settings) => {
          const customMode = Boolean(settings.customModelMode);
          setCustomModelMode(customMode);
          setDefaultEffort((settings.defaultReasoningEffort || "high") as ReasoningEffort);
          setSelectedModelId((current) => {
            /* R79：设置广播（主题切换、插件开关等）不应覆盖输入栏里用户
               当次选中的模型。当前选择仍在可用列表内就原样保留，只有它
               被删除/被过滤时才回退到默认模型或官方档位——此前无条件写回
               settings.defaultModelId，用户选了模型又被悄悄弹回默认值，
               表现为"选不上模型"。 */
            if (models.some((model) => !isOfficialVisionModel(model) && model.id === current)) return current;
            const preferred = models.find((model) => !isOfficialVisionModel(model) && model.id === settings.defaultModelId);
            if (preferred) return preferred.id;
            const tier = models.find((model) => isOfficialTierModel(model) && model.model === tierDefaultId);
            if (tier) return tier.id;
            return models.find((model) => !isOfficialVisionModel(model))?.id || "";
          });
        });
      });
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onSpeechEvent((event) => {
      const data = event as { type?: string; text?: string; message?: string };
      const speechSession = speechSessionRef.current;
      if (data.type === "ready") {
        logSpeech("event.ready", { mode: speechSession?.mode || "none" });
        if (recordingRef.current) setSpeechStatus("正在聆听…");
      }
      if ((data.type === "partial" || data.type === "final") && data.text && speechSession) {
        const text = data.text;
        logSpeech(`event.${data.type}`, { characters: text.length, mode: speechSession.mode });
        if (speechSession.mode === "streaming") {
          // Click-to-record keeps the pre-hold-to-talk behavior: the current
          // partial result replaces the previous preview in the composer.
          const insertion = speechSession.previewRange;
          setDraft((current) => current.slice(0, insertion.start) + text + current.slice(insertion.end));
          const nextPoint = insertion.start + text.length;
          speechSession.previewRange = data.type === "final"
            ? { start: nextPoint, end: nextPoint }
            : { start: insertion.start, end: nextPoint };
        } else if (data.type === "final") {
          // Hold-to-talk never writes into the draft while recording.
          speechSession.result += text;
        }
        return;
      }
      if (data.type === "error") {
        const message = data.message || "语音识别失败";
        logSpeech("event.error", { message: message.slice(0, 200) });
        if (speechSession) {
          speechSession.stopRequested = true;
          settleSpeechSession(speechSession, { text: speechSession.result, error: message });
        }
        void closeAudioCapture();
        void bridge.cancelSpeech();
        setSpeechStatus(message);
        setRecordingState(false);
        setSpeechProcessing(false);
        setSpeechMode(null);
        setVoiceDropZone("send");
        return;
      }
      if (data.type === "stopped" && speechSession) {
        logSpeech("event.stopped", { mode: speechSession.mode, resultCharacters: speechSession.result.length });
        speechSession.stopped = true;
        speechSession.settleTimer = window.setTimeout(() => settleSpeechSession(speechSession, { text: speechSession.result }), 250);
        return;
      }
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onRuntimeEvent((event) => {
      const item = event as TraceEvent;
      /* R75（审计 P3-62）：trace 全局单桶无上限累积（长会话+多会话并行时
         每个事件都进 state 永不释放，且 statusTick 每秒触发整树重渲染都要
         遍历它）。滑动窗口 500 条——UI 只展示最近活动，500 早已覆盖可视区。 */
      setTrace((current) => {
        const next = [...current, item];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
      if (item.stage === "model.request/failed") {
        const data = (item.data ?? {}) as { model?: unknown; kind?: unknown; error?: unknown };
        setModelFallback((current) => current && current.sessionId === item.sessionId ? { ...current, failed: [...current.failed, { model: String(data.model ?? "未知模型"), kind: String(data.kind ?? "unknown"), message: String(data.error ?? "") }] } : current);
      } else if (item.stage === "model.fallback/switch") {
        const data = (item.data ?? {}) as { to?: unknown; modelId?: unknown };
        setModelFallback((current) => current && current.sessionId === item.sessionId ? { ...current, current: String(data.to ?? ""), switchCount: current.switchCount + 1 } : { sessionId: item.sessionId, failed: [], current: String(data.to ?? ""), switchCount: 1 });
      } else if (item.stage === "model.agent.request") {
        setModelFallback((current) => current && current.sessionId === item.sessionId ? { ...current, failed: [], current: undefined } : current);
      } else if (item.stage === "assistant.response" || item.stage === "runtime.stopped" || item.stage === "runtime.error") {
        setModelFallback((current) => current && current.sessionId === item.sessionId ? null : current);
      }
    });
  }, [bridge]);

  // Sensitive tool calls pause here until the user approves, rejects, or the
  // 5-minute main-process timeout fires.
  useEffect(() => {
    if (!bridge) return;
    return bridge.onToolConfirmation((payload) => setToolConfirmation(payload));
  }, [bridge]);

  const resolveToolConfirmation = (approved: boolean, always = false) => {
    if (!toolConfirmation) return;
    void bridge?.respondToolConfirmation({ confirmationId: toolConfirmation.confirmationId, approved, always, signature: always ? `${toolConfirmation.tool}|${String(toolConfirmation.arguments.command ?? "").trim().split(/\s+/)[0] || "*"}`.toLowerCase() : undefined });
    setToolConfirmation(null);
  };


  useEffect(() => {
    const closeMenu = () => setMessageMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { closeMenu(); setPreviewAttachment(null); } };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeMenu); document.removeEventListener("keydown", closeOnEscape); };
  }, []);

  const stopReading = () => {
    speechRun.current += 1;
    speechAudio.current?.pause();
    speechAudio.current = null;
    setSpeakingMessageId(null);
    setReadingStatus(null);
  };

  const readMessage = async (messageId: string, content: string) => {
    stopReading();
    const run = speechRun.current;
    const plain = content.replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/i, "").replace(/```$/, ""))
      .replace(/!\[([^]]*)\]\([^)]*\)/g, "$1").replace(/\[([^]]+)\]\([^)]*\)/g, "$1")
      .replace(/[#*_>`~-]/g, "").replace(/\s+/g, " ").trim();
    const chunks = plain.match(/[^。！？!?；;，,：:\n]+[。！？!?；;，,：:]?|[^。！？!?；;，,：:]+$/g)?.map((item) => item.trim()).filter(Boolean) || [];
    if (!chunks.length) return;
    setSpeakingMessageId(messageId);
    setReadingStatus("loading");
    try {
      let nextBuffer = await bridge.synthesizeSpeech(chunks[0]);
      for (let index = 0; index < chunks.length && speechRun.current === run; index += 1) {
        const following = index + 1 < chunks.length ? bridge.synthesizeSpeech(chunks[index + 1]) : undefined;
        const audio = new Audio(`data:audio/mpeg;base64,${nextBuffer}`);
        setReadingStatus("playing");
        speechAudio.current = audio;
        const ended = new Promise<void>((resolve, reject) => { audio.onended = () => resolve(); audio.onerror = () => reject(new Error("音频播放失败")); });
        await audio.play();
        await ended;
        speechAudio.current = null;
        if (following) nextBuffer = await following;
      }
    } catch (error) {
      if (speechRun.current === run) console.warn("TTS failed", error);
    } finally {
      if (speechRun.current === run) { setSpeakingMessageId(null); setReadingStatus(null); }
    }
  };

  const activeTrace = useMemo(() => trace.filter((item) => item.sessionId === session?.meta.id), [trace, session?.meta.id]);
  const manuallyStopped = useMemo(() => activeTrace.some((item) => item.stage === "runtime.stopped"), [activeTrace]);
  const finalStreamStart = useMemo(() => activeTrace.reduce((start, item, index) => item.stage === "model.output.reset" ? index + 1 : start, 0), [activeTrace]);
  const streamingOutput = useMemo(() => activeTrace.slice(finalStreamStart).filter((item) => item.stage === "model.output.delta")
    .map((item) => { const data = item.data as { text?: string; kind?: string }; return data.kind === "answer" || !data.kind ? data.text || "" : ""; }).join(""), [activeTrace, finalStreamStart]);
  // R56 手动滚动手势识别：滚轮上滚立即暂停跟随（scrollbar 拖拽由下方 onScroll 兜底）；
  // 任何方式回到距底 64px 内即恢复。程序化 scrollTo 也经过这里——"auto" 直达底部，
  // 不会产生远离底部的中间位置。
  // R59：scrollHeight 读取强制布局，流式期间布局逐 chunk 变脏，滚动事件逐次
  // 同步读 = 每次全页 reflow（长会话滑动卡顿成因之二）——rAF 合帧，每帧至多读一次。
  const scrollCheckRafRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollCheckRafRef.current), []);
  const handleMessagesWheel = (event: ReactWheelEvent) => {
    if (event.deltaY < 0) followOutputRef.current = false;
  };
  const handleMessagesScroll = () => {
    if (scrollCheckRafRef.current) return;
    scrollCheckRafRef.current = requestAnimationFrame(() => {
      scrollCheckRafRef.current = 0;
      const el = messagesRef.current;
      if (!el) return;
      followOutputRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    });
  };
  useEffect(() => {
    if (sessionFinishing || !answerStartScrollPending.current || !messagesRef.current || !answerContentRef.current) return;
    answerStartScrollPending.current = false;
    const messages = messagesRef.current;
    const answer = answerContentRef.current;
    requestAnimationFrame(() => {
      const target = Math.max(0, messages.scrollTop + answer.getBoundingClientRect().top - messages.getBoundingClientRect().top - 12);
      messages.scrollTo({ top: target, behavior: "auto" });
      console.debug("[SecAgent scroll] completed-answer-start", { targetScrollTop: target, scrollTop: messages.scrollTop });
    });
  }, [sessionFinishing]);
  const executionSeconds = useMemo(() => {
    const start = activeTrace.find((item) => item.stage === "user.request");
    const end = [...activeTrace].reverse().find((item) => item.stage === "assistant.response" || item.stage === "runtime.error");
    if (!start) return undefined;
    const endAt = end ? new Date(end.at).getTime() : Date.now();
    return Math.max(1, Math.round((endAt - new Date(start.at).getTime()) / 1000));
  }, [activeTrace]);
  const traceActivities = useMemo(() => {
    const activities: AssistantActivity[] = [];
    for (const item of activeTrace) {
      if (item.stage === "model.output.delta") {
        const data = item.data as { text?: unknown; kind?: unknown; turn?: unknown };
        const kind = data.kind === "thinking" || data.kind === "summary" ? data.kind : undefined;
        if (kind && typeof data.text === "string") {
          const last = activities.at(-1);
          if (last?.kind === kind) last.content += data.text;
          else activities.push({ kind, content: data.text, ...(typeof data.turn === "number" ? { turn: data.turn } : {}) });
        }
      }
      if (item.stage === "mcp.tools/call" || item.stage === "secagent.tools/call") {
        const data = item.data as { name?: unknown; arguments?: unknown };
        if (typeof data.name === "string") activities.push({ kind: "tool", name: data.name, arguments: data.arguments ?? {} });
      }
      if (item.stage === "secagent.skills/auto-load") {
        const skills = Array.isArray(item.data) ? item.data as Array<{ name?: unknown; path?: unknown }> : [];
        for (const skill of skills) if (typeof skill.name === "string" && typeof skill.path === "string") activities.push({ kind: "skill-auto-load", name: skill.name, path: skill.path });
      }
      if (item.stage === "mcp.tools/result" || item.stage === "secagent.tools/result") {
        const data = item.data as { name?: unknown; result?: unknown };
        if (typeof data.name === "string") {
          const activity = [...activities].reverse().find((entry): entry is Extract<AssistantActivity, { kind: "tool" }> => entry.kind === "tool" && entry.name === data.name && !("result" in entry));
          if (activity) activity.result = data.result;
        }
      }
    }
    return activities;
  }, [activeTrace]);
  const activeStepKind = useMemo(() => {
    const last = [...activeTrace].reverse().find((item) => item.stage === "model.output.delta" || item.stage === "mcp.tools/call" || item.stage === "mcp.tools/result" || item.stage === "secagent.tools/call" || item.stage === "secagent.tools/result");
    if (!last) return undefined;
    if (last.stage === "model.output.delta") return (last.data as { kind?: string }).kind || "answer";
    return "tool";
  }, [activeTrace]);
  /* R66：修「模型已输出完仍显示思考中 ~10s」——正文输出完毕后主进程还要
     等 IPC 回包/落库/整会话回传，期间 trace 无新事件、activeStepKind 停在
     最后一个 delta 的 kind（answer）上，而 AiStatus 把非 tool 一律显示
     「正在思考」。两步修：①answer 阶段显示「正在撰写」（真在写）；
     ②最后一个 delta 之后静默超过 2.5s（网络回程+落库的正常收尾窗口）
     切「正在收尾」，不再假装思考。秒级 tick 仅运行期存在。 */
  const [statusTick, setStatusTick] = useState(0);
  useEffect(() => {
    if (!sessionRunning) return;
    const timer = window.setInterval(() => setStatusTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sessionRunning]);
  const lastDeltaAt = useMemo(() => {
    for (let i = activeTrace.length - 1; i >= 0; i -= 1) {
      if (activeTrace[i].stage === "model.output.delta") return new Date(activeTrace[i].at).getTime();
    }
    return undefined;
  }, [activeTrace]);
  const aiStatusState = activeStepKind === "tool" ? "researching"
    : activeStepKind === "answer" ? "writing"
    : lastDeltaAt && statusTick - lastDeltaAt > 2500 ? "finalizing"
    : "thinking";
  // R56 流式自动跟随（原 settle-summary/summary-locked 机制移除）：思考/推理与工具
  // 调用内容流式增长时，若用户停留在底部附近（followOutputRef=true）则容器钉住
  // 底部，跟着最新内容往下滚；用户上滚离开底部即暂停（保留完整手动浏览能力），
  // 滚回底部附近自动恢复跟随。收尾时 answerStartScrollPending 仍会把最终回答顶部
  // 滚入视野，不受跟随状态影响。
  // R59：读+写也走 rAF（读 scrollHeight 强制布局，逐 chunk 同步写是卡顿成因
  // 之三）；cleanup 取消过期帧，高频 chunk 每帧只落最后一滚。
  useEffect(() => {
    if (!sessionRunning || !messagesRef.current) return;
    if (!followOutputRef.current) return;
    const messages = messagesRef.current;
    const raf = requestAnimationFrame(() => {
      if (!followOutputRef.current) return;
      const nextScrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
      if (nextScrollTop - messages.scrollTop < 24) return;
      messages.scrollTo({ top: nextScrollTop, behavior: "auto" });
    });
    return () => cancelAnimationFrame(raf);
  }, [streamingOutput, traceActivities, sessionRunning]);
  const latestAssistantId = useMemo(() => session?.messages.filter((message) => message.role === "assistant").at(-1)?.id, [session?.messages]);
  // 状态球三态映射（仅用既有变量）：说话/识别中 → listening，发送/收尾 → thinking，否则 idle。
  const orbState = recording || speechProcessing ? "listening" : anyRunning || anyFinishing ? "thinking" : "idle";
  // 常驻球的"仪表盘"信息（可选任务）：本轮正在调用且未返回的工具名与配色。
  const runningTool = anyRunning || anyFinishing ? [...traceActivities].reverse().find((activity): activity is Extract<AssistantActivity, { kind: "tool" }> => activity.kind === "tool" && !("result" in activity)) : undefined;
  const orbAccent = runningTool ? ACCENT : undefined;
  const orbLabel = runningTool ? `正在调用 ${toolTitle(runningTool.name)}` : orbState === "thinking" ? "正在思考" : undefined;
  // ScrollProgress（rareui）节列表：按本地日聚合消息（id 即 DaySeparator 的锚点 id）
  const scrollSections = useMemo(() => {
    if (!session?.messages.length) return [] as Array<{ id: string; label: string }>;
    const seen = new Set<string>();
    const sections: Array<{ id: string; label: string }> = [];
    for (const message of session.messages) {
      const id = daySeparatorId(message.createdAt);
      if (seen.has(id)) continue;
      seen.add(id);
      sections.push({ id, label: daySeparatorLabel(message.createdAt) });
    }
    return sections;
  }, [session?.messages]);
  const changeSession = async (id: string) => {
    if (!bridge) return;
    const [next, runtimeEvents] = await Promise.all([bridge.getSession(id), bridge.getRuntimeEvents(id)]);
    setSession(next);
    setTrace((current) => {
      const merged = new Map(current.map((item) => [`${item.sessionId}:${item.sequence}`, item]));
      for (const item of runtimeEvents) merged.set(`${item.sessionId}:${item.sequence}`, item);
      const sorted = [...merged.values()].sort((left, right) => left.at.localeCompare(right.at) || left.sequence - right.sequence);
      return sorted.length > 500 ? sorted.slice(sorted.length - 500) : sorted;
    });
  };
  const createSession = async () => {
    if (!bridge) return;
    // R56 新建防堆积：已存在"空会话"（默认标题且无预览 ⇒ 无消息）时直接切换过去，
    // 不再重复落盘新会话——连续点 + 不会刷出一排"新会话"，也省掉 sessions:list
    // 全量预览扫描随会话数线性变慢的开销。
    const list = await bridge.listSessions();
    const empty = list.find((item) => item.title === "新会话" && !item.preview);
    if (empty) {
      if (empty.id === session?.meta.id) { requestAnimationFrame(() => textareaRef.current?.focus()); return; }
      await changeSession(empty.id);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    const next = await bridge.createSession();
    setSessions(await bridge.listSessions());
    setSession(next);
    setTrace([]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };
  /* R65：归档/取消归档——只翻标记，本地即时更新（不用等 IPC 往返重拉全列表）。 */
  const archiveSession = async (id: string, archived: boolean) => {
    try {
      await bridge.archiveSession(id, archived);
      setSessions((current) => current.map((meta) => meta.id === id ? { ...meta, archived: archived || undefined } : meta));
    } catch (reason) {
      console.error("archiveSession failed", reason);
    }
  };

  const deleteSession = async (id: string) => {
    if (!bridge) return;
    const remaining = await bridge.deleteSession(id);
    if (id === session?.meta.id) {
      const next = remaining[0] ? await bridge.getSession(remaining[0].id) : await bridge.createSession();
      setSession(next);
      setTrace([]);
      setSessions(await bridge.listSessions());
    } else {
      setSessions(remaining);
    }
  };
  const addImageFiles = async (files: File[] | FileList) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!imageFiles.length) {
      setAttachmentError("这里只支持图片文件");
      return;
    }
    const available = Math.max(0, 4 - attachments.length);
    if (!available) {
      setAttachmentError("最多添加 4 张图片");
      return;
    }
    const accepted = imageFiles.slice(0, available);
    const tooLarge = accepted.filter((file) => file.size > 12 * 1024 * 1024);
    if (tooLarge.length) setAttachmentError("单张图片不能超过 12 MB");
    const readable = accepted.filter((file) => file.size <= 12 * 1024 * 1024);
    const next = await Promise.all(readable.map((file) => new Promise<ChatAttachment | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name || "图片", mimeType: file.type, dataUrl: reader.result, size: file.size } : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    })));
    const valid = next.filter((item): item is ChatAttachment => Boolean(item));
    if (valid.length) {
      setAttachments((current) => [...current, ...valid].slice(0, 4));
      setDraft((current) => current || "\u200b");
      setAttachmentError(tooLarge.length ? "部分图片因大小限制未添加" : "");
    }
    // R27：兑现 PromptBar onAttach 的挂起 resolve（无论接受多少张都结束等待；
    // 文件选择器被取消时 input 不触发 change，promise 悬置——仅浪费一次
    // 监听位，无副作用）。
    const attachResolve = pendingAttachResolveRef.current;
    if (attachResolve) {
      pendingAttachResolveRef.current = null;
      attachResolve(valid.map((item) => item.name));
    }
  };
  const handlePaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    void addImageFiles(files);
  };
  const handleDrop = (event: ReactDragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setComposerDragging(false);
    void addImageFiles(Array.from(event.dataTransfer.files));
  };
  const scrollMessagesToBottom = () => {
    // R56：新消息发送重置跟随开关；"auto" 直达底部（无 smooth 中间位置，
    // 避免 onScroll 误判为用户上滚而暂停跟随）。
    followOutputRef.current = true;
    requestAnimationFrame(() => {
      const messages = messagesRef.current;
      if (!messages) return;
      const nextScrollTop = Math.max(0, messages.scrollHeight - messages.clientHeight);
      console.debug("[SecAgent scroll] user-message", { currentScrollTop: messages.scrollTop, nextScrollTop, maxScrollTop: nextScrollTop });
      messages.scrollTo({ top: nextScrollTop, behavior: "auto" });
    });
  };
  const submitMessage = async (text: string, sentAttachments: ChatAttachment[], optimisticMessageId?: string) => {
    if ((!text && !sentAttachments.length) || !session || runningSessionsRef.current.includes(session.meta.id) || (voicePendingSendRef.current && !optimisticMessageId)) return;
    if (optimisticMessageId) {
      setSession((current) => current && current.meta.id === session.meta.id
        ? { ...current, messages: current.messages.map((message) => message.id === optimisticMessageId ? { ...message, content: text } : message) }
        : current);
    } else {
      const optimisticMessage: SessionMessage = { id: `pending-${Date.now()}`, role: "user", content: text, attachments: sentAttachments, createdAt: new Date().toISOString() };
      setSession((current) => current ? { ...current, messages: [...current.messages, optimisticMessage] } : current);
    }
    scrollMessagesToBottom();
    setDraft(""); setQuotedText(""); setAttachments([]); setAttachmentError(""); setTrace([]);
    /* R59：按会话记账——同一会话不并发（旧 sending 全局锁解除，其它会话可并行开跑）。 */
    clearRun(session.meta.id);
    markRunning(session.meta.id);
    let completed = false;
    try {
      if (bridge) {
        // 关闭自定义模型模式：下拉只有三个虚拟档位、无推理强度选项，一律使用默认推理强度。
        // 开启模式：档位顺序只是后端的 fallback 顺序，与推理强度无关，使用用户选择的推理强度。
        const effort = customModelMode ? reasoningEffort : defaultEffort;
        const response = await bridge.sendMessage(session.meta.id, text, selectedModelId, effort, sentAttachments);
        /* R59：多任务——收尾回包只更新视图中的同会话；期间切走的视图不被拽回。 */
        setSession((current) => current && current.meta.id === session.meta.id ? response : current);
        setSessions(await bridge.listSessions());
        completed = true;
        answerStartScrollPending.current = true;
        markFinishing(session.meta.id);
      }
    } catch (error) {
      // R57：IPC/桥层异常兜底（runSession 内部已把模型错误写成"执行失败："
      // 消息入会话，走不到这里）——本地补一条同格式错误消息，保持异常在
      // 对话流内可见而不是无声失败。
      const detail = `执行失败：${error instanceof Error ? error.message : String(error)}`;
      setSession((current) => current && current.meta.id === session.meta.id
        ? { ...current, messages: [...current.messages, { id: `local-error-${Date.now()}`, role: "assistant", content: detail, createdAt: new Date().toISOString() }] }
        : current);
    } finally {
      if (completed) await new Promise((resolve) => setTimeout(resolve, 260));
      clearRun(session.meta.id);
    }
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (voicePendingSendRef.current) return;
    await submitMessage(buildQuotedUserMessage(quotedText, draft), attachments);
  };
  const stop = async () => {
    if (!bridge || !session || !runningSessionsRef.current.includes(session.meta.id)) return;
    await bridge.stopMessage(session.meta.id);
  };

  const closeAudioCapture = async () => {
    const audio = audioRef.current;
    audioRef.current = undefined;
    setMicStream(null);
    audio?.processor.disconnect();
    audio?.source.disconnect();
    audio?.stream.getTracks().forEach((track) => track.stop());
    try { await audio?.context.close(); } catch { /* The context may already be closed by the browser. */ }
  };

  const startVoiceInput = async (mode: VoiceInputMode, insert?: { start: number; end: number }): Promise<boolean> => {
    if (recordingRef.current || speechProcessing || sessionRunning || voicePendingSendRef.current || !session) return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setSpeechStatus("当前环境不支持麦克风");
      return false;
    }
    const textArea = textareaRef.current;
    const selection = insert || { start: textArea?.selectionStart ?? draft.length, end: textArea?.selectionEnd ?? draft.length };
    const speechSession = {
      id: ++speechInputId.current,
      mode,
      insert: selection,
      previewRange: selection,
      result: "",
      stopped: false,
      stopRequested: false,
      canceled: false
    };
    speechSessionRef.current = speechSession;
    logSpeech("capture.starting", { mode, insertStart: selection.start, insertEnd: selection.end });
    setSpeechMode(mode);
    setVoiceDropZone("send");
    setSpeechProcessing(false);
    setRecordingState(true);
    setSpeechStatus("正在启动语音识别…");
    try {
      const speechStart = await bridge.startSpeech();
      logSpeech("start.ready", { mode, remote: speechStart.remote !== false });
      if (speechSession.stopRequested) {
        if (speechSessionRef.current === speechSession) speechSessionRef.current = undefined;
        setSpeechMode(null);
        return false;
      }
      /* R58：主窗听写采集改"原始信号"——关 noiseSuppression/autoGainControl
       （浏览器降噪会削低电平语音、AGC 泵动改变动态，ASR 引擎在近讲场景
       对原始 16k 单声道准确率更高；echoCancellation 保留防 TTS 回灌）。
       唤醒窗采集不变（KWS 链路按原约束调优）。 */
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false, ...(audioInputRef.current ? { deviceId: { exact: audioInputRef.current } } : {}) } });
      if (speechSession.stopRequested) {
        stream.getTracks().forEach((track) => track.stop());
        if (speechSessionRef.current === speechSession) speechSessionRef.current = undefined;
        setSpeechMode(null);
        return false;
      }
      const context = new AudioContext({ sampleRate: 16000 });
      if (context.state !== "running") await context.resume();
      if (context.state !== "running") throw new Error(`音频上下文未运行（${context.state}）`);
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(2048, 1, 1);
      let audioFrames = 0;
      let lastAudioLogAt = 0;
      processor.onaudioprocess = (event) => {
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        bridge.sendSpeechAudio(samples);
        audioFrames += 1;
        const now = Date.now();
        if (audioFrames === 1 || now - lastAudioLogAt >= 15_000) {
          lastAudioLogAt = now;
          let energy = 0;
          let peak = 0;
          for (const sample of samples) { energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
          logSpeech("audio.frames", { count: audioFrames, rms: Math.sqrt(energy / Math.max(1, samples.length)), peak, contextState: context.state });
        }
      };
      source.connect(processor);
      processor.connect(context.destination);
      audioRef.current = { context, stream, source, processor };
      setMicStream(stream);
      logSpeech("capture.ready", { mode, contextState: context.state, sampleRate: context.sampleRate, tracks: stream.getAudioTracks().length });
      if (speechSession.stopRequested) await closeAudioCapture();
      return true;
    } catch (error) {
      logSpeech("capture.failed", { mode, error: error instanceof Error ? error.message : String(error) });
      await closeAudioCapture();
      if (speechSessionRef.current === speechSession) speechSessionRef.current = undefined;
      setRecordingState(false);
      setSpeechProcessing(false);
      setSpeechMode(null);
      setSpeechStatus(`无法打开麦克风：${error instanceof Error ? error.message : String(error)}`);
      try { await bridge.cancelSpeech(); } catch { /* Ignore cleanup failures. */ }
      return false;
    }
  };

  /* R27 PromptBar 听写桥：流式识别的实时文稿由 onSpeechEvent 写入 draft
     （受控同步进 PromptBar 输入框），所以 dictation promise 恒以空串收场，
     只负责让 PromptBar 的 listening 态在收尾时正确熄灭。 */
  const releaseDictation = () => {
    const resolve = pendingDictationResolveRef.current;
    if (!resolve) return;
    pendingDictationResolveRef.current = null;
    resolve("");
  };
  const startPromptDictation = () => new Promise<string>((resolve) => {
    if (recordingRef.current || speechProcessing || sessionRunning || voicePendingSendRef.current || !session) { resolve(""); return; }
    pendingDictationResolveRef.current = resolve;
    void startVoiceInput("streaming").then((started) => { if (!started) { pendingDictationResolveRef.current = null; resolve(""); } });
  });
  const cancelPromptDictation = () => {
    releaseDictation();
    if (recordingRef.current) void finishVoiceInput("send");
  };

  const finishVoiceInput = async (action: VoiceDropAction) => {
    const speechSession = speechSessionRef.current;
    if (!speechSession || speechSession.stopRequested || !session) return;
    speechSession.stopRequested = true;
    speechSession.canceled = action === "cancel";
    logSpeech("capture.stopping", { mode: speechSession.mode, action });
    await closeAudioCapture();
    if (action === "cancel") {
      try { await bridge.cancelSpeech(); } catch { /* Ignore cleanup failures. */ }
      if (speechSessionRef.current === speechSession) speechSessionRef.current = undefined;
      releaseDictation();
      setRecordingState(false);
      setSpeechProcessing(false);
      setSpeechMode(null);
      setSpeechStatus("");
      setVoiceDropZone("send");
      return;
    }
    setRecordingState(false);
    const holdToTalk = speechSession.mode === "hold";
    if (holdToTalk && action === "send") {
      const pending: PendingVoiceSend = { messageId: `pending-voice-${speechSession.id}`, sessionId: session.meta.id };
      voicePendingSendRef.current = pending;
      setVoicePendingSend(true);
      setSession((current) => current && current.meta.id === pending.sessionId ? {
        ...current,
        messages: [...current.messages, { id: pending.messageId, role: "user", content: "...", createdAt: new Date().toISOString() }]
      } : current);
      scrollMessagesToBottom();
      // Restore the regular composer immediately. Recognition continues in the
      // background and only updates this already-visible user bubble.
      setSpeechProcessing(false);
      setSpeechMode(null);
      setVoiceDropZone("send");
      setSpeechStatus("");
      requestAnimationFrame(() => textareaRef.current?.focus());
      const resultPromise = waitForSpeechResult(speechSession);
      void (async () => {
        try {
          await bridge.stopSpeech();
          const result = await resultPromise;
          const text = result.text.trim();
          if (result.error || !text) {
            setSession((current) => current && current.meta.id === pending.sessionId
              ? { ...current, messages: current.messages.filter((message) => message.id !== pending.messageId) }
              : current);
            setSpeechStatus(result.error || "没有识别到语音");
            return;
          }
          await submitMessage(text, [], pending.messageId);
        } catch (error) {
          setSession((current) => current && current.meta.id === pending.sessionId
            ? { ...current, messages: current.messages.filter((message) => message.id !== pending.messageId) }
            : current);
          setSpeechStatus(`语音识别失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
          if (speechSession.timeout !== undefined) window.clearTimeout(speechSession.timeout);
          if (speechSession.settleTimer !== undefined) window.clearTimeout(speechSession.settleTimer);
          if (speechSessionRef.current === speechSession) speechSessionRef.current = undefined;
          if (voicePendingSendRef.current === pending) {
            voicePendingSendRef.current = undefined;
            setVoicePendingSend(false);
          }
          requestAnimationFrame(() => textareaRef.current?.focus());
          window.setTimeout(() => setSpeechStatus(""), 1500);
        }
      })();
      return;
    }
    setSpeechProcessing(true);
    setSpeechStatus(holdToTalk ? "正在识别…" : "正在结束识别…");
    const resultPromise = waitForSpeechResult(speechSession);
    try {
      await bridge.stopSpeech();
      const result = await resultPromise;
      if (result.error) {
        setSpeechStatus(result.error);
      } else if (result.text.trim() && speechSession.mode === "hold" && action === "edit") {
        const text = result.text.trim();
        setDraft((current) => current.slice(0, speechSession.insert.start) + text + current.slice(speechSession.insert.end));
        requestAnimationFrame(() => {
          const nextPoint = speechSession.insert.start + text.length;
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(nextPoint, nextPoint);
        });
        setSpeechStatus("");
      } else if (result.text.trim() && speechSession.mode === "hold" && action === "send") {
        await submitMessage(result.text.trim(), []);
        setSpeechStatus("");
      } else if (speechSession.mode === "streaming") {
        setSpeechStatus("");
      } else {
        setSpeechStatus("没有识别到语音");
      }
    } catch (error) {
      setSpeechStatus(`语音识别失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (speechSession.timeout !== undefined) window.clearTimeout(speechSession.timeout);
      if (speechSession.settleTimer !== undefined) window.clearTimeout(speechSession.settleTimer);
      if (speechSessionRef.current === speechSession) speechSessionRef.current = undefined;
      releaseDictation();
      setSpeechProcessing(false);
      setSpeechMode(null);
      setVoiceDropZone("send");
      requestAnimationFrame(() => textareaRef.current?.focus());
      window.setTimeout(() => setSpeechStatus(""), 1500);
    }
  };

  const updateVoiceDropZone = (clientX: number, clientY: number) => {
    const cancelRect = voiceCancelZoneRef.current?.getBoundingClientRect();
    const editRect = voiceEditZoneRef.current?.getBoundingClientRect();
    if (cancelRect && clientX >= cancelRect.left && clientX <= cancelRect.right && clientY >= cancelRect.top && clientY <= cancelRect.bottom) {
      setVoiceDropZone("cancel");
    } else if (editRect && clientX >= editRect.left && clientX <= editRect.right && clientY >= editRect.top && clientY <= editRect.bottom) {
      setVoiceDropZone("edit");
    } else setVoiceDropZone("send");
  };
  /* R74 悬浮球拖拽回弹：pointer 拖拽跟手（ref 直改 style——pointermove
     高频，setState 会重渲染整页），松手弹性曲线过冲回原位；拖远时阻尼
     （模拟弹性系绳）+ 微放大增强拉扯感。始终回原位（用户定调）。 */
  const orbDockRef = useRef<HTMLDivElement | null>(null);
  const orbDragRef = useRef({ active: false, pointerId: -1, startX: 0, startY: 0, moved: false });
  const releaseOrbDock = () => {
    const el = orbDockRef.current;
    if (el && orbDragRef.current.moved) {
      el.style.transition = "transform .58s cubic-bezier(.2,1.55,.36,1)";
      el.style.transform = "translate(0, 0) scale(1)";
      el.classList.remove("dragging");
      window.setTimeout(() => { const node = orbDockRef.current; if (node && !orbDragRef.current.active) node.style.transition = ""; }, 640);
    }
    orbDragRef.current = { active: false, pointerId: -1, startX: 0, startY: 0, moved: false };
  };
  const handleOrbPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const el = orbDockRef.current;
    if (!el) return;
    orbDragRef.current = { active: true, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    try { el.setPointerCapture(event.pointerId); } catch { /* capture unavailable in tests */ }
  };
  const handleOrbPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = orbDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const el = orbDockRef.current;
    if (!el) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) <= 4) return;
      drag.moved = true;
      el.classList.add("dragging");
      el.style.transition = "none";
    }
    const dist = Math.hypot(dx, dy);
    const damp = 1 - 0.35 * Math.min(dist / 360, 1);
    const scale = 1 + Math.min(dist / 900, 0.08);
    el.style.transform = `translate(${(dx * damp).toFixed(1)}px, ${(dy * damp).toFixed(1)}px) scale(${scale.toFixed(3)})`;
  };
  const handleMicPointerDown = (event: ReactPointerEvent<HTMLFormElement>) => {
    const target = event.target instanceof Element ? event.target.closest("textarea") : null;
    if (!target || event.button !== 0 || recordingRef.current || speechProcessing || sessionRunning || voicePendingSendRef.current || !session) return;
    const textArea = textareaRef.current;
    const insert = { start: textArea?.selectionStart ?? draft.length, end: textArea?.selectionEnd ?? draft.length };
    /* R66：拖动选区不触发长按语音——pointerdown 时已有非空选区（正在做
       文字选择/拖放），按住不动 700ms 会被误判为长按开录音。这里直接跳过；
       移动超过 6px（拖拽/滑动意图）也取消计时器。正常「空选区长按输入框」
       的语音入口不受影响。 */
    const hadSelection = insert.end > insert.start;
    if (hadSelection) return;
    const press: NonNullable<typeof voicePressRef.current> = { pointerId: event.pointerId, timer: 0, started: false, released: false, insert, originX: event.clientX, originY: event.clientY };
    voicePressRef.current = press;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is not available in every test environment. */ }
    press.timer = window.setTimeout(() => {
      if (voicePressRef.current !== press || press.released) return;
      press.started = true;
      press.startPromise = startVoiceInput("hold", insert);
    }, 700);
  };
  const handleMicPointerMove = (event: ReactPointerEvent<HTMLFormElement>) => {
    const press = voicePressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (!press.started && Math.hypot(event.clientX - press.originX, event.clientY - press.originY) > 6) {
      window.clearTimeout(press.timer);
      press.released = true;
      voicePressRef.current = undefined;
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
      return;
    }
    if (!press.started) return;
    updateVoiceDropZone(event.clientX, event.clientY);
  };
  const handleMicPointerUp = (event: ReactPointerEvent<HTMLFormElement>) => {
    const press = voicePressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    window.clearTimeout(press.timer);
    press.released = true;
    voicePressRef.current = undefined;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Pointer capture is not available in every test environment. */ }
    if (!press.started) return;
    const cancelRect = voiceCancelZoneRef.current?.getBoundingClientRect();
    const editRect = voiceEditZoneRef.current?.getBoundingClientRect();
    const inRect = (rect: DOMRect | undefined) => Boolean(rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
    const action: VoiceDropAction = inRect(cancelRect) ? "cancel" : inRect(editRect) ? "edit" : "send";
    if (press.startPromise) void press.startPromise.then(() => finishVoiceInput(action));
    else void finishVoiceInput(action);
  };
  const handleMicPointerCancel = (event: ReactPointerEvent<HTMLFormElement>) => {
    const press = voicePressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    window.clearTimeout(press.timer);
    press.released = true;
    voicePressRef.current = undefined;
    if (press.started) {
      if (press.startPromise) void press.startPromise.then(() => finishVoiceInput("cancel"));
      else void finishVoiceInput("cancel");
    }
  };

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (recordingRef.current || speechProcessing)) {
        event.preventDefault();
        void finishVoiceInput("cancel");
      }
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [recording, speechProcessing]);

  if (!bridge) {
    return <main className="app-shell"><AuiErrorState title="SecAgent 桌面桥接未加载" detail="请退出应用后重新运行 pnpm dev。若仍出现此提示，请检查 Electron 的 preload 启动日志。" /></main>;
  }

  return <main className="app-shell">
    <header className={`topbar ${bridge.platform === "darwin" ? "macos" : ""}`}>
      <button className="brand" type="button" aria-label="打开设置" onDoubleClick={() => { void bridge.openSettings(); }}><span>SecAgent</span></button>
</header>

    {messageMenu && <div className="message-context-menu" role="menu" style={{ left: messageMenu.x, top: messageMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
      {messageMenu.role !== "user" && <button type="button" role="menuitem" onClick={() => { const item = messageMenu; setMessageMenu(null); if (speakingMessageId === item.messageId) stopReading(); else void readMessage(item.messageId, item.text); }}>{speakingMessageId === messageMenu.messageId ? "停止朗读" : "朗读"}</button>}
      <button type="button" role="menuitem" onClick={() => { const text = messageMenu.selection || messageMenu.text; setMessageMenu(null); void copyText(text); }}>复制</button>
      {messageMenu.selection && <button type="button" role="menuitem" onClick={() => { const query = messageMenu.selection; setMessageMenu(null); void bridge.openExternal(webSearchUrl(query)); }}>搜索</button>}
      {messageMenu.selection && <button type="button" role="menuitem" onClick={() => { setQuotedText(messageMenu.selection); setMessageMenu(null); requestAnimationFrame(() => textareaRef.current?.focus()); }}>引用</button>}
    </div>}
    {previewAttachment && <div className="image-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewAttachment(null); }}>
      <section className="image-preview" role="dialog" aria-modal="true" aria-label={`预览 ${previewAttachment.name}`} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="image-preview-close" aria-label="关闭图片预览" onClick={() => setPreviewAttachment(null)}>×</button>
        <img src={previewAttachment.dataUrl} alt={previewAttachment.name} />
      </section>
    </div>}
    <section className="workspace">
      <SessionSidebar sessions={sessions} activeId={session?.meta.id} onSwitch={(id) => void changeSession(id)} onDelete={(id) => void deleteSession(id)} onArchive={(id, archived) => void archiveSession(id, archived)}
          onRename={(id, title) => {
            void bridge.renameSession(id, title).then((updated) => {
              setSession((current) => current && current.meta.id === id ? updated : current);
              setSessions((current) => current.map((meta) => meta.id === id ? updated.meta : meta));
            }).catch(() => undefined);
          }} onNew={() => void createSession()} onOpenSettings={() => void bridge.openSettings()} onOpenArchived={() => void bridge.openSettings("settings-sessions")} />
      <section className="conversation" aria-label="当前会话">
        {scrollSections.length > 1 && <ScrollProgress containerRef={messagesRef} sections={scrollSections} className="bottom-[132px]!" style={{ bottom: 132 }} />}
        <div className="messages" ref={messagesRef} onWheel={handleMessagesWheel} onScroll={handleMessagesScroll}>
          {session?.messages.length === 0 && <div className="empty-state"><AuroraBackdrop /><MatrixOrb size={200} state={orbState} stream={micStream} /><h2>开始一个课堂操作</h2><p>例如：查询张三积分，或给张三加 2 分。</p></div>}
          {session?.messages.map((message, index) => {
            const previous = index > 0 ? session.messages[index - 1] : undefined;
            const dayLabel = daySeparatorLabel(message.createdAt);
            const activities = message.activities?.length ? message.activities : message.toolCalls?.length ? message.toolCalls.map((call) => ({ kind: "tool" as const, ...call })) : message.id === latestAssistantId ? traceActivities : [];
            const reading = speakingMessageId === message.id;
            const visibleContent = message.role === "assistant" ? stripWorkspaceFilesMarkup(message.content) : message.content;
            // R57：模型/运行时异常消息（runSession 统一写入"执行失败："前缀）在对话内
            // 以错误态气泡呈现——留在会话流里可回溯，不再像零散警告。
            const isErrorNotice = message.role === "assistant" && message.content.startsWith("执行失败：");
            // R57：纯图片用户消息（无文本）气泡给占位提示，不再渲染空白气泡。
            const imageOnly = message.role === "user" && !message.content.trim() && (message.attachments?.length ?? 0) > 0;
            return <Fragment key={message.id}>{(!previous || daySeparatorLabel(previous.createdAt) !== dayLabel) && <DaySeparator label={dayLabel} id={daySeparatorId(message.createdAt)} />}<article className={`message ${message.role}`}><div className="message-content"><div className="message-meta">{message.role === "user" ? "教师" : "SecAgent"} · {new Date(message.createdAt).toLocaleTimeString()}</div>{message.role === "assistant" && <MessageActivities activities={activities} elapsedSeconds={message.id === latestAssistantId ? executionSeconds : undefined} stopped={message.stopped || (message.id === latestAssistantId && manuallyStopped)} isExecuting={sessionFinishing && message.id === latestAssistantId} activeStepKind={message.id === latestAssistantId ? activeStepKind : undefined} summaryRef={sessionFinishing && message.id === latestAssistantId ? executionSummaryRef : undefined} />}{message.role === "user" && message.attachments?.length ? <AttachmentStrip attachments={message.attachments} onOpen={setPreviewAttachment} /> : null}<div className="bubble-row"><div className="avatar">{message.role === "user" ? "你" : <img src="/icon.svg" alt="SecAgent" />}</div><div ref={message.role === "assistant" && message.id === latestAssistantId ? answerContentRef : undefined} className={`bubble ${message.role === "assistant" ? "markdown-bubble" : ""} ${isErrorNotice ? "error" : ""}`} onContextMenu={(event) => { event.preventDefault(); const selection = selectionInElement(event.currentTarget); setMessageMenu({ x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 176), messageId: message.id, text: message.content, role: message.role, selection }); }}>{isErrorNotice ? <div className="error-notice" role="alert"><span className="error-notice-title">模型请求失败</span><MarkdownContent>{visibleContent}</MarkdownContent></div> : message.role === "assistant" ? <MarkdownContent>{citationify(visibleContent, webSearchSourcesFor(message.toolCalls))}</MarkdownContent> : imageOnly ? <span className="image-only-hint">[图片]</span> : <UserQuotedContent content={message.content} />}</div>{message.role === "assistant" && <WorkspaceFileStrip content={message.content} />}{reading && (readingStatus === "loading" ? <LoaderCircle className="reading-icon loading" aria-label="正在生成语音" /> : <Volume2 className="reading-icon" aria-label="正在朗读" />)}</div><AuiMessageActions onCopy={() => void copyText(message.content)} />{message.role === "assistant" && <DeliverableCard toolCalls={message.toolCalls} />}{message.role === "assistant" && (message.toolCalls || []).some((call) => call.name === "web_search") ? <div className="message-websearch"><WebSearch status="done" sources={webSearchSourcesFor(message.toolCalls)} /></div> : null}{message.role === "assistant" && message.fallbackNotice && <p className="fallback-notice" role="status">{message.fallbackNotice}</p>}{message.role === "assistant" && message.stopped && <AuiStoppedRun reason={`已手动停止 · ${new Date(message.createdAt).toLocaleTimeString()}`} />}{message.role === "assistant" && message.hallucination?.signals.length ? <AuiGuardrailNotice title="幻觉检测提醒（仅提示，不代表一定有错）" explanation={message.hallucination.signals.map((signal) => signal.detail).join("；")} /> : null}</div></article></Fragment>;
          })}
          {/* R59：运行态按会话隔离——只在「本会话在跑」时渲染思考指示；切到新会话不再继承老会话的提示与停止按钮。 */}
          {sessionRunning && !sessionFinishing && <article className="message assistant"><div className="message-content"><div className="message-meta">SecAgent · 正在生成</div><MessageActivities activities={traceActivities} elapsedSeconds={executionSeconds} isExecuting activeStepKind={activeStepKind} summaryRef={executionSummaryRef} /><AiStatus state={aiStatusState} states={{ thinking: { label: "正在思考" }, researching: { label: "正在调用工具" }, analyzing: { label: "正在分析" }, writing: { label: "正在撰写" }, finalizing: { label: "正在收尾" }, done: { label: (elapsed) => (elapsed ? `已完成 · ${elapsed}` : "已完成") }, error: { label: (elapsed) => (elapsed ? `失败 · 用时 ${elapsed}` : "失败") } }} />
            {modelFallback && modelFallback.sessionId === session?.meta.id && (modelFallback.failed.length > 0 || modelFallback.current) && <div className="model-fallback-progress" role="status">
              {modelFallback.failed.slice(-3).map((failure, index) => <span key={index} className="model-fallback-step fail">✕ {failure.model}：{({quota:"配额用尽",auth:"鉴权失败",rate_limit:"限流",network:"网络错误",server:"服务端错误",aborted:"已中止",schema:"响应异常"} as Record<string, string>)[failure.kind] || failure.message.slice(0, 60)}</span>)}
              {modelFallback.current && <span className="model-fallback-step switch">↻ 正在切换备用模型：{modelFallback.current}（第 {modelFallback.switchCount} 次切换）</span>}
            </div>}<div className="bubble-row"><div className="avatar"><img src="/icon.svg" alt="SecAgent" /></div><div className="bubble loading markdown-bubble">{streamingOutput ? <MarkdownContent>{stripWorkspaceFilesMarkup(streamingOutput)}</MarkdownContent> : "正在调用模型与工具…"}</div><WorkspaceFileStrip content={streamingOutput} /></div>{liveWebSearch && <div className="message-websearch"><WebSearch status={liveWebSearch.searching ? "searching" : "done"} query={liveWebSearch.query} sources={liveWebSearch.sources} /></div>}</div></article>}
          <div />
        </div>
        {toolConfirmation && <ToolConfirmationDialog confirmation={toolConfirmation} onResolve={resolveToolConfirmation} />}
        <form ref={formRef} className={`composer ${composerDragging ? "dragging" : ""}`} onSubmit={send} onPointerDown={handleMicPointerDown} onPointerMove={handleMicPointerMove} onPointerUp={handleMicPointerUp} onPointerCancel={handleMicPointerCancel} onPaste={handlePaste} onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setComposerDragging(true); } }} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setComposerDragging(false); }} onDrop={handleDrop}><input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { void addImageFiles(event.target.files || []); event.target.value = ""; }} />{session && session.messages.length > 0 && <div className="composer-orb-dock" role="img" aria-label={`Agent 状态：${orbLabel || (orbState === "listening" ? "聆听中" : orbState === "thinking" ? "思考中" : "就绪")}`} title="按住可拖拽，松手回弹" ref={orbDockRef} onPointerDown={handleOrbPointerDown} onPointerMove={handleOrbPointerMove} onPointerUp={releaseOrbDock} onPointerCancel={releaseOrbDock}>{/* 状态播报职责在 speech-status；orbLabel 随每次工具调用高频变化，role="status" 会让读屏连读刷屏（R8 a11y）。R58：右下角状态球用 rare-ui FluidOrb。R60：换真源组件（WebGL fbm 流体着色器，禁止自研仿品）——状态表达改为调用侧组合：按状态传 color、listening 加呼吸类，组件本体零改动。 */}<FluidOrb size={40} color={orbState === "listening" ? ACCENT_SKY : orbState === "thinking" ? (orbAccent || ACCENT_DEEP) : ACCENT} className={orbState === "listening" ? "fluid-orb-pulse" : undefined} />{orbLabel && <span className="composer-orb-label">{orbLabel}</span>}</div>}{attachments.length > 0 && <div className="composer-attachments"><AttachmentStrip attachments={attachments} removable onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} /></div>}{quotedText && <div className="composer-quote"><div><strong>引用</strong><p>{quotedText}</p></div><button type="button" aria-label="取消引用" onClick={() => setQuotedText("")}>×</button></div>}{attachmentError && <div className="attachment-error">{attachmentError}</div>}{speechProcessing && !recording && speechMode === "streaming" ? <VoicePill recording={false} label={speechStatus || "正在识别…"} /> : speechStatus && !recording && !speechProcessing && <div className="speech-status" role="status">{speechStatus}</div>}
          {speechMode === "hold" && (recording || speechProcessing) ? <div className={`voice-recording-surface ${voiceDropZone === "cancel" ? "cancel-hover" : ""}`} aria-live="polite">
            {!speechProcessing && <div className="voice-drop-zones"><div ref={voiceCancelZoneRef} className={`voice-drop-zone voice-cancel-zone ${voiceDropZone === "cancel" ? "active" : ""}`}><strong>拖到这里取消</strong><small>松开取消识别</small></div><div ref={voiceEditZoneRef} className={`voice-drop-zone voice-edit-zone ${voiceDropZone === "edit" ? "active" : ""}`}><strong>拖到这里转文字</strong><small>松开写入输入框</small></div></div>}
            <div className="voice-recording-bar"><span className="voice-recording-status">{speechProcessing ? speechStatus || "正在识别…" : voiceDropZone === "edit" ? "松开写入输入框" : voiceDropZone === "cancel" ? "松开取消" : "松开直接发送"}</span><span className="voice-wave" aria-hidden="true">{[12, 22, 32, 43, 54, 42, 29, 19, 35, 49, 58, 45, 27, 18].map((height, index) => <i key={index} style={{ height: `${height}px`, animationDelay: `${index * 35}ms` }} />)}</span></div>
          </div> : <PromptBar
            className="app-promptbar"
            placeholder="输入文字，长按输入框说话，或点麦克风"
            sources={[{ key: "images", name: "图片上传", description: "从本机选择图片", attach: true }]}
            commands={[
              { key: "new-session", name: "/new", description: "新建会话", group: "会话" },
              { key: "stop", name: "/stop", description: "停止当前回复", group: "生成" },
              { key: "read", name: "/read", description: "朗读最后一条回复", group: "阅读" },
              { key: "stop-read", name: "/stop-read", description: "停止朗读", group: "阅读" },
              { key: "settings", name: "/settings", description: "打开设置", group: "应用" }
            ]}
            onCommandPick={(key) => {
              if (key === "new-session") void createSession();
              else if (key === "stop") { if (sessionRunning) void stop(); }
              else if (key === "read") {
                const target = session?.messages.filter((message) => message.role === "assistant" && message.content).at(-1);
                if (target) void readMessage(target.id, target.content);
              }
              else if (key === "stop-read") stopReading();
              else if (key === "settings") void bridge?.openSettings();
            }}
            models={orderedModels.map((model) => ({ key: model.id, name: model.name, tag: modelGroupLabel(model) }))}
            model={selectedModelId}
            onModelChange={setSelectedModelId}
            efforts={customModelMode ? reasoningEfforts.map((effort) => reasoningEffortLabels[effort]) : ["默认"]}
            defaultEffort={customModelMode ? reasoningEffortLabels[reasoningEffort] : "默认"}
            onEffortChange={(label) => { const effort = reasoningEfforts.find((candidate) => reasoningEffortLabels[candidate] === label); if (effort) setReasoningEffort(effort); }}
            busy={sessionRunning}
            onSend={(text) => { if (!session || voicePendingSendRef.current) return; void submitMessage(buildQuotedUserMessage(quotedText, text), attachments); }}
            onStop={() => { void stop(); }}
            onAttach={() => new Promise<string[]>((resolve) => { pendingAttachResolveRef.current = resolve; fileInputRef.current?.click(); })}
            onAttachRemove={(name) => setAttachments((current) => { const index = current.findIndex((attachment) => attachment.name === name); return index < 0 ? current : current.filter((_, position) => position !== index); })}
            onDictate={startPromptDictation}
            onDictateCancel={cancelPromptDictation}
            value={draft}
            onDraftChange={setDraft}
            background="var(--glass-strong)"
            color="var(--text-1)"
            menuBackground="var(--glass-strong)"
            sparkColor={ACCENT}
            width={2000}
            radius={15}
            maxRows={5}
          />}        </form>
      </section>
      <TracePanel activeTrace={activeTrace} isExecuting={sessionRunning && !sessionFinishing} />
    </section>
  </main>;
}
