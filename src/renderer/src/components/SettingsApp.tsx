import { useEffect, useRef, useState } from "react";
import { PluginSettingsPanel } from "./PluginSettingsPanel.js";
import { SecScoreSettingsPage } from "./SecScoreSettingsPage.js";
import { PresetCombobox } from "./PresetCombobox.js";
import { SelectCombobox } from "./SelectCombobox.js";
import { OobeWizard } from "./OobeWizard.js";
import { reasoningEffortLabels, ttsRates, ttsVoices } from "../constants.js";
import { ASR_BAILIAN_PRESETS, ASR_OPENAI_PRESETS, BAILIAN_DEFAULTS, MIMO_ASR_DEFAULTS, type AsrProviderKind, type BailianAsrSettings, type MimoAsrSettings } from "../../../asr/settings.js";
import { emptyMcp, emptyProvider, isOfficialVisionModel, reasoningEffortsForModel } from "../utils.js";
import { formatOfficialBalanceExpiry, formatOfficialPoints } from "../official-balance.js";
import { DEFAULT_WAKE_HOTKEY, displayWakeHotkey, wakeHotkeyFromKeyboardEvent } from "../../../wake-hotkey.js";

function WakeHotkeyField({ value, platform, onChange }: { value: string; platform: NodeJS.Platform; onChange: (value: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  return <div className="wake-hotkey-field">
    <label>全局快捷键<input readOnly value={capturing ? "请按下快捷键..." : displayWakeHotkey(value, platform)} onFocus={() => setCapturing(true)} onBlur={() => setCapturing(false)} onKeyDown={(event) => { event.preventDefault(); const hotkey = wakeHotkeyFromKeyboardEvent(event.nativeEvent); if (hotkey) { onChange(hotkey); setCapturing(false); } }} /></label>
    <button type="button" className="secondary-button" onClick={() => onChange(DEFAULT_WAKE_HOTKEY)}>恢复默认</button>
  </div>;
}

function updateReleaseLabel(release: UpdateRelease | undefined, channel: UpdateChannel): string {
  if (release?.releaseType === "alpha") return "内测版";
  if (release?.releaseType === "beta") return "测试版";
  return channel === "preview" ? "预览版" : "稳定版";
}

function formatUpdateBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
  const [marketPlugins, setMarketPlugins] = useState<MarketplacePlugin[]>([]);
  const [marketError, setMarketError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [officialPoints, setOfficialPoints] = useState<number | null>(null);
  const [officialPointBalances, setOfficialPointBalances] = useState<Array<{ points: number; expiresAt: string | null }>>([]);
  const [officialPointsBusy, setOfficialPointsBusy] = useState(false);
  const [officialLoggedIn, setOfficialLoggedIn] = useState(false);
  const [officialExpired, setOfficialExpired] = useState(false);
  const [officialBusy, setOfficialBusy] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [diagnosticSessions, setDiagnosticSessions] = useState<SessionMeta[]>([]);
  const [diagnosticSessionId, setDiagnosticSessionId] = useState("");
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const settingsLoaded = useRef(false);
  const skipAutosave = useRef(true);
  const [activePage, setActivePage] = useState(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const builtInPage = ["settings-wake", "settings-tts", "settings-asr", "settings-models", "settings-mcp", "settings-plugins", "settings-system", "settings-updates", "settings-telemetry"].includes(hash);
    return isOobe ? "settings-models" : ((builtInPage || hash.startsWith("plugin-")) ? hash : "settings-tts");
  });

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
      setOfficialPointBalances(result.balances);
      setOfficialExpired(result.expired);
      if (result.expired) {
        setOfficialLoggedIn(false);
        setError("登录已过期，请重新登录。");
      }
    } catch { setOfficialPoints(null); setOfficialPointBalances([]); setOfficialExpired(false); } finally { setOfficialPointsBusy(false); }
  };
  useEffect(() => { void bridge.officialStatus().then((status) => { setOfficialLoggedIn(status.loggedIn); if (status.loggedIn) void refreshOfficialPoints(); }).catch(() => undefined); }, [bridge]);
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
  // 音频设备枚举（麦克风/扬声器）；浏览器要求先授权麦克风才能看到 label。
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
  return <main className={`settings-shell has-window-title ${isOobe ? "oobe-shell" : ""} ${activePage === "settings-plugins" ? "plugin-settings-shell" : ""} ${bridge.platform === "darwin" ? "macos-settings" : ""} ${bridge.platform !== "darwin" ? "windows-settings" : ""}`}>
    <div className="settings-window-title">SecAgent设置</div>
    {!isOobe && <nav className="settings-nav" aria-label="Settings navigation"><button type="button" className={activePage === "settings-wake" ? "active" : ""} aria-current={activePage === "settings-wake" ? "page" : undefined} onClick={() => { setActivePage("settings-wake"); window.history.replaceState(null, "", "#settings-wake"); }}>随时唤醒</button><button type="button" className={activePage === "settings-system" ? "active" : ""} aria-current={activePage === "settings-system" ? "page" : undefined} onClick={() => { setActivePage("settings-system"); window.history.replaceState(null, "", "#settings-system"); }}>系统</button><button type="button" className={activePage === "settings-updates" ? "active" : ""} aria-current={activePage === "settings-updates" ? "page" : undefined} onClick={() => { setActivePage("settings-updates"); window.history.replaceState(null, "", "#settings-updates"); }}>更新</button><button type="button" className={activePage === "settings-telemetry" ? "active" : ""} aria-current={activePage === "settings-telemetry" ? "page" : undefined} onClick={() => { setActivePage("settings-telemetry"); window.history.replaceState(null, "", "#settings-telemetry"); }}>诊断与隐私</button><button type="button" className={activePage === "settings-tts" ? "active" : ""} aria-current={activePage === "settings-tts" ? "page" : undefined} onClick={() => { setActivePage("settings-tts"); window.history.replaceState(null, "", "#settings-tts"); }}>朗读</button><button type="button" className={activePage === "settings-asr" ? "active" : ""} aria-current={activePage === "settings-asr" ? "page" : undefined} onClick={() => { setActivePage("settings-asr"); window.history.replaceState(null, "", "#settings-asr"); }}>语音识别</button><button type="button" className={activePage === "settings-models" ? "active" : ""} aria-current={activePage === "settings-models" ? "page" : undefined} onClick={() => { setActivePage("settings-models"); window.history.replaceState(null, "", "#settings-models"); }}>模型</button><button type="button" className={activePage === "settings-mcp" ? "active" : ""} aria-current={activePage === "settings-mcp" ? "page" : undefined} onClick={() => { setActivePage("settings-mcp"); window.history.replaceState(null, "", "#settings-mcp"); }}>MCP 服务</button><button type="button" className={activePage === "settings-plugins" ? "active" : ""} aria-current={activePage === "settings-plugins" ? "page" : undefined} onClick={() => { setActivePage("settings-plugins"); window.history.replaceState(null, "", "#settings-plugins"); }}>插件</button>{plugins.some((plugin) => plugin.settingsPages.length > 0) && <div className="settings-nav-divider" role="separator" />}{plugins.flatMap((plugin) => plugin.settingsPages.map((page) => { const pageId = `plugin-${plugin.id}-${page.id}`; return <button type="button" className={activePage === pageId ? "active" : ""} aria-current={activePage === pageId ? "page" : undefined} key={pageId} onClick={() => { setActivePage(pageId); window.history.replaceState(null, "", `#${pageId}`); }}>{page.title}</button>; }))}</nav>}
    {error && <div className="settings-error">{error}</div>}
    {success && <div className="settings-success">{success}</div>}
    <section id="settings-wake" className={`settings-section ${isOobe || activePage === "settings-wake" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>随时唤醒</h2><p>按下全局快捷键后，在当前显示器工作区唤起语音 Agent。窗口不会覆盖任务栏。</p></div></div>
      <article className="settings-card"><WakeHotkeyField value={settings.wake.hotkey} platform={bridge.platform} onChange={(hotkey) => setSettings((current) => current && { ...current, wake: { ...current.wake, hotkey } })} /><div className="form-grid wake-model-setting"><label>随时唤起使用的模型<SelectCombobox ariaLabel="随时唤起使用的模型" value={settings.wake.modelId || settings.defaultModelId || mainModelOptions[0]?.id || ""} options={mainModelOptions.map((model) => ({ value: model.id, label: model.name, group: model.providerLabel }))} onChange={(modelId) => setSettings((current) => current && { ...current, wake: { ...current.wake, modelId } })} /></label></div><label className="toggle-row"><span className="toggle-copy"><strong>语音唤醒</strong><small>开启后持续使用麦克风，识别到唤醒词后等同于按下上面的快捷键。</small></span><input type="checkbox" checked={settings.wake.voiceEnabled === true} onChange={(event) => setSettings((current) => current && { ...current, wake: { ...current.wake, voiceEnabled: event.target.checked } })} /></label><label className="wake-phrase-field">唤醒词<input value={settings.wake.voicePhrase || "小泽同学"} onChange={(event) => setSettings((current) => current && { ...current, wake: { ...current.wake, voicePhrase: event.target.value } })} placeholder="小泽同学" /></label><p className="settings-help">Windows/Linux 默认 Ctrl Alt A；macOS 默认 Ctrl Option A。语音唤醒始终使用随安装包提供的本地模型，无需网络。</p></article>
    </section>
    <section id="settings-updates" className={`settings-section ${activePage === "settings-updates" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>更新</h2><p>从 GitHub Release 获取 SecAgent 更新。当前仅支持 Windows 安装包更新。</p></div></div>
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
      <article className="settings-card"><div className="form-grid"><label className="wide-field">朗读引擎<SelectCombobox ariaLabel="朗读引擎" value={ttsProvider} options={ttsEntries} onChange={(provider) => updateTts({ provider: provider as "edge" | "windows" | "mimo" | "bailian" })} /></label><label className="wide-field">失败回退链（按顺序）<div className="tts-chain-editor">{ttsEntries.map((entry) => <label key={entry.value} className="checkbox-label"><input type="checkbox" checked={ttsChain[0] === entry.value} disabled={ttsChain[0] === entry.value} onChange={(event) => { if (event.target.checked) updateTts({ chain: [entry.value as "edge" | "windows" | "mimo" | "bailian", ...ttsChain.filter((kind) => kind !== entry.value)] }); }} /> 主</label>)}<small>主引擎打头；其余勾选的按顺序回退：</small>{ttsEntries.map((entry) => <label key={`f-${entry.value}`} className="checkbox-label"><input type="checkbox" checked={ttsChain.includes(entry.value as "edge" | "windows" | "mimo" | "bailian")} disabled={ttsChain[0] === entry.value} onChange={(event) => updateTts({ chain: event.target.checked ? [...ttsChain, entry.value as "edge" | "windows" | "mimo" | "bailian"] : ttsChain.filter((kind) => kind !== entry.value) })} /> {entry.label.split("（")[0]}</label>)}</div></label><label>语音音色（Edge/Windows）<SelectCombobox ariaLabel="语音音色" value={settings.tts.voice} options={ttsVoices.map(([value, label]) => ({ value, label }))} onChange={(voice) => updateTts({ voice })} /></label><label>语速<SelectCombobox ariaLabel="语速" value={settings.tts.rate} options={ttsRates.map(([value, label]) => ({ value, label }))} onChange={(rate) => updateTts({ rate })} /></label>{ttsChain.includes("mimo") && <label>小米 MiMo TTS 音色<SelectCombobox ariaLabel="MiMo TTS 音色" value={settings.tts?.mimo?.voice || "mimo_default"} options={[{ value: "mimo_default", label: "MiMo 默认" }, { value: "bingtang", label: "冰糖" }, { value: "moli", label: "茉莉" }, { value: "suda", label: "苏打" }, { value: "baihua", label: "白桦" }, { value: "Mia", label: "Mia" }, { value: "Chloe", label: "Chloe" }, { value: "Milo", label: "Milo" }, { value: "Dean", label: "Dean" }]} onChange={(voice) => setSettings((current) => current && { ...current, tts: { ...current.tts, mimo: { ...(current.tts.mimo || { apiKeyEnv: "MIMO_TTS_API_KEY" }), voice } } as SettingsPayload["tts"] })} /></label>}{ttsChain.includes("mimo") && <label>小米 MiMo TTS API Key<input type="password" placeholder={settings.tts?.mimo?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 MiMo API Key"} value={settings.tts?.mimo?.apiKey || ""} onChange={(event) => setSettings((current) => current && { ...current, tts: { ...current.tts, mimo: { ...(current.tts.mimo || { apiKeyEnv: "MIMO_TTS_API_KEY" }), apiKey: event.target.value } } as SettingsPayload["tts"] })} /></label>}{ttsChain.includes("bailian") && <label>百炼 CosyVoice 音色<input placeholder="longanyang（查看官方音色列表）" value={settings.tts?.bailian?.voice || ""} onChange={(event) => setSettings((current) => current && { ...current, tts: { ...current.tts, bailian: { ...(current.tts.bailian || { apiKeyEnv: "BAILIAN_TTS_API_KEY" }), voice: event.target.value } } as SettingsPayload["tts"] })} /></label>}{ttsChain.includes("bailian") && <label>百炼 CosyVoice API Key<input type="password" placeholder={settings.tts?.bailian?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴百炼 API Key"} value={settings.tts?.bailian?.apiKey || ""} onChange={(event) => setSettings((current) => current && { ...current, tts: { ...current.tts, bailian: { ...(current.tts.bailian || { apiKeyEnv: "BAILIAN_TTS_API_KEY" }), apiKey: event.target.value } } as SettingsPayload["tts"] })} /></label>}</div><p className="settings-help">Edge TTS 在线免费；Windows 系统朗读完全离线（走 PowerShell System.Speech）；MiMo 与 CosyVoice 为云端付费引擎，密钥保存到工作区 .env。Windows 下默认链：Edge → Windows 系统朗读。</p></article>
    </section>
    <section id="settings-asr" className={`settings-section ${activePage === "settings-asr" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>语音识别</h2><p>说话转文字使用的语音识别服务；失败时按“第三方 → 官方 → 本地”自动回退（可在下方测试连通性）。</p></div></div>
      <article className="settings-card">
        <div className="form-grid asr-provider-grid"><label>识别服务<SelectCombobox ariaLabel="识别服务" value={settings.speech?.provider || "auto"} options={[{ value: "auto", label: "自动（推荐：第三方 → 官方 → 本地）" }, { value: "openai", label: "第三方云端（OpenAI 兼容，如 SiliconFlow）" }, ...ASR_BAILIAN_PRESETS.map((preset) => ({ value: preset.provider as string, label: preset.label })), { value: "mimo", label: "小米 MiMo（chat/completions + input_audio）" }, { value: "official", label: "官方云端（需登录 SECTL）" }, { value: "local-pro", label: "本地增强（SenseVoice 附加包，需单独下载）" }, { value: "local", label: "本地离线（sherpa-onnx，无需网络）" }]} onChange={(provider) => setSettings((current) => current && { ...current, speech: { ...current.speech, provider: provider as AsrProviderKind } })} /></label><label className="wide-field">识别语言提示（可选）<input placeholder="zh / en，留空自动检测" value={(bailianSelected ? bailian?.language : settings.speech?.openai?.language) || ""} onChange={(event) => { const language = event.target.value; if (bailianSelected) { updateBailian({ language }); return; } setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", model: "" }), language } } }); }} /></label></div>
        <label className="toggle-row"><span className="toggle-copy"><strong>更高质量识别</strong><small>开启后云端识别会结合上下文修正结果，延迟略增。</small></span><input type="checkbox" checked={settings.speech?.betterRecognition === true} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, betterRecognition: event.target.checked } })} /></label>
        <div className="asr-openai-config">
          <div className="card-heading"><strong>第三方云端（OpenAI 兼容）</strong><SelectCombobox ariaLabel="第三方语音服务预设" value={ASR_OPENAI_PRESETS.some((preset) => preset.baseUrl === settings.speech?.openai?.baseUrl) ? settings.speech?.openai?.baseUrl || "custom" : "custom"} options={[{ value: "custom", label: "自定义" }, ...ASR_OPENAI_PRESETS.map((preset) => ({ value: preset.baseUrl, label: preset.label }))]} onChange={(baseUrl) => { const preset = ASR_OPENAI_PRESETS.find((item) => item.baseUrl === baseUrl); setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { name: "", model: "", apiKeyEnv: "", apiKey: "" }), baseUrl, ...(preset ? { model: preset.model, apiKeyEnv: preset.apiKeyEnv } : {}) } } }); }} /></div>
          <div className="form-grid"><label>服务名称<input placeholder="例如 小米 MiMo ASR" value={settings.speech?.openai?.name || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", model: "" }), name: event.target.value } } })} /></label><label>模型名称<input placeholder="例如 MiMo-ASR" value={settings.speech?.openai?.model || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", name: "" }), model: event.target.value } } })} /></label><label className="wide-field">Base URL<input placeholder="https://token-plan-cn.xiaomimimo.com/v1" value={settings.speech?.openai?.baseUrl || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { apiKeyEnv: "", model: "", name: "" }), baseUrl: event.target.value } } })} /></label><label>API Key<input type="password" placeholder={settings.speech?.openai?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 API Key"} value={settings.speech?.openai?.apiKey || ""} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, openai: { ...(current.speech.openai || { baseUrl: "", apiKeyEnv: "", model: "", name: "" }), apiKey: event.target.value } } })} /></label></div>
          <p className="settings-help">{ASR_OPENAI_PRESETS.find((preset) => preset.baseUrl === settings.speech?.openai?.baseUrl)?.note || "支持任何 OpenAI 兼容的 /audio/transcriptions 端点。API Key 保存到工作区 .env，不会写入配置文件。"}</p>
        </div>
        <div className={`asr-bailian-config${bailianSelected ? " asr-bailian-active" : ""}`}>
          <div className="card-heading"><strong>阿里云百炼（ASR）</strong><SelectCombobox ariaLabel="百炼识别通道" value={bailianSelected ? speechProvider : "bailian"} options={ASR_BAILIAN_PRESETS.map((preset) => ({ value: preset.provider as string, label: preset.label }))} onChange={(provider) => setSettings((current) => current && { ...current, speech: { ...current.speech, provider: provider as AsrProviderKind } })} /></div>
          <div className="form-grid"><label>服务名称<input placeholder="例如 阿里云百炼 ASR" value={bailian?.name || ""} onChange={(event) => updateBailian({ name: event.target.value })} /></label><label>整句识别模型<input placeholder={BAILIAN_DEFAULTS.model} value={bailian?.model || ""} onChange={(event) => updateBailian({ model: event.target.value })} /></label><label>流式识别模型<input placeholder={BAILIAN_DEFAULTS.streamModel} value={bailian?.streamModel || ""} onChange={(event) => updateBailian({ streamModel: event.target.value })} /></label><label className="wide-field">Base URL（chat/completions）<input placeholder={BAILIAN_DEFAULTS.baseUrl} value={bailian?.baseUrl || ""} onChange={(event) => updateBailian({ baseUrl: event.target.value })} /></label><label className="wide-field">WebSocket URL（流式）<input placeholder={BAILIAN_DEFAULTS.wsUrl} value={bailian?.wsUrl || ""} onChange={(event) => updateBailian({ wsUrl: event.target.value })} /></label><label>API Key<input type="password" placeholder={bailian?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴百炼 API Key"} value={bailian?.apiKey || ""} onChange={(event) => updateBailian({ apiKey: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={bailian?.enableItn === true} onChange={(event) => updateBailian({ enableItn: event.target.checked })} /> 启用 ITN（数字规范化）</label></div>
          <p className="settings-help">{ASR_BAILIAN_PRESETS.map((preset) => `${preset.label}：${preset.note}`).join(" ")}百炼不支持 /audio/transcriptions（会返回 404），请勿把百炼地址填到上面的 OpenAI 兼容面板。API Key 保存到工作区 .env 的 {(bailian?.apiKeyEnv || BAILIAN_DEFAULTS.apiKeyEnv)}，无界面环境也可直接用 BAILIAN_BASE_URL、BAILIAN_WS_URL、BAILIAN_ASR_MODEL、BAILIAN_STREAM_MODEL、BAILIAN_LANGUAGE、BAILIAN_ENABLE_ITN 预置。</p>
        </div>
        <div className="asr-mimo-config">
          <div className="card-heading"><strong>小米 MiMo（ASR）</strong></div>
          <div className="form-grid"><label>模型名称<input placeholder={MIMO_ASR_DEFAULTS.model} value={mimo?.model || ""} onChange={(event) => updateMimo({ model: event.target.value })} /></label><label>识别语言<SelectCombobox ariaLabel="MiMo 识别语言" value={mimo?.language || "auto"} options={[{ value: "auto", label: "自动检测" }, { value: "zh", label: "中文" }, { value: "en", label: "英文" }]} onChange={(language) => updateMimo({ language })} /></label><label className="wide-field">Base URL<input placeholder={MIMO_ASR_DEFAULTS.baseUrl} value={mimo?.baseUrl || ""} onChange={(event) => updateMimo({ baseUrl: event.target.value })} /></label><label>API Key<input type="password" placeholder={mimo?.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 MiMo API Key"} value={mimo?.apiKey || ""} onChange={(event) => updateMimo({ apiKey: event.target.value })} /></label></div>
          <p className="settings-help">MiMo 走专用协议（POST /v1/chat/completions + input_audio，仅支持 mp3/wav），与 OpenAI 兼容面板的 /audio/transcriptions 不同，不要混填。Key 保存到 .env 的 {(mimo?.apiKeyEnv || MIMO_ASR_DEFAULTS.apiKeyEnv)}。</p>
        </div>
        <div className="asr-chain-config">
          <div className="card-heading"><strong>自定义回退链（可选）</strong><small>按顺序尝试；留空使用上方默认链。本地离线始终兜底。</small></div>
          <ol className="asr-chain-list">{(settings.speech?.chain || []).map((id, index) => <li key={`${id}-${index}`}><span>{asrChainEntries.find((entry) => entry.value === id)?.label || id}</span><button type="button" className="text-button" aria-label="上移" disabled={index === 0} onClick={() => updateAsrChain([...settings.speech!.chain!.slice(0, index - 1), settings.speech!.chain![index], settings.speech!.chain![index - 1], ...settings.speech!.chain!.slice(index + 1)])}>↑</button><button type="button" className="text-button" aria-label="下移" disabled={index === (settings.speech?.chain?.length || 1) - 1} onClick={() => updateAsrChain([...settings.speech!.chain!.slice(0, index), settings.speech!.chain![index + 1], settings.speech!.chain![index], ...settings.speech!.chain!.slice(index + 2)])}>↓</button><button type="button" className="text-button danger" aria-label="移除" onClick={() => updateAsrChain(settings.speech!.chain!.filter((_, itemIndex) => itemIndex !== index))}>移除</button></li>)}</ol>
          <div className="asr-chain-add"><SelectCombobox ariaLabel="添加回退项" value="" options={[{ value: "", label: "+ 添加回退项…" }, ...asrChainEntries.filter((entry) => !(settings.speech?.chain || []).includes(entry.value))]} onChange={(id) => { if (id) updateAsrChain([...(settings.speech?.chain || []), id]); }} /></div>
        </div>
        <div className="asr-noise-config">
          <div className="card-heading"><strong>嘈杂环境优化（教室/希沃一体机）</strong></div>
          <div className="form-grid"><label className="wide-field">环境模式<SelectCombobox ariaLabel="环境模式" value={settings.speech?.noise?.profile || "standard"} options={[{ value: "standard", label: "标准（安静的近场环境）" }, { value: "classroom", label: "教室（远场 VAD + 噪声容忍，推荐希沃）" }, { value: "custom", label: "自定义" }]} onChange={(profile) => setSettings((current) => current && { ...current, speech: { ...current.speech, noise: { ...(current.speech.noise || {}), profile: profile as "standard" | "classroom" | "custom", ...(profile === "classroom" ? { vadModel: "far_field_meeting_16k", speechNoiseThreshold: -0.4 } : {}) } } })} /></label><label>VAD 场景<SelectCombobox ariaLabel="VAD 场景" value={settings.speech?.noise?.vadModel || "far_field_meeting_16k"} options={[{ value: "far_field_meeting_16k", label: "远场（麦克风距讲者较远）" }, { value: "near_meeting_16k", label: "近场（贴近讲话）" }]} onChange={(vadModel) => setSettings((current) => current && { ...current, speech: { ...current.speech, noise: { ...(current.speech.noise || {}), vadModel: vadModel as "far_field_meeting_16k" | "near_meeting_16k" } } })} /></label><label>噪声判定阈值<input type="number" step="0.1" min={-1} max={1} placeholder="-0.4（教室推荐 -0.2 ~ -0.6）" value={settings.speech?.noise?.speechNoiseThreshold ?? ""} onChange={(event) => { const parsed = Number(event.target.value); setSettings((current) => current && { ...current, speech: { ...current.speech, noise: { ...(current.speech.noise || {}), speechNoiseThreshold: Number.isFinite(parsed) && event.target.value !== "" ? parsed : undefined } } }); }} /></label><label className="wide-field">即时热词（逗号分隔，权重 50 超级热词）<input placeholder="例如：小泽同学,希沃,百炼" value={(settings.speech?.noise?.hotwords || []).join(",")} onChange={(event) => setSettings((current) => current && { ...current, speech: { ...current.speech, noise: { ...(current.speech.noise || {}), hotwords: event.target.value.split(/[,，]/).map((word) => word.trim()).filter(Boolean) } } })} /></label></div>
          <p className="settings-help">阈值越接近 -1 越不容易漏掉语音（教室嘈杂推荐 -0.2 ~ -0.6，步长 0.1 微调）；远场 VAD 适配麦克风在屏幕顶部的希沃一体机。热词可显著提升专有名词的召回。</p>
        </div>
        <div className="asr-audio-config">
          <div className="card-heading"><strong>音频设备</strong><button type="button" className="text-button" onClick={() => { void refreshAudioDevices(); }}>刷新设备列表</button></div>
          <div className="form-grid"><label className="wide-field">输入设备（麦克风）<SelectCombobox ariaLabel="输入设备" value={settings.speech?.audio?.input || "auto"} options={audioInputOptions} onChange={(input) => setSettings((current) => current && { ...current, speech: { ...current.speech, audio: { ...(current.speech.audio || {}), input } } })} /></label><label className="wide-field">输出设备（扬声器）<SelectCombobox ariaLabel="输出设备" value={settings.speech?.audio?.output || "auto"} options={audioOutputOptions} onChange={(output) => setSettings((current) => current && { ...current, speech: { ...current.speech, audio: { ...(current.speech.audio || {}), output } } })} /></label></div>
          <p className="settings-help">「自动检测」选择系统通讯默认麦克风（带回声消除）；「系统默认」强制用第一个输入设备；也可指定外接麦克风。输出设备影响语音播报的播放目标。</p>
        </div>
        <div className="asr-test-row"><button type="button" className="secondary-button" disabled={asrTesting} onClick={() => { setAsrTesting(true); setAsrTests(null); void bridge.testSpeech(settings.speech?.provider || "auto").then((results) => setAsrTests(results)).catch((reason) => setAsrTests([{ id: "error", label: "测试失败", ok: false, message: reason instanceof Error ? reason.message : String(reason) }])).finally(() => setAsrTesting(false)); }}>{asrTesting ? "测试中…" : "测试识别服务连通性"}</button>{asrTests && <ul className="asr-test-results">{asrTests.map((result) => <li key={result.id} className={result.ok ? "asr-test-ok" : "asr-test-fail"}><strong>{result.label}</strong><span>{result.message}</span></li>)}</ul>}</div>
      </article>
    </section>
    <section id="settings-models" className={`settings-section ${isOobe || activePage === "settings-models" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>模型提供商</h2><p>每个提供商可以包含多个模型；预设信息在启动时从 models.dev 更新。</p></div></div>
      <article className="settings-card official-service-card"><div className="card-heading"><strong>SecAgent 官方服务</strong>{officialLoggedIn && <button className="text-button danger" onClick={() => void officialLogout()}>退出登录</button>}</div>{!officialLoggedIn && <p>使用浏览器打开 SECTL 授权页登录，登录完成后自动返回 SecAgent。</p>}{!officialLoggedIn && <button className="primary-button" type="button" disabled={officialBusy} onClick={() => void officialLogin()}>{officialBusy ? "等待浏览器授权…" : "打开浏览器登录 SECTL"}</button>}{officialLoggedIn && <div className="official-balance-row"><span>账户余额</span><strong className="points-value">{officialPointsBusy ? "读取中…" : officialPoints === null ? "暂不可用" : `${officialPoints.toFixed(6)} Points`}</strong><button className="secondary-button" type="button" onClick={() => void refreshOfficialPoints()}>刷新余额</button></div>}{officialLoggedIn && <div className="official-redeem-row"><input value={redeemCode} onChange={(event) => setRedeemCode(event.target.value)} placeholder="输入兑换码" aria-label="兑换码" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void redeemOfficialCode(); } }} /><button className="secondary-button" type="button" disabled={redeemBusy} onClick={() => void redeemOfficialCode()}>{redeemBusy ? "兑换中…" : "兑换"}</button></div>}<label className="toggle-row"><span className="toggle-copy"><strong>自定义模型模式</strong><small>关闭时自定义供应商不生效，必须登录 SecAgent 官方服务后才能使用模型；开启后主界面模型与推理强度合并为「快速 / 标准 / 深度」档位（默认标准）。</small></span><input type="checkbox" checked={Boolean(settings.customModelMode)} onChange={(event) => setSettings((current) => current && { ...current, customModelMode: event.target.checked })} /></label><div className="default-model-settings"><label>默认模型<SelectCombobox ariaLabel="默认模型" value={settings.defaultModelId || defaultModel?.id || ""} options={mainModelOptions.map((model) => ({ value: model.id, label: model.name, group: model.providerLabel }))} onChange={(modelId) => setSettings((current) => current && { ...current, defaultModelId: modelId })} /></label><label>识图模型<SelectCombobox ariaLabel="识图模型" value={settings.visionModelId || ""} options={[{ value: "", label: "未配置（不使用识图工具）" }, ...availableModels.map((model) => ({ value: model.id, label: model.name, group: model.providerLabel }))]} onChange={(modelId) => setSettings((current) => current && { ...current, visionModelId: modelId || undefined })} /></label><label>默认思考强度<SelectCombobox ariaLabel="默认思考强度" value={defaultReasoningEffort} options={defaultReasoningEfforts.map((effort) => ({ value: effort, label: reasoningEffortLabels[effort] }))} onChange={(effort) => setSettings((current) => current && { ...current, defaultReasoningEffort: effort as ReasoningEffort })} /></label></div><p className="settings-help">当主模型不支持直接查看图片时，Agent 会自动调用识图工具，把本地图片交给识图模型并返回文字结果；官方模式默认使用识图虚拟模型，无需手动选择。</p></article>
      {providerModalOpen && editingProvider && <div className="settings-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setProviderModalOpen(false); setEditingProvider(null); } }}><div className="settings-modal"><div className="session-modal-header"><strong>{settings.providers.some((provider) => provider.id === editingProvider.id) ? "编辑提供商" : "添加提供商"}</strong><button type="button" className="text-button" onClick={() => { setProviderModalOpen(false); setEditingProvider(null); }}>关闭</button></div><div className="form-grid"><label>提供商名称<input value={editingProvider.name} disabled={presetLocked} onChange={(event) => updateProvider({ name: event.target.value })} /></label><label>预设<PresetCombobox value={editingProvider.preset || "custom"} presets={providerPresets} onSelect={applyProviderPreset} /></label><label>协议<SelectCombobox ariaLabel="协议" value={editingProvider.provider} disabled={presetLocked} options={[{ value: "openai-compatible", label: "OpenAI Chat 兼容" }, { value: "openai-responses", label: "OpenAI Responses" }, { value: "anthropic", label: "Anthropic" }, { value: "google", label: "Google Gemini" }]} onChange={(provider) => updateProvider({ provider: provider as ProviderConfig["provider"] })} /></label><label className="wide-field">Base URL<input value={editingProvider.baseUrl} disabled={presetLocked} onChange={(event) => updateProvider({ baseUrl: event.target.value })} /></label><label>Endpoint<input value={editingProvider.endpoint || ""} disabled={presetLocked} onChange={(event) => updateProvider({ endpoint: event.target.value })} /></label><label>API Key<input type="password" placeholder={editingProvider.apiKeyConfigured ? "已配置（留空保持不变）" : "粘贴 API Key"} value={editingProvider.apiKey || ""} onChange={(event) => updateProvider({ apiKey: event.target.value })} /></label></div><p className="settings-help">API Key 保存到工作区 .env 文件，无需手动填写环境变量名。</p><div className="provider-model-editor"><div className="card-heading"><strong>模型列表</strong><div className="item-actions"><button type="button" className="secondary-button" disabled={modelsFetching || !editingProvider.baseUrl?.trim()} onClick={() => { setModelsFetching(true); setModelsFetchMessage(null); void bridge.fetchRemoteModels({ baseUrl: editingProvider.baseUrl, apiKey: editingProvider.apiKey, apiKeyEnv: editingProvider.apiKeyEnv }).then((result) => { setModelsFetchMessage(result.message); if (result.ok && result.models.length) { const existing = new Set(editingProvider.models.map((model) => model.id)); updateProvider({ models: [...editingProvider.models, ...result.models.filter((remote) => !existing.has(remote.id)).slice(0, 50).map((remote) => ({ id: remote.id, name: remote.id, enabled: true }))] }); } }).catch((reason) => setModelsFetchMessage(reason instanceof Error ? reason.message : String(reason))).finally(() => setModelsFetching(false)); }}>{modelsFetching ? "拉取中…" : "从 API 拉取模型列表"}</button><button type="button" className="secondary-button" disabled={presetLocked} onClick={() => { setNewModelDraft(" "); }}>+ 添加模型</button></div></div>{modelsFetchMessage && <p className="settings-help">{modelsFetchMessage}</p>}{newModelDraft !== "" && <div className="provider-model-row provider-model-add-row"><input autoFocus aria-label="新模型 ID" placeholder="输入模型 ID，例如 glm-4.7-flash" value={newModelDraft.trim()} onChange={(event) => setNewModelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setNewModelDraft(""); if (event.key === "Enter") { const id = newModelDraft.trim(); if (id && editingProvider && !editingProvider.models.some((model) => model.id === id)) updateProvider({ models: [...editingProvider.models, { id, name: id, enabled: true }] }); setNewModelDraft(""); } }} /><button type="button" className="primary-button" onClick={() => { const id = newModelDraft.trim(); if (id && editingProvider && !editingProvider.models.some((model) => model.id === id)) updateProvider({ models: [...editingProvider.models, { id, name: id, enabled: true }] }); setNewModelDraft(""); }}>添加</button><button type="button" className="text-button" onClick={() => { setNewModelDraft(""); }}>取消</button></div>}{newModelDraft.trim() !== "" && editingProvider?.models.some((model) => model.id === newModelDraft.trim()) && <p className="settings-help">该模型 ID 已存在。</p>}{editingProvider.models.map((model, index) => <div className="provider-model-row" key={`${model.id}-${index}`}><input type="checkbox" title="启用后显示在模型列表" disabled={presetLocked} checked={model.enabled !== false} onChange={() => updateProvider({ models: editingProvider.models.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: item.enabled === false } : item) })} /><input value={model.name || ""} disabled={presetLocked} onChange={(event) => updateProvider({ models: editingProvider.models.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><code>{model.id}</code><button type="button" className="text-button danger" disabled={presetLocked} onClick={() => updateProvider({ models: editingProvider.models.filter((_, itemIndex) => itemIndex !== index) })}>删除</button></div>)}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => { setProviderModalOpen(false); setEditingProvider(null); }}>取消</button><button type="button" className="primary-button" onClick={saveProvider}>保存</button></div></div></div>}
      {settings.customModelMode ? <><div className="section-title provider-add-row"><div><h3>自定义提供商</h3></div><button className="secondary-button" type="button" onClick={() => { setEditingProvider(emptyProvider()); setProviderModalOpen(true); }}>+ 添加提供商</button></div>
      <div className="provider-list settings-cards">{settings.providers.filter((provider) => provider.id !== "sectl-official" && provider.name !== "SecAgent 官方服务").map((provider) => <article className={`settings-card provider-list-item${provider.models.length === 1 ? " single-model" : ""}`} key={provider.id}><div className="card-heading"><div><strong>{provider.name}</strong><span>{provider.models.length} 个模型 · {provider.preset && provider.preset !== "custom" ? `预设：${provider.preset}` : "自定义"}</span></div><div className="item-actions"><button className="secondary-button" type="button" onClick={() => { setEditingProvider({ ...provider, models: provider.models.map((model) => ({ ...model })) }); setProviderModalOpen(true); }}>编辑</button><button className="text-button danger" type="button" onClick={() => removeProvider(provider.id)}>删除</button></div></div></article>)}</div></> : null}
    </section>
    <section id="settings-mcp" className={`settings-section ${isOobe || activePage === "settings-mcp" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>MCP 服务</h2><p>管理可被 SecAgent 发现和调用的 MCP 服务。</p></div><button className="secondary-button" onClick={() => setSettings((current) => current && { ...current, mcp: { servers: { ...current.mcp.servers, [`mcp-${Object.keys(current.mcp.servers).length + 1}`]: emptyMcp() } } })}>+ 添加服务</button></div>
      {Object.keys(settings.mcp.servers).length === 0 && <article className="settings-card settings-empty-card">暂无 MCP 服务</article>}
      <div className="settings-cards">{Object.entries(settings.mcp.servers).map(([name, server]) => <article className="settings-card" key={name}><div className="card-heading"><input className="server-name" value={name} onChange={(event) => renameServer(name, event.target.value)} /><button type="button" className="text-button danger" onClick={() => setSettings((current) => { if (!current) return current; const servers = { ...current.mcp.servers }; delete servers[name]; return { ...current, mcp: { servers } }; })}>删除</button></div><div className="form-grid"><label>传输方式<SelectCombobox ariaLabel="传输方式" value={server.transport} options={[{ value: "http", label: "HTTP" }, { value: "stdio", label: "stdio" }]} onChange={(transport) => updateServer(name, { transport: transport as McpServerConfig["transport"] })} /></label><label className="checkbox-label"><input type="checkbox" checked={server.enabled} onChange={(event) => updateServer(name, { enabled: event.target.checked })} /> 启用</label>{server.transport === "http" ? <label>服务 URL<input value={server.url || ""} onChange={(event) => updateServer(name, { url: event.target.value })} /></label> : <><label>启动命令<input value={server.command || ""} onChange={(event) => updateServer(name, { command: event.target.value })} /></label><label>参数（每行一个）<textarea value={(server.args || []).join("\n")} onChange={(event) => updateServer(name, { args: event.target.value.split(/\r?\n/).filter(Boolean) })} rows={3} /></label></>}</div></article>)}</div>
    </section>
    <section id="settings-plugins" className={`settings-section ${isOobe || activePage === "settings-plugins" ? "settings-section-active" : ""}`}>
      <PluginSettingsPanel plugins={plugins} setPlugins={setPlugins} marketPlugins={marketPlugins} setMarketPlugins={setMarketPlugins} marketError={marketError} setMarketError={setMarketError} />
    </section>
    {!isOobe && plugins.flatMap((plugin) => plugin.settingsPages.map((page) => activePage === `plugin-${plugin.id}-${page.id}` && <section className="settings-section settings-section-active plugin-settings-section" key={`${plugin.id}-${page.id}`}>
      <div className="section-title"><h2>{page.title}</h2></div>
      {plugin.id === "secscore-connector" && page.id === "secscore" ? <SecScoreSettingsPage pluginId={plugin.id} pageId={page.id} /> : <article className={`settings-card plugin-service-status ${plugin.state}`}>
        <span>服务状态</span>
        <strong>{plugin.message || (plugin.state === "ready" ? "已就绪" : "未连接")}</strong>
      </article>}
    </section>))}

    <section id="settings-system" className={"settings-section " + (activePage === "settings-system" ? "settings-section-active" : "")}><div className="section-title"><div><h2>系统</h2><p>管理 SecAgent 是否随系统登录自动启动。</p></div></div>
      <article className="settings-card"><label className="toggle-row"><span className="toggle-copy"><strong>开机自启</strong><small>开启后，系统登录时会在后台启动 SecAgent；需要使用时可从托盘打开主窗口。</small></span><input type="checkbox" checked={settings.autostart === true} onChange={(event) => setSettings((current) => current && { ...current, autostart: event.target.checked })} /></label><label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>开机自启后隐藏主窗口</strong><small>开机自启动时只在托盘后台运行，语音唤醒和全局快捷键照常可用；关闭后开机自启会直接打开主窗口。</small></span><input type="checkbox" checked={settings.autostartHidden !== false} onChange={(event) => setSettings((current) => current && { ...current, autostartHidden: event.target.checked })} /></label></article>
      <article className="settings-card"><div className="card-heading"><strong>模型稳定性（重试与备用切换）</strong><span>适用于阿里云百炼等赠送资源包的模型：配额用尽时自动切换到下一个可用模型。</span></div>
        <label className="toggle-row"><span className="toggle-copy"><strong>请求失败自动重试</strong><small>同一模型对网络波动、超时类错误重试一次后再考虑切换。</small></span><input type="checkbox" checked={settings.resilience?.autoRetry !== false} onChange={(event) => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), autoRetry: event.target.checked } })} /></label>
        <label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>失败时切换备用模型</strong><small>当前模型不可用时，按顺序尝试其他已配置模型；全部不可用才报错。</small></span><input type="checkbox" checked={settings.resilience?.fallbackEnabled !== false} onChange={(event) => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), fallbackEnabled: event.target.checked } })} /></label>
        <label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>记住失败并暂时禁用</strong><small>配额耗尽/鉴权失败的模型冷却一段时间（5 分钟起指数退避，资源包类 60 分钟），期间直接跳过，恢复后自动重新启用。</small></span><input type="checkbox" checked={settings.resilience?.rememberFailures !== false} onChange={(event) => setSettings((current) => current && { ...current, resilience: { ...(current.resilience || { autoRetry: true, fallbackEnabled: true, rememberFailures: true, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 }), rememberFailures: event.target.checked } })} /></label>
      </article>
      <article className="settings-card"><div className="card-heading"><strong>安全与检测</strong><span>敏感操作确认（Codex 风格）与回答幻觉提醒。</span></div>
        <label className="toggle-row"><span className="toggle-copy"><strong>敏感工具操作需手动确认</strong><small>删除文件、格式化、强制推送、写系统目录、下载执行等操作会弹窗确认；可选择「总是允许此类」不再提示。关闭后所有工具直接执行。</small></span><input type="checkbox" checked={settings.guard?.enabled !== false} onChange={(event) => setSettings((current) => current && { ...current, guard: { ...(current.guard || { enabled: true, approved: [] }), enabled: event.target.checked } })} /></label>
        <label className="toggle-row nested-toggle-row"><span className="toggle-copy"><strong>回答幻觉提醒</strong><small>检测最终回答中的重复循环、与工具结果矛盾的「成功」声明、引用不存在的材料等信号，并在回答下方显示提醒条。仅提醒不拦截。</small></span><input type="checkbox" checked={settings.hallucinationEnabled !== false} onChange={(event) => setSettings((current) => current && { ...current, hallucinationEnabled: event.target.checked })} /></label>
      </article>
    </section>
    {!isOobe && <section id="settings-telemetry" className={`settings-section ${activePage === "settings-telemetry" ? "settings-section-active" : ""}`}><div className="section-title"><div><h2>诊断与隐私</h2><p>上传脱敏的错误、崩溃和 Agent 执行失败信息，帮助改进 SecAgent。关闭后不会发送任何遥测。</p></div></div>
      <article className="settings-card"><label className="toggle-row"><span className="toggle-copy"><strong>上传匿名诊断数据</strong><small>包含应用版本、系统、错误类型、网络状态、工具名和脱敏运行阶段；不会上传普通对话内容、API Key 或附件。</small></span><input type="checkbox" checked={settings.telemetry.enabled} onChange={(event) => setSettings((current) => current && { ...current, telemetry: { enabled: event.target.checked } })} /></label><div className="diagnostic-upload-row"><div><strong>上传一次完整诊断包</strong><p className="settings-help">仅在你主动选择会话并确认后上传该会话内容和脱敏 trace，不会自动持续开启。</p></div><div className="diagnostic-upload-controls"><SelectCombobox ariaLabel="诊断会话" disabled={!settings.telemetry.enabled || diagnosticBusy || !diagnosticSessions.length} value={diagnosticSessionId} options={[{ value: "", label: "选择会话" }, ...diagnosticSessions.map((session) => ({ value: session.id, label: `${session.title} · ${new Date(session.updatedAt).toLocaleString()}` }))]} onChange={setDiagnosticSessionId} /><button type="button" className="secondary-button" disabled={!settings.telemetry.enabled || diagnosticBusy || !diagnosticSessionId} onClick={() => void uploadDiagnostic()}>{diagnosticBusy ? "上传中…" : "上传诊断包"}</button></div></div></article>
    </section>}
  </main>;
}
