import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Notification, safeStorage, screen, session, shell, Tray } from "electron";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { isIPv4 } from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { pathToFileURL } from "node:url";
import { DEFAULT_WORKSPACE, migrateLegacyWorkspace } from "../paths.js";
import { configuredModels, configPath, DEFAULT_TELEMETRY_SETTINGS, initializeWorkspace, isOnboardingComplete, loadConfig, markOnboardingComplete, OFFICIAL_VISION_MODEL, readOobeProgress, readSettings, resolveVisionAgentConfig, saveOobeProgress, saveSettings, useConfiguredModel, writeWorkspaceEnv, type OobeProgress, type SettingsPayload } from "../config.js";
import { loadEnabledSkills } from "../skills.js";
import { AuditStore } from "../audit.js";
import { SecAgentRuntime, type TraceEvent } from "../runtime.js";
import type { ConversationMessage } from "../model-provider.js";
import { SessionStore, type AssistantActivity, type SessionData, type ToolCallRecord } from "../session-store.js";
import { closeAllSessionDbs } from "../session-db.js";
import { configureSecretCipher, migratePlaintextSecrets } from "../secret-store.js";
import { configureSpeech, stopSpeech, stopVoiceWake } from "./speech.js";
import { runSectlOAuthFlow, type SectlOAuthResult } from "./oauth.js";
import { logMain } from "./main-log.js";
import { openWorkspaceFilePreview } from "./workspace-preview.js";
import { registerCompanionIpc } from "./ipc-companions.js";
import { registerPluginIpc } from "./ipc-plugins.js";
import { officialProvider, registerOfficialIpc, runSectlOAuthLogin } from "./ipc-official.js";
import { registerSpeechIpc } from "./ipc-speech.js";
import { registerSettingsIpc } from "./ipc-settings.js";
import { closeVoiceWakeWindow, closeWakeWindow, getVoiceWakeWindow, getWakeWindow, openWakeWindow, registerWakeIpc, registerWakeShortcut, startConfiguredVoiceWake } from "./wake.js";
import { registerSessionsIpc } from "./ipc-sessions.js";
import { appIconPath, createApplicationMenu, createTray, createWindow, ensureMacDockVisible, getMainWindow, getSettingsWindow, installFileRendererAssetFallback, installWindowDiagnostics, isCustomWindowControls, openPluginOverlay, openPluginSvgPreview, openSettings, refreshWindowControlsMode, registerOverlayIpcOnce, rendererPath, restartApplication, setOnboardingCompletionRequested, setIsQuitting, setNotifyWakeHotkey, showMainWindow, showPluginFlash, agentActivityBadge } from "./windows.js";
import { SENTRY_DSN, Sentry, getTelemetry, initializeSentryAfterMigration, recordTelemetryFailure, setSentryTelemetryEnabled, setTelemetry } from "./main-telemetry.js";
import { AUTO_START_ARG, AUTO_START_ARGS, isAutostartLaunch, readAutostart, writeAutostart } from "./autostart.js";
import type { ChatAttachment, ReasoningEffort, UpdateState } from "../types.js";
import { listGoogleModels, type GoogleModelInfo } from "../google-models.js";
import { configureTts } from "./tts.js";
import { PluginManager, type SvgPreviewRequest, type OverlayRequest, type PluginOverlayHandle } from "../plugin-manager.js";
import { MarketplaceClient, type MarketplaceVersion } from "../marketplace.js";
import { SecAgentHttpServer } from "../secagent-http.js";
import { Models } from "@opencode-ai/models";
import { DEFAULT_WAKE_HOTKEY, normalizeWakeHotkey } from "../wake-hotkey.js";
import { generateSessionTitle } from "../session-title.js";
import { normalizeReasoningEffort } from "../reasoning.js";
import { WindowsUpdateManager } from "./update-manager.js";
import { diagnosticLogDirectory, exportDiagnosticLogs } from "./diagnostic-logs.js";
import { TelemetryClient, hashIdentifier, normalizeMessage, sanitizeStack, type TelemetryFailure } from "../telemetry.js";

// One-time move of the legacy `~/SecAgentWorkspace` tree into the
// platform-standard data directory. Must run before anything reads the
// workspace, so it lives at module scope ahead of the first loadConfig call.
try {
  const migratedTo = migrateLegacyWorkspace();
  if (migratedTo) console.info(`[paths] 已将旧工作区迁移到 ${migratedTo}`);
} catch (error) {
  console.warn("[paths] 旧工作区迁移失败，将继续使用新路径", error);
}

initializeSentryAfterMigration();

let pluginManager: PluginManager | undefined;
let secAgentHttpServer: SecAgentHttpServer | undefined;
let updateManager: WindowsUpdateManager | undefined;
const marketplace = new MarketplaceClient();
// Plugin updates hot-swap as soon as they download, but the poll itself only
// reads the signed index (one request), so a 10-minute cadence stays friendly
// to the shared proxy.
const MARKETPLACE_UPDATE_INTERVAL_MS = 10 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const execFileAsync = promisify(execFile);
let marketplaceUpdateTimer: NodeJS.Timeout | undefined;
let updateCheckTimer: NodeJS.Timeout | undefined;

function launchWindowsInstaller(installerPath: string): void {
  if (process.platform !== "win32") throw new Error("更新安装仅支持 Windows");
  // /FORCECLOSEAPPLICATIONS is essential: without it a still-running SecAgent
  // (e.g. the user reopening the app while the elevated setup waits at UAC)
  // makes Restart Manager's RmShutdown fail, and the suppressed prompt in
  // very-silent mode answers with its default (Abort) - the installer exits
  // silently having installed nothing. Force the close, and let Restart
  // Manager bring the app back when the files are in place.
  const child = spawn(installerPath, ["/SP-", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/FORCECLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"], { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", (error) => {
    logMain("updates.install.process.failed", { error: error.message, path: installerPath });
    recordTelemetryFailure({ type: "update.failed", error, context: { phase: "launch" } });
  });
  child.unref();
}

async function updateInstalledPlugins(): Promise<void> {
  if (!pluginManager) return;
  try {
    const { updates, errors } = await marketplace.installUpdates(pluginManager);
    if (updates.length) logMain("marketplace.plugins.updated", { updates });
    else logMain("marketplace.plugins.checked", { updated: 0 });
    if (errors.length) logMain("marketplace.plugins.update.errors", { errors });
  } catch (error) {
    logMain("marketplace.plugins.update.failed", { error: error instanceof Error ? error.message : String(error) });
    recordTelemetryFailure({ type: "plugin.start.failed", error, context: { phase: "marketplace-update" } });
  }
}

process.on("uncaughtException", (error) => {
  logMain("process.uncaught", { error: normalizeMessage(error instanceof Error ? error.message : String(error)) });
  recordTelemetryFailure({ type: "main.uncaught", error });
});
process.on("unhandledRejection", (reason) => {
  logMain("process.unhandled-rejection", { error: normalizeMessage(reason instanceof Error ? reason.message : String(reason)) });
  recordTelemetryFailure({ type: "unhandled.rejection", error: reason });
});

function sendToAppWindows(channel: string, payload: unknown): void {
  for (const target of [getMainWindow(), getSettingsWindow(), getWakeWindow(), getVoiceWakeWindow()]) {
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) continue;
    try {
      target.webContents.send(channel, payload);
    } catch {
      // A renderer may close between the destroyed check and send().
    }
  }
}

/** R57：敏感工具确认到达时唤起应用窗口（应用在后台时弹层点不到）。 */
function raiseAppWindows(): void {
  for (const target of [getMainWindow(), getSettingsWindow()]) {
    if (!target || target.isDestroyed()) continue;
    try {
      if (!target.isVisible()) target.showInactive();
      target.focus();
    } catch {
      // Windows may close mid-operation.
    }
  }
}

/** R57：批准全局组合键类命令前让出前台——最小化当前聚焦的本应用窗口，
 * 焦点回落到用户原本所在窗口，Alt+F4 之类不再关掉本应用自己。 */
function yieldAppForeground(): void {
  for (const target of [getMainWindow(), getSettingsWindow()]) {
    if (!target || target.isDestroyed()) continue;
    try {
      if (target.isFocused()) target.minimize();
    } catch {
      // Windows may close mid-operation.
    }
  }
}

/** R57：Windows 标题栏三键（WCO）配色随主题同步——渲染端换肤后上报
 * topbar 实色，主进程调 setTitleBarOverlay 消掉硬编码白色。 */
ipcMain.handle("window:chrome-sync", (_event, colors: { background?: string; symbol?: string }) => {
  if (process.platform !== "win32") return { ok: true };
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target || target.isDestroyed()) continue;
    try {
      target.setTitleBarOverlay({
        color: typeof colors.background === "string" ? colors.background : "#F1F4F9",
        symbolColor: typeof colors.symbol === "string" ? colors.symbol : "#475569",
        height: 57
      });

    } catch {
      // Not every window uses the overlay.
    }
  }
  return { ok: true };
});

/**
 * R89：自绘窗口三键。close 仍走 BrowserWindow.close()，保留主窗“关到托盘”的既有行为。
 *
 * R94：此前这段被插进 window:chrome-sync 的 for/try 里——只有换肤时才顺带注册，
 * 而且第二次注册会抛错（被外层 catch 吞掉）。结果就是自绘三键点了没反应。
 * 现在改为模块加载时注册一次，并缓存设置读取结果，避免 IPC 路径上反复读配置。
 */
ipcMain.handle("window:control", (event, action: unknown) => {
  if (process.platform !== "win32") return { isMaximized: false, custom: false };
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target.isDestroyed()) return { isMaximized: false, custom: isCustomWindowControls() };
  try {
    if (action === "minimize") target.minimize();
    else if (action === "toggle-maximize") { if (target.isMaximized()) target.unmaximize(); else target.maximize(); }
    else if (action === "close") target.close();
  } catch (error) {
    logMain("window.control.failed", { action: String(action), error: error instanceof Error ? error.message : String(error) });
    return { isMaximized: false, custom: isCustomWindowControls(), error: error instanceof Error ? error.message : String(error) };
  }
  return { isMaximized: target.isMaximized(), custom: isCustomWindowControls() };
});

ipcMain.handle("workspace:preview-file", (_event, relativePath: string) => openWorkspaceFilePreview(relativePath));

ipcMain.handle("oobe:progress:get", () => readOobeProgress(DEFAULT_WORKSPACE));
ipcMain.handle("oobe:progress:save", (_event, progress: OobeProgress) => {
  saveOobeProgress(DEFAULT_WORKSPACE, progress);
  return readOobeProgress(DEFAULT_WORKSPACE);
});
ipcMain.handle("oobe:complete", (event) => {
  setOnboardingCompletionRequested(true);
  markOnboardingComplete(DEFAULT_WORKSPACE);
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed() && senderWindow === getSettingsWindow()) senderWindow.close();
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
  return { ok: true };
});

// A second launch focuses the running instance instead of competing for the
// wake shortcut, the tray, and the local HTTP server port.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_event, argv) => {
  /* R74：开机双注册（计划任务 + 安装器 Run 键）会让两个 --autostart 实例
     并发抢锁，后到者退出时触发本事件——安静待命模式下不该被顶出主窗。
     只有用户手动拉起（argv 无 --autostart，如双击 exe / 开始菜单）才唤起。 */
  if (argv.includes(AUTO_START_ARG)) { logMain("second-instance.autostart.skipped"); return; }
  showMainWindow();
});
app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  /* R93：密钥加密必须在 initializeWorkspace/readSettings 之前配置；
     safeStorage 只在 app ready 后可用。不可用时保持旧明文 .env，不静默降级。 */
  try {
    configureSecretCipher({
      available: safeStorage.isEncryptionAvailable(),
      encrypt: (value: string) => safeStorage.encryptString(value).toString("base64"),
      decrypt: (payload: string) => safeStorage.decryptString(Buffer.from(payload, "base64"))
    });
  } catch (error) {
    configureSecretCipher(null);
    logMain("secrets.cipher.unavailable", { error: error instanceof Error ? error.message : String(error) });
  }
  const needsOnboarding = !fs.existsSync(configPath(DEFAULT_WORKSPACE)) || !isOnboardingComplete(DEFAULT_WORKSPACE);
  initializeWorkspace(DEFAULT_WORKSPACE);
  try {
    const migrated = migratePlaintextSecrets(DEFAULT_WORKSPACE);
    if (migrated) logMain("secrets.migrated", { count: migrated });
  } catch (error) {
    logMain("secrets.migrate.failed", { error: error instanceof Error ? error.message : String(error) });
  }
  const initialSettings = readSettings(DEFAULT_WORKSPACE);
  refreshWindowControlsMode();
  /* 自动归档：启动时扫描一次；读取或写库失败都不应阻塞应用启动。 */
  const archivePolicy = initialSettings.archive;
  if (archivePolicy?.auto) {
    try {
      const archived = new SessionStore(DEFAULT_WORKSPACE).autoArchive(archivePolicy.retentionDays);
      if (archived > 0) logMain("sessions.archive.auto", { archived, retentionDays: archivePolicy.retentionDays });
    } catch (error) {
      logMain("sessions.archive.auto.failed", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  setSentryTelemetryEnabled(initialSettings.telemetry.enabled);
  setTelemetry(new TelemetryClient({
    baseUrl: process.env.SECTL_OFFICIAL_API_URL || "",
    storageDirectory: app.getPath("userData"),
    appVersion: app.getVersion(),
    enabled: initialSettings.telemetry.enabled,
    getAuthToken: () => process.env.SECTL_OFFICIAL_TOKEN || undefined
  }));
  getTelemetry()!.start();
  if (SENTRY_DSN) Sentry.getCurrentScope().setTags({ app_version: app.getVersion(), platform: process.platform, arch: process.arch });
  updateManager = new WindowsUpdateManager({
    currentVersion: app.getVersion(),
    preferences: initialSettings.updates,
    platform: process.platform,
    isPackaged: app.isPackaged,
    storageDirectory: app.getPath("userData"),
    publish: (state) => {
      sendToAppWindows("updates:state", state);
      if (state.status === "error") recordTelemetryFailure({ type: "update.failed", error: new Error(state.error || "update failed"), context: { channel: state.channel } });
    },
    quit: () => app.quit(),
    launchInstaller: launchWindowsInstaller,
    log: logMain
  });
  // An autostart launch that finds a fully downloaded update installs it
  // immediately and exits; the installer's /RESTARTAPPLICATIONS brings the
  // (updated) app back without the --autostart argument, so the fresh session
  // shows the main window normally. Manual launches are not interrupted.
  if (isAutostartLaunch() && updateManager.hasPendingInstall()) {
    logMain("updates.install.on.autostart", { version: updateManager.getState().downloadedVersion });
    void updateManager.verifyPendingChecksum().then((valid) => {
      if (valid) {
        try {
          updateManager?.install();
          return;
        } catch (error) {
          logMain("updates.install.on.autostart.failed", { error: error instanceof Error ? error.message : String(error) });
        }
      }
      // Nothing to install (or checksum failed) - continue the normal startup.
      void startApplication();
    });
    return;
  }
  await startApplication();
});
async function startApplication(): Promise<void> {
  registerCompanionIpc(() => getSettingsWindow() || getMainWindow());
  registerPluginIpc({ getPluginManager: () => pluginManager, getMarketplace: () => marketplace, getWindow: () => getSettingsWindow() || getMainWindow() });
  registerOfficialIpc();
  registerSettingsIpc({ getUpdateManager: () => updateManager, openSettings });
  registerWakeIpc();
  registerSessionsIpc({ getPluginManager: () => pluginManager, sendToAppWindows, getUpdateManager: () => updateManager, toolConfirmWindowHooks: { raiseAppWindows, yieldForeground: yieldAppForeground } });
  registerSpeechIpc({ getWakeWindow: getWakeWindow, getVoiceWakeWindow: getVoiceWakeWindow, getMainWindow: getMainWindow, openWakeWindow });
  const needsOnboarding = !fs.existsSync(configPath(DEFAULT_WORKSPACE)) || !isOnboardingComplete(DEFAULT_WORKSPACE);
  const initialSettings = readSettings(DEFAULT_WORKSPACE);
  // Apply the persisted ASR preference before any speech session can start.
  configureSpeech(initialSettings.speech);
  configureTts(initialSettings.tts);
  pluginManager = new PluginManager(DEFAULT_WORKSPACE, {
    getSession: async () => {
      loadConfig(DEFAULT_WORKSPACE);
      const accessToken = process.env.SECTL_OFFICIAL_TOKEN || "";
      return accessToken ? { accessToken, userId: process.env.SECTL_OFFICIAL_USER_ID || undefined, email: process.env.SECTL_OFFICIAL_EMAIL || undefined } : null;
    },
    oauthLogin: runSectlOAuthLogin,
  }, openPluginSvgPreview, openPluginOverlay, showPluginFlash, agentActivityBadge);
  try { await pluginManager.initialize(); }
  catch (error) {
    recordTelemetryFailure({ type: "plugin.start.failed", error, context: { phase: "initialize" } });
    throw error;
  }
  secAgentHttpServer = new SecAgentHttpServer(pluginManager, marketplace);
  try { await secAgentHttpServer.start(); }
  catch (error) { logMain("secagent-http.error", { message: error instanceof Error ? error.message : String(error), port: 42189 }); }
  pluginManager.onChanged(() => {
    const list = pluginManager?.list() || [];
    getMainWindow()?.webContents.send("plugins:changed", list);
    getSettingsWindow()?.webContents.send("plugins:changed", list);
  });
  const initialMarketplaceUpdate = setTimeout(() => { void updateInstalledPlugins(); }, 5_000);
  initialMarketplaceUpdate.unref?.();
  marketplaceUpdateTimer = setInterval(() => { void updateInstalledPlugins(); }, MARKETPLACE_UPDATE_INTERVAL_MS);
  marketplaceUpdateTimer.unref?.();
  const initialUpdateCheck = setTimeout(() => { void updateManager?.check(true); }, 5_000);
  initialUpdateCheck.unref?.();
  updateCheckTimer = setInterval(() => { void updateManager?.check(true); }, UPDATE_CHECK_INTERVAL_MS);
  updateCheckTimer.unref?.();
  // Electron otherwise rejects getUserMedia requests in some desktop environments.
  // Speech audio is streamed to the official cloud ASR service.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  installFileRendererAssetFallback();
  createApplicationMenu();
  createTray();
  if (process.platform === "darwin") {
    // The wake overlay skips the Dock, but SecAgent itself remains a regular
    // application while the overlay is visible over full-screen Spaces.
    await ensureMacDockVisible();
    app.dock?.setIcon(appIconPath());
  }
  logMain("app.ready");
  // An autostart launch stays in the tray (voice wake and shortcuts keep running)
  // unless the user turned the "hide the main window after autostart" option off.
  createWindow(!needsOnboarding && (!isAutostartLaunch() || initialSettings.autostartHidden === false));
  try {
    registerWakeShortcut(initialSettings.wake.hotkey || DEFAULT_WAKE_HOTKEY);
    if (initialSettings.wake.voiceEnabled) void startConfiguredVoiceWake().catch((error) => {
      logMain("voice-wake.start.failed", { error: String(error) });
      recordTelemetryFailure({ type: "speech.failed", error, context: { phase: "voice-wake-start" } });
    });
  }
  catch (error) { logMain("wake.shortcut.register.failed", { error: error instanceof Error ? error.message : String(error) }); }
  if (needsOnboarding) openSettings(true);
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
app.on("before-quit", () => { updateManager?.handleBeforeQuit(); setIsQuitting(); closeWakeWindow(); closeVoiceWakeWindow(); globalShortcut.unregisterAll(); if (marketplaceUpdateTimer) clearInterval(marketplaceUpdateTimer); if (updateCheckTimer) clearInterval(updateCheckTimer); void secAgentHttpServer?.stop(); void pluginManager?.shutdown(); getTelemetry()?.stop(); /* 关连接触发 WAL checkpoint，避免遗留 -wal 文件 */ closeAllSessionDbs(); });
app.on("window-all-closed", () => { /* Keep the process alive so the tray can reopen the main window. */ });
