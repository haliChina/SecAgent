import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Notification, screen, session, shell, Tray } from "electron";
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
import { appIconPath, createApplicationMenu, createTray, createWindow, ensureMacDockVisible, getMainWindow, getSettingsWindow, installFileRendererAssetFallback, installWindowDiagnostics, openPluginOverlay, openPluginSvgPreview, openSettings, registerOverlayIpcOnce, rendererPath, restartApplication, setOnboardingCompletionRequested, setIsQuitting, setNotifyWakeHotkey, showMainWindow } from "./windows.js";
import { SENTRY_DSN, Sentry, getTelemetry, initializeSentry, recordTelemetryFailure, setSentryTelemetryEnabled, setTelemetry } from "./main-telemetry.js";
import { AUTO_START_ARGS, isAutostartLaunch, readAutostart, writeAutostart } from "./autostart.js";
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
app.on("second-instance", () => showMainWindow());
app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  const needsOnboarding = !fs.existsSync(configPath(DEFAULT_WORKSPACE)) || !isOnboardingComplete(DEFAULT_WORKSPACE);
  initializeWorkspace(DEFAULT_WORKSPACE);
  const initialSettings = readSettings(DEFAULT_WORKSPACE);
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
  registerSessionsIpc({ getPluginManager: () => pluginManager, sendToAppWindows, getUpdateManager: () => updateManager });
  registerSpeechIpc({ getWakeWindow: getWakeWindow, getVoiceWakeWindow: getVoiceWakeWindow, openWakeWindow });
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
  }, openPluginSvgPreview, openPluginOverlay);
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
app.on("before-quit", () => { updateManager?.handleBeforeQuit(); setIsQuitting(); closeWakeWindow(); closeVoiceWakeWindow(); globalShortcut.unregisterAll(); if (marketplaceUpdateTimer) clearInterval(marketplaceUpdateTimer); if (updateCheckTimer) clearInterval(updateCheckTimer); void secAgentHttpServer?.stop(); void pluginManager?.shutdown(); getTelemetry()?.stop(); });
app.on("window-all-closed", () => { /* Keep the process alive so the tray can reopen the main window. */ });
