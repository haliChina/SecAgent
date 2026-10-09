/**
 * 设置应用域真源（B3 自 ipc-sessions.ts 拆出）。
 *
 * settings:save 的完整编排：自定义模型模式过滤、wake 快捷键
 * 换绑（注册失败/保存失败回滚）、自启回滚、telemetry/speech/
 * tts 即时应用、广播与更新偏好同步。行为与拆出前一致。
 */
import { globalShortcut } from "electron";
import { normalizeWakeHotkey, DEFAULT_WAKE_HOTKEY } from "../wake-hotkey.js";
import { saveSettings, type SettingsPayload } from "../config.js";
import { DEFAULT_WORKSPACE } from "../paths.js";
import { officialProvider } from "./ipc-official.js";
import { readAutostart, writeAutostart } from "./autostart.js";
import { logMain } from "./main-log.js";
import { getTelemetry, initializeSentry, recordTelemetryFailure, setSentryTelemetryEnabled } from "./main-telemetry.js";
import { configureSpeech } from "./speech.js";
import { configureTts } from "./tts.js";
import { closeVoiceWakeWindow, getActiveWakeShortcut, openWakeWindow, setActiveWakeShortcut, startConfiguredVoiceWake } from "./wake.js";
import type { WindowsUpdateManager } from "./update-manager.js";

export interface SettingsApplyDeps {
  sendToAppWindows: (channel: string, payload: unknown) => void;
  getUpdateManager: () => WindowsUpdateManager | undefined;
}

export function applySettings(payload: SettingsPayload, deps: SettingsApplyDeps): SettingsPayload {
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
  deps.sendToAppWindows("settings:changed", saved);
  deps.getUpdateManager()?.setPreferences(saved.updates);
  closeVoiceWakeWindow();
  if (saved.wake.voiceEnabled) void startConfiguredVoiceWake().catch((error) => {
    logMain("voice-wake.start.failed", { error: String(error) });
    recordTelemetryFailure({ type: "speech.failed", error, context: { phase: "voice-wake-start" } });
  });
  return saved;
}
