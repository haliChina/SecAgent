import { useEffect, useRef, useState, type ReactElement } from "react";
import { PluginSettingsPanel } from "./PluginSettingsPanel.js";
import { SecScoreSettingsPage } from "./SecScoreSettingsPage.js";
import { PluginFormSettingsPage } from "./PluginFormSettingsPage.js";
import { PresetCombobox } from "./PresetCombobox.js";
import { SelectCombobox } from "./SelectCombobox.js";
import { OobeWizard } from "./OobeWizard.js";
import { reasoningEffortLabels, ttsRates, ttsVoices } from "../constants.js";
import { ASR_BAILIAN_PRESETS, ASR_OPENAI_PRESETS, BAILIAN_DEFAULTS, MIMO_ASR_DEFAULTS, type AsrProviderKind, type BailianAsrSettings, type MimoAsrSettings } from "../../../asr/settings.js";
import { emptyMcp, emptyProvider, isOfficialVisionModel, reasoningEffortsForModel } from "../utils.js";
import { formatOfficialBalanceExpiry, formatOfficialPoints } from "../official-balance.js";
import { Activity, Archive, Clock, Cpu, Globe, Mic, Puzzle, RefreshCw, Server, Settings2, Shield, Terminal, UserRound, Volume2 } from "lucide-react";
import { AnimatedCounter, HookSidebar, type HookSidebarItem } from "./ui/Bits.js";
import { SettingsAccountPage } from "./settings/SettingsAccountPage.js";
import { applyTheme, cacheTheme } from "../theme.js";
import { applyPerformanceMode } from "../performance-mode.js";
import { WakeHotkeyField, updateReleaseLabel, formatUpdateBytes } from "./SettingsFields.js";

// R49 重设计：导航分组（与侧栏 rail 的组标签对应）
const settingsNavGroups: Array<{ label: string; items: Array<{ id: string; label: string }> }> = [
  { label: "通用", items: [{ id: "settings-account", label: "账户与通用" }] },
  { label: "基础", items: [{ id: "settings-wake", label: "随时唤醒" }, { id: "settings-rules", label: "规则与记忆" }, { id: "settings-sessions", label: "已归档会话" }, { id: "settings-system", label: "系统" }, { id: "settings-updates", label: "更新" }, { id: "settings-telemetry", label: "诊断与隐私" }] },
  { label: "语音", items: [{ id: "settings-tts", label: "朗读" }, { id: "settings-asr", label: "语音识别" }] },
  { label: "模型与服务", items: [{ id: "settings-models", label: "模型" }, { id: "settings-websearch", label: "联网搜索" }, { id: "settings-mcp", label: "MCP 服务" }, { id: "settings-plugins", label: "插件" }, { id: "settings-commands", label: "命令" }] }
];

const settingsNavIcons: Record<string, typeof UserRound> = {
  "settings-account": UserRound,
  "settings-wake": Clock,
  "settings-rules": Shield,
  "settings-sessions": Archive,
  "settings-system": Settings2,
  "settings-updates": RefreshCw,
  "settings-telemetry": Activity,
  "settings-tts": Volume2,
  "settings-asr": Mic,
  "settings-models": Cpu,
  "settings-websearch": Globe,
  "settings-mcp": Server,
  "settings-plugins": Puzzle,
  "settings-commands": Terminal
};

/** 导航图标随组内项渲染；跟随 HookSidebar 的选中/悬停色变浅变实。 */
function navIcon(id: string): ReactElement {
  const Icon = settingsNavIcons[id] || Settings2;
  return <Icon size={16} strokeWidth={1.8} aria-hidden="true" />;
}

export function SettingsApp() {
  const bridge = window.secagent;
  const isOobe = new URLSearchParams(window.location.search).get("oobe") === "1";
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [providerPresets, setProviderPresets] = useState<ProviderPreset[]>([]);
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  /** Draft model id being typed into the inline "add model" row. */
  const [newModelDraft, setNewModelDraft] = useState("");
  const [modelsFetching, setModelsFetching] = useState(false);
  const [modelsFetchMessage, setModelsFetchMessage] = useState<string | null>(null);
  /** Speech-recognition connectivity test results, keyed by provider id. */
  const [asrTests, setAsrTests] = useState<Array<{ id: string; label: string; ok: boolean; message: string }> | null>(null);
  const [asrTesting, setAsrTesting] = useState(false);
  const [plugins, setPlugins] = useState<PluginStatus[]>([]);
  /* 技能开关：默认关闭的技能来自 settings.skills.disabled；列表本身每次进入
     「系统」页时重新扫描，工作区新增 SKILL.md 后无需重启设置窗。 */
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const refreshSkills = async (): Promise<void> => {
    try { setSkills(await bridge.listSkills()); } catch { /* 技能扫描失败不阻塞其他设置 */ }
  };
  const toggleSkill = (name: string, enabled: boolean): void => {
    setSettings((current) => {
      if (!current) return current;
      const disabled = (current.skills?.disabled || []).filter((item) => item !== name);
      return { ...current, skills: { disabled: enabled ? disabled : [...disabled, name] } };
    });
  };
  /* 自定义命令：编辑期间允许空提示词，保存时由主进程归一化（空条目不会落盘）。 */
  const addCustomCommand = (): void => {
    setSettings((current) => current && { ...current, commands: [...(current.commands || []), { name: "", description: "", prompt: "" }] });
  };
  const updateCustomCommand = (index: number, patch: Partial<CustomCommand>): void => {
    setSettings((current) => current && { ...current, commands: (current.commands || []).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  };
  const removeCustomCommand = (index: number): void => {
    setSettings((current) => current && { ...current, commands: (current.commands || []).filter((_, itemIndex) => itemIndex !== index) });
  };
  const [marketPlugins, setMarketPlugins] = useState<MarketplacePlugin[]>([]);
  const [marketError, setMarketError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [officialPoints, setOfficialPoints] = useState<number | null>(null);
  const [officialPointBalances, setOfficialPointBalances] = useState<Array<{ points: number; expiresAt: string | null }>>([]);
  const [officialPointsBusy, setOfficialPointsBusy] = useState(false);
  const [officialLoggedIn, setOfficialLoggedIn] = useState(false);
  const [officialEmail, setOfficialEmail] = useState("");
  const [officialExpired, setOfficialExpired] = useState(false);
  const [officialBusy, setOfficialBusy] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [diagnosticSessions, setDiagnosticSessions] = useState<SessionMeta[]>([]);
  const [diagnosticSessionId, setDiagnosticSessionId] = useState("");
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  // R73 已归档会话管理（设置页分区，侧栏只留紧凑入口）
  const [archivedSessions, setArchivedSessions] = useState<SessionMeta[]>([]);
  const [archiveBusyId, setArchiveBusyId] = useState("");
  const [archiveConfirmId, setArchiveConfirmId] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const settingsLoaded = useRef(false);
  const refreshArchivedSessions = async (): Promise<void> => {
    try {
      const all = await bridge.listSessions();
      setArchivedSessions(all.filter((item) => item.archived));
    } catch { /* 设置窗 IPC 失败按空列表处理 */ }
  };
  const skipAutosave = useRef(true);
  const [activePage, setActivePage] = useState(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const builtInPage = ["settings-account", "settings-wake", "settings-rules", "settings-sessions", "settings-tts", "settings-asr", "settings-models", "settings-websearch", "settings-mcp", "settings-plugins", "settings-commands", "settings-system", "settings-updates", "settings-telemetry"].includes(hash);
    return isOobe ? "settings-models" : ((builtInPage || hash.startsWith("plugin-")) ? hash : "settings-account");
  });
  // R73：已归档会话分区——进入分区时拉取；设置窗已开时经 settings:navigate 跳页。
  useEffect(() => { if (activePage === "settings-sessions") void refreshArchivedSessions(); }, [activePage]);
  useEffect(() => { if (!isOobe && activePage === "settings-system") void refreshSkills(); }, [activePage, isOobe]);
  useEffect(() => bridge.onSettingsNavigate((page) => { setActivePage(page); if (page === "settings-sessions") void refreshArchivedSessions(); }), []);

  // 音频设备枚举（麦克风/扬声器）；浏览器要求先授权麦克风才能看到 label。
  // 注意：这组 useState/useEffect 必须放在下方 isOobe / !settings 早退 return 之
  // 前：首渲染 settings 必为 null 走早退，配置加载完成后的下一次渲染才会走到
  // 这里——hook 出现在早退之后会让该次渲染比上次多一个 hook，React #310
  // 「Rendered more hooks than during the previous render」整窗崩溃。
  // 该顺序违规自 master 289adab 起即存在（真机设置窗口白屏/崩溃卡片真凶，
  // 现象被 ErrorBoundary 兜住后才拿到完整堆栈定位）。
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const refreshAudioDevices = async (): Promise<void> => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) { setAudioDevices([]); return; }
      let devices = await navigator.mediaDevices.enumerateDevices();
      if (devices.some((device) => !device.label) && navigator.mediaDevices.getUserMedia) {
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
          probe.getTracks().forEach((track) => track.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
        } catch { /* 拒绝授权时仍显示无 label 的设备 ID */ }
      }
      setAudioDevices(devices);
    } catch { setAudioDevices([]); }
  };
  useEffect(() => { void refreshAudioDevices(); }, []);
  useEffect(() => {
    let disposed = false;
    void bridge.getSettings().then((value) => {
      if (disposed) return;
      settingsLoaded.current = true;
      setSettings(value);
    }).catch((reason) => { if (!disposed) setError(String(reason)); });
    void bridge.listModels().then(setAvailableModels).catch(() => undefined);
    void bridge.listProviders().then(setProviderPresets).catch(() => undefined);
    return () => { disposed = true; };
  }, [bridge]);
  useEffect(() => {
    void bridge.listPlugins().then(setPlugins).catch((reason) => setError(String(reason)));
    return bridge.onPluginsChanged(setPlugins);
  }, [bridge]);
  useEffect(() => {
    void bridge.getUpdateState().then(setUpdateState).catch(() => undefined);
    return bridge.onUpdateState((next) => {
      setUpdateState(next);
      if (next.status === "error") setError(next.error || "更新失败，请查看诊断日志。");
    });
  }, [bridge]);
  useEffect(() => {
    if (isOobe) return;
    void bridge.listSessions().then((sessions) => {
      setDiagnosticSessions(sessions.slice(0, 20));
      setDiagnosticSessionId((current) => current || sessions[0]?.id || "");
    }).catch(() => undefined);
  }, [bridge, isOobe]);
  const refreshOfficialPoints = async () => {
    setOfficialPointsBusy(true);
    try {
      const result = await bridge.officialBalance();
      setOfficialPoints(result.points);
      // R62：IPC 运行时数据缺字段时整棵设置树崩白屏（本就是 R6 教训类 bug）——balances 缺省回落 []。
      setOfficialPointBalances(Array.isArray(result.balances) ? result.balances : []);
      setOfficialExpired(result.expired);
      if (result.expired) {
        setOfficialLoggedIn(false);
        setError("登录已过期，请重新登录。");
      }
    } catch { setOfficialPoints(null); setOfficialPointBalances([]); setOfficialExpired(false); } finally { setOfficialPointsBusy(false); }
  };
  useEffect(() => { void bridge.officialStatus().then((status) => { setOfficialLoggedIn(status.loggedIn); setOfficialEmail(typeof status.email === "string" ? status.email : ""); if (status.loggedIn) void refreshOfficialPoints(); }).catch(() => undefined); }, [bridge]);
  useEffect(() => {
    if (isOobe || !settings || !settingsLoaded.current) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    // A newly added model is intentionally an incomplete draft. Do not send it
    // through the strict config validator until the required fields are filled.
    // (apiKeyEnv is not checked: the main process auto-derives it on save.)
    const hasIncompleteModel = settings.providers.some((provider) => (
      !provider.id.trim() || !provider.name.trim() || !provider.baseUrl.trim() || !provider.models.length
    ));
    if (hasIncompleteModel) {
      setError("");
      return;
    }
    const timer = window.setTimeout(() => {
      setError("");
      void bridge.saveSettings(settings).catch(async (reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        // A conflicting wake shortcut is deliberately not persisted by the
        // main process. Reflect that authoritative value in the editor while
        // preserving unrelated draft changes.
        try {
          const persisted = await bridge.getSettings();
          if (persisted.wake.hotkey !== settings.wake.hotkey) {
            setSettings((current) => current && current.wake.hotkey === settings.wake.hotkey ? { ...current, wake: persisted.wake } : current);
          }
        } catch { /* Keep the original save error visible. */ }
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [bridge, isOobe, settings]);
  useEffect(() => {
    const draft = settings?.models.find((model) => model.id.startsWith("model-"));
    if (!draft || providerModalOpen) return;
    setEditingProvider({ id: draft.id, name: draft.name || "新提供商", preset: "custom", provider: draft.provider, apiKeyEnv: draft.apiKeyEnv, apiKey: draft.apiKey, baseUrl: draft.baseUrl, endpoint: draft.endpoint, maxTokens: draft.maxTokens, models: draft.model ? [{ id: draft.model, name: draft.name || draft.model }] : [] });
    setProviderModalOpen(true);
    setSettings((current) => current && { ...current, models: current.models.filter((model) => model.id !== draft.id) });
  }, [settings, providerModalOpen]);
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(".official-balance-row");
    if (!row) {
      document.querySelectorAll(".official-balance-groups").forEach((element) => element.remove());
      return;
    }
    const value = row.querySelector<HTMLElement>(".points-value");
    if (value) value.textContent = officialPointsBusy ? "读取中…" : officialPoints === null ? "暂不可用" : `${formatOfficialPoints(officialPoints)} Points`;
    const host = row.parentElement;
    if (!host) return;
    let groups = host.querySelector<HTMLElement>(".official-balance-groups");
    if (!groups) {
      groups = document.createElement("div");
      groups.className = "official-balance-groups";
      host.insertBefore(groups, row.nextSibling);
    }
    groups.replaceChildren(...(officialPointBalances.length ? officialPointBalances.map((balance) => {
      const item = document.createElement("div");
      item.className = "official-balance-group";
      const points = document.createElement("strong");
      points.textContent = `${formatOfficialPoints(balance.points)} Points`;
      const expiry = document.createElement("span");
      expiry.textContent = formatOfficialBalanceExpiry(balance.expiresAt);
      item.append(points, expiry);
      return item;
    }) : [Object.assign(document.createElement("span"), { textContent: "暂无有效额度" })]));
  });
  if (isOobe) return <OobeWizard />;
  if (!settings) return <main className="settings-shell"><p>正在读取配置…</p></main>;
  const updateProvider = (patch: Partial<ProviderConfig>) => setEditingProvider((current) => current && { ...current, ...patch });
  const presetLocked = !!editingProvider?.preset && editingProvider.preset !== "custom";
  const updateModel = (_index: number, _patch: Partial<ModelProfile>) => undefined;
  const selectProvider = (_index: number, _provider: ModelProfile["provider"]) => undefined;
  const applyProviderPreset = (presetId: string) => {
    if (!editingProvider) return;
    if (presetId === "custom") { updateProvider({ preset: "custom" }); return; }
    const preset = providerPresets.find((item) => item.id === presetId);
    if (!preset) return;
    let env = `${preset.name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_API_KEY`;
    // Applying the same preset twice (e.g. two accounts at one relay) used to
    // produce two providers with the same env var, so their API keys silently
    // overwrote each other in .env. Give later ones a numbered suffix instead.
    const taken = new Set(settings.providers.filter((provider) => provider.id !== editingProvider.id).map((provider) => provider.apiKeyEnv));
    if (taken.has(env)) {
      let suffix = 2;
      while (taken.has(`${env}_${suffix}`)) suffix++;
      env = `${env}_${suffix}`;
    }
    const isAnthropic = /anthropic/i.test(preset.id);
    const isGoogle = /google|gemini/i.test(preset.id);
    const baseUrl = isAnthropic || isGoogle || !preset.api || /\/v1(?:beta)?\/?$/i.test(preset.api) ? preset.api : `${preset.api.replace(/\/$/, "")}/v1`;
    updateProvider({ preset: preset.id, name: preset.name, apiKeyEnv: env, baseUrl: baseUrl || editingProvider.baseUrl, provider: isGoogle ? "google" : isAnthropic ? "anthropic" : "openai-compatible", endpoint: isGoogle ? "" : isAnthropic ? "/v1/messages" : "/chat/completions", models: preset.models.map((model) => ({ id: model.id, name: model.name || model.id, enabled: true })) });
  };
  const saveProvider = () => {
    if (!editingProvider || !editingProvider.name.trim() || !editingProvider.baseUrl.trim() || !editingProvider.models.length) { setError("请填写提供商信息并至少添加一个模型"); return; }
    setSettings((current) => current && { ...current, providers: current.providers.some((provider) => provider.id === editingProvider.id) ? current.providers.map((provider) => provider.id === editingProvider.id ? editingProvider : provider) : [...current.providers, editingProvider] });
    setProviderModalOpen(false); setEditingProvider(null);
  };
  const removeProvider = (id: string) => setSettings((current) => current && { ...current, providers: current.providers.filter((provider) => provider.id !== id) });
  const updateServer = (name: string, patch: Partial<McpServerConfig>) => setSettings((current) => current && { ...current, mcp: { servers: Object.fromEntries(Object.entries(current.mcp.servers).map(([key, server]) => [key, key === name ? { ...server, ...patch } : server])) } });
  const renameServer = (oldName: string, newName: string) => {
    const name = newName.trim();
    if (!name || (name !== oldName && settings.mcp.servers[name])) return;
    setSettings((current) => current && { ...current, mcp: { servers: Object.fromEntries(Object.entries(current.mcp.servers).map(([key, server]) => [key === oldName ? name : key, server])) } });
  };
  const officialLogin = async () => {
    setError(""); setOfficialBusy(true);
    try { const next = await bridge.officialOAuthLogin(); setSettings(next); setAvailableModels(await bridge.listModels()); setOfficialLoggedIn(true); setOfficialExpired(false); await refreshOfficialPoints(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setOfficialBusy(false); }
  };
  const redeemOfficialCode = async () => {
    const code = redeemCode.trim();
    if (!code) { setError("请输入兑换码"); return; }
    setError(""); setSuccess(""); setRedeemBusy(true);
    try {
      const result = await bridge.officialRedeem(code);
      setRedeemCode("");
      setSuccess(`兑换成功，获得 ${formatOfficialPoints(result.pointsAdded)} Points（${formatOfficialBalanceExpiry(result.expiresAt)}）`);
      await refreshOfficialPoints();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRedeemBusy(false); }
  };
  const officialLogout = async () => { await bridge.officialLogout(); setOfficialLoggedIn(false); setOfficialExpired(false); setOfficialPoints(null); setOfficialPointBalances([]); setSettings((current) => current && { ...current, providers: current.providers.filter((provider) => provider.id !== "sectl-official") }); };
  const checkForUpdate = async () => {
    setError("");
    try {
      const next = await bridge.checkForUpdate();
      setUpdateState(next);
      if (next.status === "error") setError(next.error || "更新检查失败，请查看诊断日志。");
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const downloadUpdate = async () => {
    setError("");
    try {
      const next = await bridge.downloadUpdate();
      setUpdateState(next);
      if (next.status === "error") setError(next.error || "更新下载失败，请查看诊断日志。");
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const installUpdate = async () => {
    setError("");
    try {
      const next = await bridge.installUpdate();
      setUpdateState(next);
      if (next.status === "error") setError(next.error || "更新安装失败，请查看诊断日志。");
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const openUpdateLogs = async () => {
    setError("");
    try {
      const directory = await bridge.openDiagnosticLogs();
      setSuccess(`日志目录已打开：${directory}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const exportUpdateLogs = async () => {
    setError("");
    try {
      const result = await bridge.exportDiagnosticLogs();
      if (!result.canceled && result.path) setSuccess(`诊断日志已导出：${result.path}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const uploadDiagnostic = async () => {
    if (!diagnosticSessionId || !settings.telemetry.enabled) return;
    if (!window.confirm("将上传所选会话的消息内容和脱敏运行 trace，仅用于故障诊断。是否继续？")) return;
    setDiagnosticBusy(true);
    setError(""); setSuccess("");
    try {
      const result = await bridge.uploadDiagnostic(diagnosticSessionId);
      setSuccess(`诊断包已上传（${Math.round(result.bytes / 1024)} KB）`);
    } catch (reason) {
      setSuccess("");
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setDiagnosticBusy(false); }
  };
  const mainModelOptions = availableModels.filter((model) => !isOfficialVisionModel(model));
  const defaultModel = mainModelOptions.find((model) => model.id === settings.defaultModelId) || mainModelOptions.find((model) => model.id === "sectl-official") || mainModelOptions[0];
  const defaultReasoningEfforts = reasoningEffortsForModel(defaultModel);
  const defaultReasoningEffort = defaultReasoningEfforts.includes(settings.defaultReasoningEffort || "high") ? (settings.defaultReasoningEffort || "high") : defaultReasoningEfforts.includes("high") ? "high" : defaultReasoningEfforts[0];
  const updateSupported = bridge.platform === "win32";
  const updateProgress = updateState?.totalBytes ? Math.min(100, Math.round(updateState.downloadedBytes / updateState.totalBytes * 100)) : undefined;
  const updateReleaseType = updateReleaseLabel(updateState?.release, settings.updates.channel);
  const speechProvider = settings.speech?.provider || "auto";
  const bailianSelected = speechProvider === "bailian" || speechProvider === "bailian-ws";
  const bailian = settings.speech?.bailian;
  const updateBailian = (patch: Partial<BailianAsrSettings> & { apiKey?: string; apiKeyConfigured?: boolean }): void => setSettings((current) => current && { ...current, speech: { ...current.speech, bailian: { ...BAILIAN_DEFAULTS, ...(current.speech?.bailian || {}), ...patch } } });
  const mimo = settings.speech?.mimo;
  const updateMimo = (patch: Partial<MimoAsrSettings> & { apiKey?: string; apiKeyConfigured?: boolean }): void => setSettings((current) => current && { ...current, speech: { ...current.speech, mimo: { ...MIMO_ASR_DEFAULTS, ...(current.speech?.mimo || {}), ...patch } } });
  // R62：语音识别就语音识别——普通人只暴露 自动/官方/本机 三项；第三方接入
// （OpenAI 兼容/百炼/MiMo）整卡收进底部 <details>（默认折叠）。已选第三方
// 值的用户在下拉里以单项保留显示，能正常切回，不会"消失"。
const THIRD_PARTY_PROVIDERS = new Set(["openai", "bailian", "bailian-ws", "mimo"]);
/** R62：简化后的服务选项；当前值若是第三方项则附加一项保显示（THIRD_PARTY_PROVIDERS 注释）。 */
const asrProviderOptions: Array<{ value: string; label: string }> = [
  { value: "auto", label: "自动（推荐）" },
  { value: "official", label: "官方云服务（本机已登录账号）" },
  { value: "local", label: "本机离线（无需网络）" },
  ...(THIRD_PARTY_PROVIDERS.has(settings.speech?.provider || "auto")
    ? [{ value: settings.speech?.provider || "openai", label: "第三方云服务（在下方「高级」里配置）" }]
    : []),
  { value: "local-pro", label: "本机增强（SenseVoice，需另装附加包）" },
];
// 可选的 ASR 回退链条目（与 src/asr/settings.ts 的 provider 白名单一致）。
  const asrChainEntries: Array<{ value: string; label: string }> = [
    { value: "bailian-ws", label: "百炼 · WebSocket 流式" },
    { value: "bailian", label: "百炼 · chat/completions" },
    { value: "mimo", label: "小米 MiMo ASR" },
    { value: "openai", label: "第三方 OpenAI 兼容" },
    { value: "official", label: "官方云端（SECTL）" },
    { value: "local-pro", label: "本地增强（SenseVoice 附加包）" },
    { value: "local", label: "本地离线（随安装包）" }
  ];
  const updateAsrChain = (next: string[]): void => setSettings((current) => current && { ...current, speech: { ...current.speech, chain: next } });
  const audioInputOptions = [
    { value: "auto", label: "自动检测（推荐）" },
    { value: "default", label: "系统默认" },
    ...audioDevices.filter((device) => device.kind === "audioinput").map((device) => ({ value: device.deviceId, label: device.label || `麦克风 ${device.deviceId.slice(0, 8)}` }))
  ];
  const audioOutputOptions = [
    { value: "auto", label: "系统默认" },
    ...audioDevices.filter((device) => device.kind === "audiooutput").map((device) => ({ value: device.deviceId, label: device.label || `扬声器 ${device.deviceId.slice(0, 8)}` }))
  ];
  // TTS 提供商与回退链（tts.chain）。
  const ttsProvider = settings.tts?.provider || "edge";
  const ttsChain = settings.tts?.chain || ["edge", "windows"];
  const updateTts = (patch: Partial<SettingsPayload["tts"]>): void => setSettings((current) => current && { ...current, tts: { ...current.tts, ...patch } as SettingsPayload["tts"] });
  const ttsEntries: Array<{ value: string; label: string }> = [
    { value: "edge", label: "Edge TTS（免费在线，音色最自然）" },
    { value: "windows", label: "Windows 系统朗读（SAPI，离线可用）" },
    { value: "mimo", label: "小米 MiMo TTS（云端，需 API Key）" },
    { value: "bailian", label: "阿里云百炼 CosyVoice（云端，需 API Key）" }
  ];
  const pluginNavPages = plugins.flatMap((plugin) => (plugin.enabled ? (plugin.settingsPages ?? []) : []).map((page) => ({ id: `plugin-${plugin.id}-${page.id}`, label: page.title })));
  return <main className={`settings-shell has-window-title ${isOobe ? "oobe-shell" : ""} ${activePage === "settings-plugins" ? "plugin-settings-shell" : ""} ${bridge.platform === "darwin" ? "macos-settings" : ""} ${bridge.platform !== "darwin" ? "windows-settings" : ""}`}>
    {/* R61：设置窗顶栏——与主窗 .topbar 同语言（实底 bg-1/下边线/品牌位/拖拽区）。
        原 57px 透明浮字无栏感，Windows 上系统窗控直接压在设置内容上。 */}
    <div className="settings-window-title"><span className="settings-brand">SecAgent</span><span className="settings-window-title-sub">设置</span></div>
    {!isOobe && <HookSidebar
      activeId={activePage}
      onSelect={(id) => { setActivePage(id); window.history.replaceState(null, "", `#${id}`); }}
      items={[
        // 一条轨道贯穿整列；分组标签贴在组首项之前（只设首项），标签左对齐轨道
        ...settingsNavGroups.flatMap((group) => group.items.map((item, itemIndex) => ({
          id: item.id,
          label: item.label,
          icon: navIcon(item.id),
          ...(itemIndex === 0 ? { group: group.label } : {})
        }))),
        // 已安装插件声明的 settingsPages（plugin-<pluginId>-<pageId>）动态并入导航。
        ...pluginNavPages.map((item, index) => ({
          id: item.id,
          label: item.label,
          icon: navIcon("settings-plugins"),
          ...(index === 0 ? { group: "插件设置" } : {})
        } satisfies HookSidebarItem))
      ] satisfies HookSidebarItem[]}
    />}
    {error && <div className="settings-error">{error}</div>}
    {success && <div className="settings-success">{success}</div>}
    {!isOobe && <section id="settings-account" className={`settings-section ${activePage === "settings-account" ? "settings-section-active" : ""}`}>
      {/* R78：新「账户与通用」页——行式分组 + 用户卡片 + 二次确认退出/清缓存。 */}
      <SettingsAccountPage
        theme={settings.theme || "light"}
        performance={settings.performance || "auto"}
        onPerformanceChange={(performance) => {
          applyPerformanceMode(performance, document.documentElement.dataset.display === "big-touch");
          setSettings((current) => current && { ...current, performance });
        }}
        onThemeChange={(theme) => {
          // 先本地即时换肤（设置窗自身），再交给自动保存落盘并广播主窗。
          cacheTheme(theme);
          applyTheme(theme);
          setSettings((current) => current && { ...current, theme });
        }}
        version={updateState?.currentVersion}
        officialLoggedIn={officialLoggedIn}
        officialEmail={officialEmail}
        points={officialPoints}
        modelCount={availableModels.length}
        onNavigate={(page) => { setActivePage(page); window.history.replaceState(null, "", `#${page}`); }}
        onOpenExternal={(url) => void bridge.openExternal(url)}
        onLogout={officialLogout}
      />
    </section>}
    <section id="settings-wake" className={`settings-section ${isOobe || activePage === "settings-wake" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>随时唤醒</h2></div></div>
      <article className="settings-card"><WakeHotkeyField value={settings.wake.hotkey} platform={bridge.platform} onChange={(hotkey) => setSettings((current) => current && { ...current, wake: { ...current.wake, hotkey } })} /><div className="form-grid wake-model-setting"><label>随时唤起使用的模型<SelectCombobox ariaLabel="随时唤起使用的模型" value={settings.wake.modelId || settings.defaultModelId || mainModelOptions[0]?.id || ""} options={mainModelOptions.map((model) => ({ value: model.id, label: model.name, group: model.providerLabel }))} onChange={(modelId) => setSettings((current) => current && { ...current, wake: { ...current.wake, modelId } })} /></label></div><label className="toggle-row"><span className="toggle-copy"><strong>语音唤醒</strong><small>开启后持续使用麦克风，识别到唤醒词后等同于按下上面的快捷键。</small></span><input type="checkbox" checked={settings.wake.voiceEnabled === true} onChange={(event) => setSettings((current) => current && { ...current, wake: { ...current.wake, voiceEnabled: event.target.checked } })} /></label><label className="wake-phrase-field">唤醒词<input value={settings.wake.voicePhrase || "小泽同学"} onChange={(event) => setSettings((current) => current && { ...current, wake: { ...current.wake, voicePhrase: event.target.value } })} placeholder="小泽同学" /></label><p className="settings-help">Windows/Linux 默认 Ctrl Alt A；macOS 默认 Ctrl Option A。语音唤醒始终使用随安装包提供的本地模型，无需网络；麦克风与「语音识别 → 输入设备」共用，建议选一体机的远场阵列麦。</p></article>    </section>
    <section id="settings-rules" className={`settings-section ${isOobe || activePage === "settings-rules" ? "settings-section-active" : ""}`}>
      <div className="section-title"><div><h2>规则与记忆</h2><p>写下长期要求，每次对话都会遵守。</p></div></div>
      <article className="settings-card">
        <label className="toggle-row"><span className="toggle-copy"><strong>启用自定义规则</strong><small>关闭后保留文本，但不会生效。</small></span><input type="checkbox" checked={settings.rules?.enabled !== false} onChange={(event) => setSettings((current) => current && { ...current, rules: { enabled: event.target.checked, text: current.rules?.text || "" } })} /></label>
        {settings.rules?.enabled !== false && <div className="form-grid"><label className="wide-field">规则内容<textarea rows={8} value={settings.rules?.text || ""} placeholder="例如：始终用简体中文回答；修改代码后必须运行 npm test；不要删除未备份的文件；解释时先给结论再展开。" onChange={(event) => setSettings((current) => current && { ...current, rules: { enabled: current.rules?.enabled !== false, text: event.target.value } })} /></label></div>}
        <p className="settings-help">规则只保存在本机，留空则使用默认设置。</p>
      </article>
    </section>
    <section id="settings-sessions" className={`settings-section ${activePage === "settings-sessions" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>已归档会话</h2></div></div>
      <article className="settings-card"><div className="card-heading"><strong>自动归档</strong></div>
        <label className="toggle-row"><span className="toggle-copy"><strong>自动归档旧会话</strong><small>启动时扫描；超过保留期的会话会自动收进这里。</small></span><input type="checkbox" checked={settings.archive?.auto === true} onChange={(event) => setSettings((current) => current && { ...current, archive: { auto: event.target.checked, retentionDays: current.archive?.retentionDays || 7 } })} /></label>
        {settings.archive?.auto === true && <div className="form-grid"><label>保留时长<SelectCombobox ariaLabel="自动归档保留时长" value={String(settings.archive?.retentionDays || 7)} options={[{ value: "3", label: "3 天后归档" }, { value: "7", label: "7 天后归档" }, { value: "14", label: "14 天后归档" }, { value: "30", label: "30 天后归档" }]} onChange={(days) => setSettings((current) => current && { ...current, archive: { auto: current.archive?.auto === true, retentionDays: Number(days) } })} /></label></div>}
        <p className="settings-help">按最后更新时间判断，正在使用的会话不会归档。</p>
      </article>
      <div className="settings-card">
        {archiveError && <p className="archived-session-error">{archiveError}</p>}
        {archivedSessions.length === 0 ? <p className="settings-hint">还没有归档会话。在会话行的 ⋯ 菜单里选择「归档会话」。</p> : <div className="archived-session-list">
          {archivedSessions.map((item) => <div className="archived-session-row" key={item.id}>
            <div className="archived-session-info">
              <span className="archived-session-title" title={item.title}>{item.title}</span>
              <span className="archived-session-meta">{new Date(item.updatedAt).toLocaleString()}{item.preview ? ` · ${item.preview.slice(0, 30)}` : ""}</span>
            </div>
            <div className="archived-session-actions">
              <button className="secondary-button" type="button" disabled={archiveBusyId === item.id} onClick={() => { setArchiveBusyId(item.id); setArchiveError(""); void bridge.archiveSession(item.id, false).then(() => refreshArchivedSessions()).catch((error: unknown) => setArchiveError(String(error))).finally(() => setArchiveBusyId("")); }}>恢复</button>
              {archiveConfirmId === item.id
                ? <span className="archived-session-confirm"><button className="primary-button archived-delete-final" type="button" disabled={archiveBusyId === item.id} onClick={() => { setArchiveBusyId(item.id); setArchiveError(""); void bridge.deleteSession(item.id).then(() => refreshArchivedSessions()).catch((error: unknown) => setArchiveError(String(error))).finally(() => { setArchiveBusyId(""); setArchiveConfirmId(""); }); }}>确认删除</button><button className="secondary-button" type="button" onClick={() => setArchiveConfirmId("")}>取消</button></span>
                : <button className="secondary-button archived-delete-first" type="button" disabled={archiveBusyId === item.id} onClick={() => setArchiveConfirmId(item.id)}>删除</button>}
            </div>
          </div>)}
        </div>}
      </div>
    </section>
    <section id="settings-updates" className={`settings-section ${activePage === "settings-updates" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>更新</h2></div></div>
      <article className="settings-card update-settings-card">
        {!updateSupported ? <p className="settings-help">当前平台暂不支持应用内更新。</p> : <>
          {updateState?.status === "unsupported" && <div className="settings-help update-warning"><strong>暂不支持应用内更新</strong><span>{updateState.supportReason || updateState.error || "当前环境不支持应用内更新。"}</span></div>}
          {updateState?.status === "error" && <div className="settings-error update-error"><strong>更新检查失败</strong><span>{updateState.error || "请查看诊断日志。"}</span><button type="button" className="text-button" onClick={() => void checkForUpdate()}>重试</button></div>}
          <div className="update-version-row"><div><span className="settings-help">当前版本</span><strong>{updateState?.currentVersion || "读取中…"}</strong></div><button type="button" className="secondary-button" disabled={updateState?.status === "checking"} onClick={() => void checkForUpdate()}>{updateState?.status === "checking" ? "检查中…" : "检查更新"}</button></div>
          <div className="form-grid update-channel-grid"><label>更新通道<SelectCombobox ariaLabel="更新通道" value={settings.updates.channel} options={[{ value: "stable", label: "普通版" }, { value: "preview", label: "预览版" }]} onChange={(channel) => setSettings((current) => current && { ...current, updates: { ...current.updates, channel: channel as UpdateChannel } })} /></label></div>
          <div className="update-diagnostic-actions"><button type="button" className="secondary-button" onClick={() => void openUpdateLogs()}>打开日志目录</button><button type="button" className="secondary-button" onClick={() => void exportUpdateLogs()}>导出诊断日志</button></div>
          <label className="toggle-row"><span className="toggle-copy"><strong>自动检查更新</strong><small>启动后及每 6 小时检查一次 GitHub Release。</small></span><input type="checkbox" checked={settings.updates.autoCheck} onChange={(event) => setSettings((current) => current && { ...current, updates: { ...current.updates, autoCheck: event.target.checked } })} /></label>
          <label className="toggle-row"><span className="toggle-copy"><strong>自动下载更新</strong><small>自动检查发现新版本后，后台下载完整 Windows 安装包。</small></span><input type="checkbox" checked={settings.updates.autoDownload} onChange={(event) => setSettings((current) => current && { ...current, updates: { ...current.updates, autoDownload: event.target.checked } })} /></label>
          <label className="toggle-row"><span className="toggle-copy"><strong>退出应用后自动安装</strong><small>已有下载完成的更新时，在应用退出过程中静默运行安装程序。</small></span><input type="checkbox" checked={settings.updates.autoInstallOnQuit} onChange={(event) => setSettings((current) => current && { ...current, updates: { ...current.updates, autoInstallOnQuit: event.target.checked } })} /></label>
          {updateState?.status === "downloading" && <div className="update-progress"><div className="update-progress-label"><span>正在下载 {updateState.release?.version || "更新"}</span><span>{updateProgress === undefined ? formatUpdateBytes(updateState.downloadedBytes) : `${updateProgress}%`}</span></div><progress max="100" value={updateProgress ?? 0} /></div>}
          {updateState?.status === "up-to-date" && <p className="settings-help update-success">当前已是最新的{settings.updates.channel === "preview" ? "预览" : "稳定"}版本。</p>}
          {updateState?.release && <div className="update-release-card"><div className="card-heading"><div><strong>{updateState.release.version}</strong><span>{updateReleaseType}{updateState.release.publishedAt ? ` · ${new Date(updateState.release.publishedAt).toLocaleDateString()}` : ""}</span></div><button type="button" className="text-button" onClick={() => void bridge.openExternal(updateState.release!.htmlUrl)}>查看 Release</button></div>{updateState.release.body && <pre className="update-release-notes">{updateState.release.body}</pre>}<div className="update-actions">{updateState.status === "available" && <button type="button" className="primary-button" onClick={() => void downloadUpdate()}>下载更新</button>}{updateState.status === "downloaded" && <><span className="update-downloaded">已下载 {updateState.downloadedVersion}</span><button type="button" className="primary-button" onClick={() => void installUpdate()}>立即安装</button></>}{updateState.status === "installing" && <span className="update-downloaded">正在准备安装，应用即将退出…</span>}</div></div>}
          {updateState?.status === "downloaded" && !updateState.release && <div className="update-release-card"><div className="card-heading"><div><strong>{updateState.downloadedVersion}</strong><span>已下载，等待安装</span></div><button type="button" className="primary-button" onClick={() => void installUpdate()}>立即安装</button></div></div>}
        </>}
      </article>
    </section>
    <section id="settings-tts" className={`settings-section ${isOobe || activePage === "settings-tts" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>朗读</h2></div></div>
      <article className="settings-card"><div className="form-grid"><label className="wide-field">朗读引擎<SelectCombobox ariaLabel="朗读引擎" value={ttsProvider} options={ttsEntries} onChange={(provider) => updateTts({ provider: provider as "edge" | "windows" | "mimo" | "bailian" })} /></label><label className="wide-field">主引擎<SelectCombobox ariaLabel="朗读主引擎" value={ttsChain[0]} options={ttsEntries.map((entry) => ({ value: entry.value, label: entry.label }))} onChange={(value) => { const kind = value as "edge" | "windows" | "mimo" | "bailian"; if (ttsChain[0] !== kind) updateTts({ chain: [kind, ...ttsChain.filter((k) => k !== kind)] }); }} /></label><label className="wide-field">备用引擎（按顺序）<div className="tts-chain-editor"><small>主引擎之外，按勾选顺序依次尝试：</small>{ttsEntries.map((entry) => <label key={`f-${entry.value}`} className="checkbox-label"><input type="checkbox" checked={ttsChain.includes(entry.value as "edge" | "windows" | "mimo" | "bailian")} disabled={ttsChain[0] === entry.value} onChange={(event) => updateTts({ chain: event.target.checked ? [...ttsChain, entry.value as "edge" | "windows" | "mimo" | "bailian"] : ttsChain.filter((kind) => kind !== entry.value) })} /> {entry.label.split("（")[0]}</label>)}</div></label><label>语音音色（Edge/Windows）<SelectCombobox ariaLabel="语音音色" value={settings.tts.voice} options={ttsVoices.map(([value, label]) => ({ value, label }))} onChange={(voice) => updateTts({ voice })} /></label><label>语速<SelectCombobox ariaLabel="语速" value={settings.tts.rate} options={ttsRates.map(([value, label]) => ({ value, label }))} onChange={(rate) => updateTts({ rate })} /></label>{ttsChain.includes("mimo") && <label>小米 MiMo TTS 音色<SelectCombobox ariaLabel="MiMo TTS 音色" value={settings.tts?.mimo?.voice || "mimo_default"} options={[{ value: "mimo_default", label: "MiMo 默认" }, { value: "bingtang", label: "冰糖" }, { value: "moli", label: "茉莉" }, { value: "suda", label: "苏打" }, { value: "baihua", label: "白桦" }, { value: "Mia", label: "Mia" }, { value: "Chloe", label: "Chloe" }, { value: "Milo", label: "Milo" }, { value: "Dean", label: "Dean" }]} onChange={(voice) => setSettings((current) => current && { ...current, tts: { ...current.tts, mimo: { ...(current.tts.mimo || { apiKeyEnv: "MIMO_TTS_API_KEY" }), voice } } as SettingsPayload["tts"] })} /></label>}{ttsChain.includes("mimo") && <label>小米 MiMo TTS API Key<input type="password" placeholder={settings.tts?.mimo?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 MiMo API Key"} value={settings.tts?.mimo?.apiKey || ""} onChange={(event) => setSettings((current) => current && { ...current, tts: { ...current.tts, mimo: { ...(current.tts.mimo || { apiKeyEnv: "MIMO_TTS_API_KEY" }), apiKey: event.target.value } } as SettingsPayload["tts"] })} /></label>}{ttsChain.includes("bailian") && <label>百炼 CosyVoice 音色<input placeholder="longanyang（查看官方音色列表）" value={settings.tts?.bailian?.voice || ""} onChange={(event) => setSettings((current) => current && { ...current, tts: { ...current.tts, bailian: { ...(current.tts.bailian || { apiKeyEnv: "BAILIAN_TTS_API_KEY" }), voice: event.target.value } } as SettingsPayload["tts"] })} /></label>}{ttsChain.includes("bailian") && <label>百炼 CosyVoice API Key<input type="password" placeholder={settings.tts?.bailian?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴百炼 API Key"} value={settings.tts?.bailian?.apiKey || ""} onChange={(event) => setSettings((current) => current && { ...current, tts: { ...current.tts, bailian: { ...(current.tts.bailian || { apiKeyEnv: "BAILIAN_TTS_API_KEY" }), apiKey: event.target.value } } as SettingsPayload["tts"] })} /></label>}</div><label className="toggle-row"><span className="toggle-copy"><strong>朗读代码块</strong><small>关闭时跳过 Markdown 围栏代码，避免把符号和缩进读成噪声。</small></span><input type="checkbox" checked={settings.tts?.readCodeBlocks === true} onChange={(event) => updateTts({ readCodeBlocks: event.target.checked })} /></label><p className="settings-help">Edge 在线免费；Windows 朗读可离线使用；MiMo 与 CosyVoice 为付费服务，密钥保存在工作区 .env。</p></article>
    </section>
    <section id="settings-asr" className={`settings-section ${activePage === "settings-asr" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>语音识别</h2></div></div>
      {/* R59：UX 重排——拆一张大卡为分层卡片。普通人只需看第 1 卡（选服务）
          与第 2 卡（选麦克风）；云端接入细节收进第 4 卡"高级"，不再一屏
          堆十几个陌生字段。 */}
      <article className="settings-card">
        <div className="card-heading"><strong>用哪个识别服务</strong></div>
        <div className="form-grid"><label className="wide-field">识别服务<SelectCombobox ariaLabel="识别服务" value={settings.speech?.provider || "auto"} options={asrProviderOptions} onChange={(provider) => setSettings((current) => current && { ...current, speech: { ...current.speech, provider: provider as AsrProviderKind } })} /></label></div>
        <label className="toggle-row"><span className="toggle-copy"><strong>更高质量识别</strong><small>开启后云端识别会结合上下文修正结果，延迟略增。</small></span><input type="checkbox" checked={settings.speech?.betterRecognition === true} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, betterRecognition: event.target.checked } })} /></label>
        <div className="asr-test-row"><button type="button" className="secondary-button" disabled={asrTesting} onClick={() => { setAsrTesting(true); setAsrTests(null); void bridge.testSpeech(settings.speech?.provider || "auto").then((results) => setAsrTests(results)).catch((reason) => setAsrTests([{ id: "error", label: "测试失败", ok: false, message: reason instanceof Error ? reason.message : String(reason) }])).finally(() => setAsrTesting(false)); }}>{asrTesting ? "测试中…" : "测试服务连通"}</button><small className="settings-note-inline">只检查服务和密钥是否可用。</small>{asrTests && <ul className="asr-test-results">{asrTests.map((result) => <li key={result.id} className={result.ok ? "asr-test-ok" : "asr-test-fail"}><strong>{result.label}</strong><span>{result.message}</span></li>)}</ul>}</div>
      </article>
      <article className="settings-card">
        <div className="card-heading"><strong>麦克风与扬声器</strong></div>
        <div className="asr-audio-config">
          <div className="form-grid"><label className="wide-field">输入设备（麦克风）<SelectCombobox ariaLabel="输入设备" value={settings.speech?.audio?.input || "auto"} options={audioInputOptions} onChange={(input) => setSettings((current) => current && { ...current, speech: { ...current.speech, audio: { ...(current.speech.audio || {}), input } } })} /></label><label className="wide-field">输出设备（扬声器）<SelectCombobox ariaLabel="输出设备" value={settings.speech?.audio?.output || "auto"} options={audioOutputOptions} onChange={(output) => setSettings((current) => current && { ...current, speech: { ...current.speech, audio: { ...(current.speech.audio || {}), output } } })} /></label></div>
        </div>
      </article>
      <article className="settings-card">
        <div className="card-heading"><strong>教室与嘈杂环境</strong></div>
        <div className="asr-noise-config">
          <div className="form-grid"><label className="wide-field">环境模式<SelectCombobox ariaLabel="环境模式" value={settings.speech?.noise?.profile || "standard"} options={[{ value: "standard", label: "标准" }, { value: "classroom", label: "教室（远距离收音，推荐）" }, { value: "custom", label: "自定义" }]} onChange={(profile) => setSettings((current) => current && { ...current, speech: { ...current.speech, noise: { ...(current.speech.noise || {}), profile: profile as "standard" | "classroom" | "custom", ...(profile === "classroom" ? { vadModel: "far_field_meeting_16k", speechNoiseThreshold: -0.4 } : {}) } } })} /></label><label>收音距离<SelectCombobox ariaLabel="收音距离" value={settings.speech?.noise?.vadModel || "far_field_meeting_16k"} options={[{ value: "far_field_meeting_16k", label: "远距离" }, { value: "near_meeting_16k", label: "近距离" }]} onChange={(vadModel) => setSettings((current) => current && { ...current, speech: { ...current.speech, noise: { ...(current.speech.noise || {}), vadModel: vadModel as "far_field_meeting_16k" | "near_meeting_16k" } } })} /></label><label>噪声判定阈值<input type="number" step="0.1" min={-1} max={1} placeholder="-0.4（教室推荐 -0.2 ~ -0.6）" value={settings.speech?.noise?.speechNoiseThreshold ?? ""} onChange={(event) => { const parsed = Number(event.target.value); setSettings((current) => current && { ...current, speech: { ...current.speech, noise: { ...(current.speech.noise || {}), speechNoiseThreshold: Number.isFinite(parsed) && event.target.value !== "" ? parsed : undefined } } }); }} /></label><label className="wide-field">热词（逗号分隔）<input placeholder="例如：小泽同学,希沃,百炼" value={(settings.speech?.noise?.hotwords || []).join(",")} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, noise: { ...(current.speech.noise || {}), hotwords: event.target.value.split(/[,，]/).map((word) => word.trim()).filter(Boolean) } } })} /></label></div>
        </div>
      </article>
      {/* R62：高级收拢——第三方云服务整卡默认折叠（语音识别就语音识别），
    展开前不占任何版面。 */}
      <details className="asr-advanced-details">
        <summary>高级：第三方云服务接入</summary>
      <article className="settings-card">
        <div className="card-heading"><strong>云服务接入</strong></div>
        <div className="asr-openai-config">
          <div className="card-heading"><strong>第三方云服务（OpenAI 兼容）</strong><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><SelectCombobox ariaLabel="第三方语音服务预设" value={ASR_OPENAI_PRESETS.some((preset) => preset.baseUrl === settings.speech?.openai?.baseUrl) ? settings.speech?.openai?.baseUrl || "custom" : "custom"} options={[{ value: "custom", label: "自定义" }, ...ASR_OPENAI_PRESETS.map((preset) => ({ value: preset.baseUrl, label: preset.label }))]} onChange={(baseUrl) => { const preset = ASR_OPENAI_PRESETS.find((item) => item.baseUrl === baseUrl); setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { name: "", model: "", apiKeyEnv: "", apiKey: "" }), baseUrl, ...(preset ? { model: preset.model, apiKeyEnv: preset.apiKeyEnv } : {}) } } }); }} /><button type="button" className="secondary-button" disabled={speechProvider === "openai"} onClick={() => setSettings((current) => current && { ...current, speech: { ...current.speech, provider: "openai" as AsrProviderKind } })}>{speechProvider === "openai" ? "当前使用中" : "设为当前识别服务"}</button></span></div>
          <div className="form-grid"><label>服务名称<input placeholder="例如 小米 MiMo ASR" value={settings.speech?.openai?.name || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", model: "" }), name: event.target.value } } })} /></label><label>模型名称<input placeholder="例如 MiMo-ASR" value={settings.speech?.openai?.model || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", name: "" }), model: event.target.value } } })} /></label><label>识别语言（可选）<input placeholder="zh / en，留空自动检测" value={settings.speech?.openai?.language || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", model: "", name: "" }), language: event.target.value } } })} /></label><label className="wide-field">热词提示（可选）<input placeholder="专有名词、人名等，如：SecAgent、GLM" value={settings.speech?.openai?.prompt || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", model: "", name: "" }), prompt: event.target.value } } })} /></label><label className="wide-field">Base URL<input placeholder="https://token-plan-cn.xiaomimimo.com/v1" value={settings.speech?.openai?.baseUrl || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { apiKeyEnv: "", model: "", name: "" }), baseUrl: event.target.value } } })} /></label><label>API Key<input type="password" placeholder={settings.speech?.openai?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 API Key"} value={settings.speech?.openai?.apiKey || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", model: "", name: "" }), apiKey: event.target.value } } })} /></label></div>          <p className="settings-help">{ASR_OPENAI_PRESETS.find((preset) => preset.baseUrl === settings.speech?.openai?.baseUrl)?.note || "支持 OpenAI 兼容的语音识别服务，密钥保存在工作区 .env。"}</p>
        </div>
        <div className={`asr-bailian-config${bailianSelected ? " asr-bailian-active" : ""}`}>
          <div className="card-heading"><strong>阿里云百炼</strong><SelectCombobox ariaLabel="百炼识别通道" value={bailianSelected ? speechProvider : "bailian"} options={ASR_BAILIAN_PRESETS.map((preset) => ({ value: preset.provider as string, label: preset.label }))} onChange={(provider) => setSettings((current) => current && { ...current, speech: { ...current.speech, provider: provider as AsrProviderKind } })} /></div>
          <div className="form-grid"><label>服务名称<input placeholder="例如 阿里云百炼 ASR" value={bailian?.name || ""} onChange={(event) => updateBailian({ name: event.target.value })} /></label><label>整句识别模型<input placeholder={BAILIAN_DEFAULTS.model} value={bailian?.model || ""} onChange={(event) => updateBailian({ model: event.target.value })} /></label><label>流式识别模型<input placeholder={BAILIAN_DEFAULTS.streamModel} value={bailian?.streamModel || ""} onChange={(event) => updateBailian({ streamModel: event.target.value })} /></label><label className="wide-field">Base URL（chat/completions）<input placeholder={BAILIAN_DEFAULTS.baseUrl} value={bailian?.baseUrl || ""} onChange={(event) => updateBailian({ baseUrl: event.target.value })} /></label><label className="wide-field">WebSocket URL（流式）<input placeholder={BAILIAN_DEFAULTS.wsUrl} value={bailian?.wsUrl || ""} onChange={(event) => updateBailian({ wsUrl: event.target.value })} /></label><label>API Key<input type="password" placeholder={bailian?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴百炼 API Key"} value={bailian?.apiKey || ""} onChange={(event) => updateBailian({ apiKey: event.target.value })} /></label><label>识别语言（可选）<input placeholder="zh / en，留空自动检测" value={bailian?.language || ""} onChange={(event) => updateBailian({ language: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={bailian?.enableItn === true} onChange={(event) => updateBailian({ enableItn: event.target.checked })} /> 启用 ITN（数字规范化）</label></div>
          <p className="settings-help">{ASR_BAILIAN_PRESETS.map((preset) => `${preset.label}：${preset.note}`).join(" ")}百炼不支持 OpenAI 的 /audio/transcriptions 接口，请使用本面板配置。密钥保存在工作区 .env 的 {(bailian?.apiKeyEnv || BAILIAN_DEFAULTS.apiKeyEnv)}。</p>
        </div>
        <div className="asr-mimo-config">
          <div className="card-heading"><strong>小米 MiMo</strong><button type="button" className="secondary-button" disabled={speechProvider === "mimo"} onClick={() => setSettings((current) => current && { ...current, speech: { ...current.speech, provider: "mimo" as AsrProviderKind } })}>{speechProvider === "mimo" ? "当前使用中" : "设为当前识别服务"}</button></div>
          <div className="form-grid"><label>模型名称<input placeholder={MIMO_ASR_DEFAULTS.model} value={mimo?.model || ""} onChange={(event) => updateMimo({ model: event.target.value })} /></label><label>识别语言<SelectCombobox ariaLabel="MiMo 识别语言" value={mimo?.language || "auto"} options={[{ value: "auto", label: "自动检测" }, { value: "zh", label: "中文" }, { value: "en", label: "英文" }]} onChange={(language) => updateMimo({ language })} /></label><label className="wide-field">Base URL<input placeholder={MIMO_ASR_DEFAULTS.baseUrl} value={mimo?.baseUrl || ""} onChange={(event) => updateMimo({ baseUrl: event.target.value })} /></label><label>API Key<input type="password" placeholder={mimo?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 MiMo API Key"} value={mimo?.apiKey || ""} onChange={(event) => updateMimo({ apiKey: event.target.value })} /></label></div>
          <p className="settings-help">MiMo 使用专用接口，仅支持 mp3/wav，不要填到 OpenAI 面板。密钥保存在 .env 的 {(mimo?.apiKeyEnv || MIMO_ASR_DEFAULTS.apiKeyEnv)}。</p>
        </div>
        <div className="asr-chain-config">
          <div className="card-heading"><strong>自定义回退链（可选）</strong><small>识别失败时按顺序尝试；留空用默认链。本机离线始终兜底。</small></div>
          <ol className="asr-chain-list">{(settings.speech?.chain || []).map((id, index) => <li key={`${id}-${index}`}><span>{asrChainEntries.find((entry) => entry.value === id)?.label || id}</span><button type="button" className="text-button" aria-label="上移" disabled={index === 0} onClick={() => updateAsrChain([...settings.speech!.chain!.slice(0, index - 1), settings.speech!.chain![index], settings.speech!.chain![index - 1], ...settings.speech!.chain!.slice(index + 1)])}>↑</button><button type="button" className="text-button" aria-label="下移" disabled={index === (settings.speech?.chain?.length || 1) - 1} onClick={() => updateAsrChain([...settings.speech!.chain!.slice(0, index), settings.speech!.chain![index + 1], settings.speech!.chain![index], ...settings.speech!.chain!.slice(index + 2)])}>↓</button><button type="button" className="text-button danger" aria-label="移除" onClick={() => updateAsrChain(settings.speech!.chain!.filter((_, itemIndex) => itemIndex !== index))}>移除</button></li>)}</ol>
          <div className="asr-chain-add"><SelectCombobox ariaLabel="添加回退项" value="" options={[{ value: "", label: "+ 添加回退项…" }, ...asrChainEntries.filter((entry) => !(settings.speech?.chain || []).includes(entry.value))]} onChange={(id) => { if (id) updateAsrChain([...(settings.speech?.chain || []), id]); }} /></div>
        </div>
      </article>
      </details>
    </section>
    <section id="settings-models" className={`settings-section ${isOobe || activePage === "settings-models" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>模型提供商</h2></div></div>
      <article className="settings-card official-service-card"><div className="card-heading"><strong>SecAgent 官方服务</strong>{officialLoggedIn && <button className="text-button danger" onClick={() => void officialLogout()}>退出登录</button>}</div>{!officialLoggedIn && <p>使用浏览器打开 SECTL 授权页登录，登录完成后自动返回 SecAgent。</p>}{!officialLoggedIn && <button className="primary-button" type="button" disabled={officialBusy} onClick={() => void officialLogin()}>{officialBusy ? "等待浏览器授权…" : "打开浏览器登录 SECTL"}</button>}{officialLoggedIn && <div className="official-balance-row"><span>账户余额</span><strong className="points-value">{officialPointsBusy ? "读取中…" : officialPoints === null ? "暂不可用" : <AnimatedCounter value={officialPoints} decimals={6} suffix=" Points" />}</strong><button className="secondary-button" type="button" onClick={() => void refreshOfficialPoints()}>刷新余额</button></div>}{officialLoggedIn && <div className="official-redeem-row"><input value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} placeholder="输入兑换码" aria-label="兑换码" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void redeemOfficialCode(); } }} /><button className="secondary-button" type="button" disabled={redeemBusy} onClick={() => void redeemOfficialCode()}>{redeemBusy ? "兑换中…" : "兑换"}</button></div>}<label className="toggle-row"><span className="toggle-copy"><strong>自定义模型模式</strong><small>关闭时只使用官方服务；开启后可选自定义供应商。</small></span><input type="checkbox" checked={Boolean(settings.customModelMode)} onChange={(event) => setSettings((current) => current && { ...current, customModelMode: event.target.checked })} /></label><div className="default-model-settings"><label>默认模型<SelectCombobox ariaLabel="默认模型" value={settings.defaultModelId || defaultModel?.id || ""} options={mainModelOptions.map((model) => ({ value: model.id, label: model.name, group: model.providerLabel }))} onChange={(modelId) => setSettings((current) => current && { ...current, defaultModelId: modelId })} /></label><label>识图模型<SelectCombobox ariaLabel="识图模型" value={settings.visionModelId || ""} options={[{ value: "", label: "未配置（不使用识图工具）" }, ...availableModels.map((model) => ({ value: model.id, label: model.name, group: model.providerLabel }))]} onChange={(modelId) => setSettings((current) => current && { ...current, visionModelId: modelId || undefined })} /></label><label>默认思考强度<SelectCombobox ariaLabel="默认思考强度" value={defaultReasoningEffort} options={defaultReasoningEfforts.map((effort) => ({ value: effort, label: reasoningEffortLabels[effort] }))} onChange={(effort) => setSettings((current) => current && { ...current, defaultReasoningEffort: effort as ReasoningEffort })} /></label></div><p className="settings-help">主模型不支持看图时，会自动调用识图模型。</p></article>
      {providerModalOpen && editingProvider && <div className="settings-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setProviderModalOpen(false); setEditingProvider(null); } }}><div className="settings-modal"><div className="session-modal-header"><strong>{settings.providers.some((provider) => provider.id === editingProvider.id) ? "编辑提供商" : "添加提供商"}</strong><button type="button" className="text-button" onClick={() => { setProviderModalOpen(false); setEditingProvider(null); }}>关闭</button></div><div className="form-grid"><label>提供商名称<input value={editingProvider.name} disabled={presetLocked} onChange={(event) => updateProvider({ name: event.target.value })} /></label><label>预设<PresetCombobox value={editingProvider.preset || "custom"} presets={providerPresets} onSelect={applyProviderPreset} /></label><label>API 格式<SelectCombobox ariaLabel="API 格式" value={editingProvider.provider} disabled={presetLocked} options={[{ value: "openai-compatible", label: "OpenAI Chat 兼容" }, { value: "openai-responses", label: "OpenAI Responses" }, { value: "anthropic", label: "Anthropic" }, { value: "google", label: "Google Gemini" }]} onChange={(provider) => updateProvider({ provider: provider as ProviderConfig["provider"] })} /></label><label className="wide-field">服务地址<input value={editingProvider.baseUrl} disabled={presetLocked} onChange={(event) => updateProvider({ baseUrl: event.target.value })} /></label><label>请求路径<input value={editingProvider.endpoint || ""} disabled={presetLocked} onChange={(event) => updateProvider({ endpoint: event.target.value })} /></label><label>API Key<input type="password" placeholder={editingProvider.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 API Key"} value={editingProvider.apiKey || ""} onChange={(event) => updateProvider({ apiKey: event.target.value })} /></label></div><p className="settings-help">API Key 会保存到工作区的 .env 文件。</p><div className="provider-model-editor"><div className="card-heading"><strong>模型列表</strong><div className="item-actions"><button type="button" className="secondary-button" disabled={modelsFetching || !editingProvider.baseUrl?.trim()} onClick={() => { setModelsFetching(true); setModelsFetchMessage(null); void bridge.fetchRemoteModels({ baseUrl: editingProvider.baseUrl, apiKey: editingProvider.apiKey, apiKeyEnv: editingProvider.apiKeyEnv }).then((result) => { setModelsFetchMessage(result.message); if (result.ok && result.models.length) { const existing = new Set(editingProvider.models.map((model) => model.id)); updateProvider({ models: [...editingProvider.models, ...result.models.filter((remote) => !existing.has(remote.id)).slice(0, 50).map((remote) => ({ id: remote.id, name: remote.id, enabled: true }))] }); } }).catch((reason) => setModelsFetchMessage(reason instanceof Error ? reason.message : String(reason))).finally(() => setModelsFetching(false)); }}>{modelsFetching ? "拉取中…" : "拉取模型列表"}</button><button type="button" className="secondary-button" disabled={presetLocked} onClick={() => { setNewModelDraft(" "); }}>+ 添加模型</button></div></div>{modelsFetchMessage && <p className="settings-help">{modelsFetchMessage}</p>}{editingProvider.models.length === 0 && newModelDraft === "" && <p className="settings-help">还没有模型，点「+ 添加模型」开始。</p>}{newModelDraft !== "" && <div className="provider-model-row provider-model-add-row"><input autoFocus aria-label="新模型 ID" placeholder="输入模型 ID，例如 glm-4.7-flash" value={newModelDraft.trim()} onChange={(event) => setNewModelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setNewModelDraft(""); if (event.key === "Enter") { const id = newModelDraft.trim(); if (id && editingProvider && !editingProvider.models.some((model) => model.id === id)) updateProvider({ models: [...editingProvider.models, { id, name: id, enabled: true }] }); setNewModelDraft(""); } }} /><button type="button" className="primary-button" onClick={() => { const id = newModelDraft.trim(); if (id && editingProvider && !editingProvider.models.some((model) => model.id === id)) updateProvider({ models: [...editingProvider.models, { id, name: id, enabled: true }] }); setNewModelDraft(""); }}>添加</button><button type="button" className="text-button" onClick={() => { setNewModelDraft(""); }}>取消</button></div>}{newModelDraft.trim() !== "" && editingProvider?.models.some((model) => model.id === newModelDraft.trim()) && <p className="settings-help">该模型 ID 已存在。</p>}{editingProvider.models.map((model, index) => <div className="provider-model-row" key={`${model.id}-${index}`}><input type="checkbox" title="启用后显示在模型列表" disabled={presetLocked} checked={model.enabled !== false} onChange={() => updateProvider({ models: editingProvider.models.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: item.enabled === false } : item) })} /><input value={model.name || ""} disabled={presetLocked} onChange={(event) => updateProvider({ models: editingProvider.models.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><code>{model.id}</code><button type="button" className="text-button danger" disabled={presetLocked} onClick={() => updateProvider({ models: editingProvider.models.filter((_, itemIndex) => itemIndex !== index) })}>删除</button></div>)}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setProviderModalOpen(false); setEditingProvider(null); }}>取消</button><button type="button" className="primary-button" onClick={saveProvider}>保存</button></div></div></div>}      {settings.customModelMode ? <><div className="section-title provider-add-row"><div><h3>自定义提供商</h3></div><button className="secondary-button" type="button" onClick={() => { setEditingProvider(emptyProvider()); setProviderModalOpen(true); }}>+ 添加提供商</button></div>
      <div className="provider-list settings-cards">{settings.providers.filter((provider) => provider.id !== "sectl-official" && provider.name !== "SecAgent 官方服务").map((provider) => <article className={`settings-card provider-list-item${provider.models.length === 1 ? " single-model" : ""}`} key={provider.id}><div className="card-heading"><div><strong>{provider.name}</strong><span>{provider.models.length} 个模型 · {provider.preset && provider.preset !== "custom" ? `预设：${provider.preset}` : "自定义"}</span></div><div className="item-actions"><button className="secondary-button" type="button" onClick={() => { setEditingProvider({ ...provider, models: provider.models.map((model) => ({ ...model })) }); setProviderModalOpen(true); }}>编辑</button><button className="text-button danger" type="button" onClick={() => removeProvider(provider.id)}>删除</button></div></div></article>)}</div></> : null}
    </section>
    <section id="settings-websearch" className={`settings-section ${activePage === "settings-websearch" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>联网搜索</h2></div></div>
      <article className="settings-card"><div className="card-heading"><strong>搜索服务密钥</strong></div>
        <div className="form-grid">
          <label>BigModel API Key<input type="password" placeholder={settings.webSearch?.bigmodelKeyConfigured ? "已配置（留空保持不变）" : "粘贴智谱 BigModel API Key"} value={settings.webSearch?.bigmodelKey || ""} onChange={(event) => setSettings((current) => current && { ...current, webSearch: { ...(current.webSearch || {}), bigmodelKey: event.target.value } })} /></label>
          <label>DeepSeek API Key<input type="password" placeholder={settings.webSearch?.deepseekKeyConfigured ? "已配置（留空保持不变）" : "粘贴 DeepSeek API Key"} value={settings.webSearch?.deepseekKey || ""} onChange={(event) => setSettings((current) => current && { ...current, webSearch: { ...(current.webSearch || {}), deepseekKey: event.target.value } })} /></label>
        </div>
        <p className="settings-help">密钥保存在 .env，保存后立即生效；搜索会自动选择可用服务。</p>
      </article>
    </section>
    <section id="settings-mcp" className={`settings-section ${isOobe || activePage === "settings-mcp" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>MCP 服务</h2></div><button className="secondary-button" onClick={() => setSettings((current) => current && { ...current, mcp: { servers: { ...current.mcp.servers, [`mcp-${Object.keys(current.mcp.servers).length + 1}`]: emptyMcp() } } })}>+ 添加服务</button></div>
      {Object.keys(settings.mcp.servers).length === 0 && <article className="settings-card settings-empty-card">暂无 MCP 服务</article>}
      <div className="settings-cards">{Object.entries(settings.mcp.servers).map(([name, server]) => <article className="settings-card" key={name}><div className="card-heading"><input className="server-name" value={name} onChange={(event) => renameServer(name, event.target.value)} /><button type="button" className="text-button danger" onClick={() => setSettings((current) => { if (!current) return current; const servers = { ...current.mcp.servers }; delete servers[name]; return { ...current, mcp: { servers } }; })}>删除</button></div><div className="form-grid"><label>传输方式<SelectCombobox ariaLabel="传输方式" value={server.transport} options={[{ value: "http", label: "HTTP" }, { value: "stdio", label: "stdio" }]} onChange={(transport) => updateServer(name, { transport: transport as McpServerConfig["transport"] })} /></label><label className="checkbox-label"><input type="checkbox" checked={server.enabled} onChange={(event) => updateServer(name, { enabled: event.target.checked })} /> 启用</label>{server.transport === "http" ? <label>服务 URL<input value={server.url || ""} onChange={(event) => updateServer(name, { url: event.target.value })} /></label> : <><label>启动命令<input value={server.command || ""} onChange={(event) => updateServer(name, { command: event.target.value })} /></label><label>参数（每行一个）<textarea value={(server.args || []).join("\n")} onChange={(event) => updateServer(name, { args: event.target.value.split(/\r?\n/).filter(Boolean) })} rows={3} /></label></>}</div></article>)}</div>
    </section>
    <section id="settings-plugins" className={`settings-section ${isOobe || activePage === "settings-plugins" ? "settings-section-active" : ""}`}>
      <PluginSettingsPanel plugins={plugins} setPlugins={setPlugins} marketPlugins={marketPlugins} setMarketPlugins={setMarketPlugins} marketError={marketError} setMarketError={setMarketError} />
    </section>
    <section id="settings-commands" className={`settings-section ${isOobe || activePage === "settings-commands" ? "settings-section-active" : ""}`}>
      <div className="section-title"><div><h2>命令</h2><p>把常用提示词保存成命令，输入 / 即可调用。</p></div><button className="secondary-button" type="button" onClick={addCustomCommand}>+ 新建命令</button></div>
      {(settings.commands || []).length === 0 ? <article className="settings-card settings-empty-card">还没有自定义命令。新建后会出现在输入框的 / 面板。</article> : null}
      <div className="settings-cards">{(settings.commands || []).map((command, index) => <article className="settings-card" key={index}>
        <div className="card-heading"><strong>/{command.name || "未命名命令"}</strong><button type="button" className="text-button danger" onClick={() => removeCustomCommand(index)}>删除</button></div>
        <div className="form-grid">
          <label>命令名<input value={command.name} placeholder="例如 review（不要带 /）" onChange={(event) => updateCustomCommand(index, { name: event.target.value })} /></label>
          <label>说明<input value={command.description || ""} placeholder="可选，显示在命令面板里" onChange={(event) => updateCustomCommand(index, { description: event.target.value })} /></label>
          <label className="wide-field">提示词<textarea rows={4} value={command.prompt} placeholder="选择该命令后填入输入框的内容，可继续补充参数" onChange={(event) => updateCustomCommand(index, { prompt: event.target.value })} /></label>
        </div>
      </article>)}</div>
      <p className="settings-help">名称和提示词都填写后才会保存；重名只保留第一条。</p>
    </section>
    {!isOobe && plugins.flatMap((plugin) => (plugin.enabled ? (plugin.settingsPages ?? []) : []).map((page) => activePage === `plugin-${plugin.id}-${page.id}` && <section className="settings-section settings-section-active plugin-settings-section" key={`${plugin.id}-${page.id}`}>
      <div className="section-title"><div><h2>{page.title}</h2>{page.description ? <p>{page.description}</p> : null}</div></div>
      {plugin.id === "secscore-connector" && page.id === "secscore" ? <SecScoreSettingsPage pluginId={plugin.id} pageId={page.id} /> : <PluginFormSettingsPage pluginId={plugin.id} pageId={page.id} />}
    </section>))}

    <section id="settings-system" className={"settings-section " + (activePage === "settings-system" ? "settings-section-active" : "")}><div className="section-title"><div><h2>系统</h2></div></div>
      {/* R59：UX 重写——每张卡一句话说明"这是干嘛的"，开关文案去掉嵌套术语。 */}
      <article className="settings-card"><div className="card-heading"><strong>开机自启动</strong></div><label className="toggle-row"><span className="toggle-copy"><strong>开机自动启动</strong><small>开机登录后在后台运行；从屏幕右下角托盘图标可随时打开主窗口。</small></span><input type="checkbox" checked={settings.autostart === true} onChange={(event) => setSettings((current) => current && { ...current, autostart: event.target.checked })} /></label><label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>启动后只在后台（不弹窗）</strong><small>勾选：开机安静待命，语音唤醒与快捷键照常可用。不勾选：开机直接弹出主窗口。</small></span><input type="checkbox" checked={settings.autostartHidden !== false} onChange={(event) => setSettings((current) => current && { ...current, autostartHidden: event.target.checked })} /></label></article>
      {/* R76：与 Trae 3.4.7 同步的关闭行为选择，默认保持原有的「收进托盘」。 */}
      {bridge.platform === "win32" && <article className="settings-card"><div className="card-heading"><strong>关闭主窗口时</strong><span>点关闭按钮后的行为。</span></div><div className="form-grid"><label>行为<SelectCombobox ariaLabel="关闭主窗口行为" value={settings.closeWindowAction || "tray"} options={[{ value: "tray", label: "收进系统托盘，继续后台运行（推荐）" }, { value: "quit", label: "直接退出应用" }]} onChange={(action) => setSettings((current) => current && { ...current, closeWindowAction: action as SettingsPayload["closeWindowAction"] })} /></label></div><p className="settings-help">收进托盘后任务继续运行；直接退出会结束所有任务。</p></article>}
      <article className="settings-card"><div className="card-heading"><strong>外观</strong></div><div className="form-grid"><label>界面主题<SelectCombobox ariaLabel="界面主题" value={settings.theme || "light"} options={[{ value: "light", label: "浅色" }, { value: "dark", label: "深色" }, { value: "system", label: "跟随系统" }]} onChange={(theme) => setSettings((current) => current && { ...current, theme: theme as SettingsPayload["theme"] })} /></label></div></article>
      <article className="settings-card"><div className="card-heading"><strong>聊天输入</strong></div><div className="form-grid"><label>发送快捷键<SelectCombobox ariaLabel="发送快捷键" value={settings.sendShortcut || "enter"} options={[{ value: "enter", label: "Enter 发送，Shift+Enter 换行" }, { value: "modEnter", label: `${bridge.platform === "darwin" ? "⌘" : "Ctrl"}+Enter 发送，Enter 换行` }]} onChange={(shortcut) => setSettings((current) => current && { ...current, sendShortcut: shortcut as SettingsPayload["sendShortcut"] })} /></label></div><p className="settings-help">选择后，Enter 只换行，适合写多行内容。</p><label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>回复过程中展示使用技巧</strong><small>生成回复时轮流显示使用技巧。</small></span><input type="checkbox" checked={settings.responseTips !== false} onChange={(event) => setSettings((current) => current && { ...current, responseTips: event.target.checked })} /></label></article>
      {/* R76：与 Trae 3.4.7 同步的技能开关——关闭的技能不会再被加载进 Agent 运行。 */}
      <article className="settings-card"><div className="card-heading"><strong>技能</strong><span>关闭后不再加载；工作区的 SKILL.md 会自动出现在这里。</span></div>
        {skills.length === 0 ? <p className="settings-help">暂未发现技能。把含 SKILL.md 的文件夹放进工作区 skills 目录即可。</p> : <div className="skill-toggle-list">{skills.map((skill) => <label className="toggle-row" key={skill.path}><span className="toggle-copy"><strong>{skill.name}</strong><small>{skill.description}</small></span><input type="checkbox" checked={!(settings.skills?.disabled || []).includes(skill.name)} onChange={(event) => toggleSkill(skill.name, event.target.checked)} /></label>)}</div>}
        <div className="item-actions"><button type="button" className="secondary-button" onClick={() => void bridge.openSkillsDirectory()}>打开技能目录</button><button type="button" className="text-button" onClick={() => void refreshSkills()}>重新扫描</button></div>
      </article>
      <article className="settings-card"><div className="card-heading"><strong>模型失败处理</strong><span>失败时重试或换用备用模型。</span></div>
        <label className="toggle-row"><span className="toggle-copy"><strong>请求失败自动重试</strong><small>网络波动或超时时，自动重试一次。</small></span><input type="checkbox" checked={settings.resilience?.autoRetry !== false} onChange={(event) => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), autoRetry: event.target.checked } })} /></label>
        <label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>失败时切换备用模型</strong><small>当前模型不可用时，按顺序尝试其他模型。</small></span><input type="checkbox" checked={settings.resilience?.fallbackEnabled !== false} onChange={(event) => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), fallbackEnabled: event.target.checked } })} /></label>
        {/* R62：模型回退链自定义——与语音识别回退链同款交互（后端
            resilience.fallbackModelIds 早已支持，此前无 UI 暴露）。 */}
        {settings.resilience?.fallbackEnabled !== false ? <div className="asr-chain-config">
          <div className="card-heading"><strong>备用模型顺序（可选）</strong><small>按顺序尝试；留空则自动选择。</small></div>
          <ol className="asr-chain-list">{(settings.resilience?.fallbackModelIds || []).map((id, index) => { const model = availableModels.find((item) => item.id === id); const label = model ? `${model.name || model.model}（${model.providerLabel || model.provider}）` : id; return <li key={`${id}-${index}`}><span>{label}</span><button type="button" className="text-button" aria-label="上移" disabled={index === 0} onClick={() => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), fallbackModelIds: [...current.resilience!.fallbackModelIds!.slice(0, index - 1), current.resilience!.fallbackModelIds![index], current.resilience!.fallbackModelIds![index - 1], ...current.resilience!.fallbackModelIds!.slice(index + 1)] } })}>↑</button><button type="button" className="text-button" aria-label="下移" disabled={index === (settings.resilience?.fallbackModelIds?.length || 1) - 1} onClick={() => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), fallbackModelIds: [...current.resilience!.fallbackModelIds!.slice(0, index), current.resilience!.fallbackModelIds![index + 1], current.resilience!.fallbackModelIds![index], ...current.resilience!.fallbackModelIds!.slice(index + 2)] } })}>↓</button><button type="button" className="text-button" aria-label="移除" onClick={() => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), fallbackModelIds: current.resilience!.fallbackModelIds!.filter((_, itemIndex) => itemIndex !== index) } })}>移除</button></li>; })}</ol>
          <div className="form-grid"><label className="wide-field">添加备用模型<SelectCombobox ariaLabel="添加模型回退项" value="" options={[{ value: "", label: "+ 添加模型…" }, ...mainModelOptions.filter((item) => !(settings.resilience?.fallbackModelIds || []).includes(item.id)).map((item) => ({ value: item.id, label: `${item.name || item.model}（${item.providerLabel || item.provider}）` }))]} onChange={(id) => { if (!id) return; setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), fallbackModelIds: [...(current.resilience?.fallbackModelIds || []), id] } }); }} /></label></div>
        </div> : null}
        <label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>失败模型暂时停用</strong><small>失败模型会暂停使用一段时间，恢复后自动启用。</small></span><input type="checkbox" checked={settings.resilience?.rememberFailures !== false} onChange={(event) => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), rememberFailures: event.target.checked } })} /></label>
      </article>
      <article className="settings-card"><div className="card-heading"><strong>安全与提醒</strong><span>危险操作先确认，回答附可信度提醒。</span></div>
        <label className="toggle-row"><span className="toggle-copy"><strong>敏感工具操作需手动确认</strong><small>删除文件、格式化、强制推送等危险操作需要你确认。</small></span><input type="checkbox" checked={settings.guard?.enabled !== false} onChange={(event) => setSettings((current) => current && { ...current, guard: { ...(current.guard || { enabled: true, approved: [] }), enabled: event.target.checked } })} /></label>
        <label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>回答可信度提醒</strong><small>发现可能的矛盾或重复时，在回答下方提醒。</small></span><input type="checkbox" checked={settings.hallucinationEnabled !== false} onChange={(event) => setSettings((current) => current && { ...current, hallucinationEnabled: event.target.checked })} /></label>
      </article>
      <article className="settings-card"><div className="card-heading"><strong>调用限制</strong><span>限制工具调用次数和截图保留量。</span></div>
        <label className="toggle-row"><span className="toggle-copy"><strong>单轮工具调用上限</strong><small>达到上限后停止调用工具并总结，0 表示不限制。</small></span><input type="number" min={0} max={200} value={settings.budget?.maxToolTurns ?? 0} onChange={(event) => setSettings((current) => current && { ...current, budget: { ...(current.budget || { maxToolTurns: 0, keepRecentImages: 2, contextTokens: 0 }), maxToolTurns: Number(event.target.value) || 0 } })} /></label>
        <label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>保留最近图片数</strong><small>较早的截图会替换为文字占位，减少上下文占用。</small></span><input type="number" min={0} max={24} value={settings.budget?.keepRecentImages ?? 2} onChange={(event) => setSettings((current) => current && { ...current, budget: { ...(current.budget || { maxToolTurns: 0, keepRecentImages: 2, contextTokens: 0 }), keepRecentImages: Number(event.target.value) || 0 } })} /></label>
        <label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>上下文窗口</strong><small>填写模型支持的 tokens；超出时只发送最近的消息。0 表示不限制。</small></span><input type="number" min={0} max={2000000} step={1000} placeholder="例如 128000" value={settings.budget?.contextTokens || ""} onChange={(event) => setSettings((current) => current && { ...current, budget: { ...(current.budget || { maxToolTurns: 0, keepRecentImages: 2, contextTokens: 0 }), contextTokens: Number(event.target.value) || 0 } })} /></label>
      </article>
          <article className="settings-card open-source-card"><div className="card-heading"><strong>开源致谢</strong></div><p className="settings-help">聊天与设置界面的部分组件设计参考自 <button type="button" className="text-button" onClick={() => void bridge.openExternal("https://rareui.com/")}>Rare UI</button>，交互模式参考 <button type="button" className="text-button" onClick={() => void bridge.openExternal("https://www.assistant-ui.com/")}>assistant-ui</button> 与 <button type="button" className="text-button" onClick={() => void bridge.openExternal("https://reactbits.dev/")}>React Bits</button>，特此致谢。</p></article>
    </section>
    {!isOobe && <section id="settings-telemetry" className={`settings-section ${activePage === "settings-telemetry" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>诊断与隐私</h2><p>上传脱敏的错误与运行阶段，关闭后不会发送任何数据。</p></div></div>
      <article className="settings-card"><label className="toggle-row"><span className="toggle-copy"><strong>上传匿名诊断数据</strong><small>仅上传脱敏的错误与运行阶段，不含对话内容、API Key 或附件。</small></span><input type="checkbox" checked={settings.telemetry.enabled} onChange={(event) => setSettings((current) => current && { ...current, telemetry: { enabled: event.target.checked } })} /></label><div className="diagnostic-upload-row"><div><strong>上传一次完整诊断包</strong><p className="settings-help">只在你选择会话并确认后上传，不会自动开启。</p></div><div className="diagnostic-upload-controls"><SelectCombobox ariaLabel="诊断会话" disabled={!settings.telemetry.enabled || diagnosticBusy || !diagnosticSessions.length} value={diagnosticSessionId} options={[{ value: "", label: "选择会话" }, ...diagnosticSessions.map((session) => ({ value: session.id, label: `${session.title} · ${new Date(session.updatedAt).toLocaleString()}` }))]} onChange={setDiagnosticSessionId} /><button type="button" className="secondary-button" disabled={!settings.telemetry.enabled || diagnosticBusy || !diagnosticSessionId} onClick={() => void uploadDiagnostic()}>{diagnosticBusy ? "上传中…" : "上传诊断包"}</button></div></div></article>
    </section>}
  </main>;
}
