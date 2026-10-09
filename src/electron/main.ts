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
import { SENTRY_DSN, Sentry, getTelemetry, initializeSentry, recordTelemetryFailure, setSentryTelemetryEnabled, setTelemetry } from "./main-telemetry.js";
import { AUTO_START_ARGS, isAutostartLaunch, readAutostart, writeAutostart } from "./autostart.js";
import type { ChatAttachment, ReasoningEffort, UpdateState } from "../types.js";
import { listGoogleModels, type GoogleModelInfo } from "../google-models.js";
import { configureTts } from "./tts.js";
import { PluginManager, type SvgPreviewRequest } from "../plugin-manager.js";
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

let windowRef: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let onboardingCompletionRequested = false;
let wakeWindow: BrowserWindow | undefined;
let voiceWakeWindow: BrowserWindow | undefined;
let pluginManager: PluginManager | undefined;
let secAgentHttpServer: SecAgentHttpServer | undefined;
let updateManager: WindowsUpdateManager | undefined;
let activeWakeShortcut: string | undefined;
let activeWakeContext: { sessionId?: string; modelId?: string; reasoningEffort?: ReasoningEffort } = {};
let wakeAbortController: AbortController | undefined;
const marketplace = new MarketplaceClient();
const activeSessionRuns = new Map<string, AbortController>();
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

function appIconPath(): string {
  const bundledIcon = path.join(__dirname, "../renderer/icon.png");
  return fs.existsSync(bundledIcon) ? bundledIcon : path.join(process.cwd(), "src/renderer/public/icon.png");
}

function installFileRendererAssetFallback(): void {
  const publicAssets = new Set(["icon.svg", "icon.png", "session-chevron.svg", "image-icon.svg", "mic-icon.svg", "classisland-icon.png", "cw-icon.png", "secrandom-logo.png", "SecScore.png", "iccce-logo.png"]);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["file:///*"] }, (details, callback) => {
    try {
      const requestedPath = new URL(details.url).pathname;
      const assetName = path.basename(requestedPath);
      if (!publicAssets.has(assetName)) return callback({});
      if (requestedPath !== `/${assetName}`) return callback({});
      const assetPath = path.join(__dirname, "../renderer", assetName);
      if (fs.existsSync(assetPath)) return callback({ redirectURL: pathToFileURL(assetPath).href });
    } catch { /* Let Chromium report the original request if it cannot be parsed. */ }
    callback({});
  });
}

process.on("uncaughtException", (error) => {
  logMain("process.uncaught", { error: normalizeMessage(error instanceof Error ? error.message : String(error)) });
  recordTelemetryFailure({ type: "main.uncaught", error });
});
process.on("unhandledRejection", (reason) => {
  logMain("process.unhandled-rejection", { error: normalizeMessage(reason instanceof Error ? reason.message : String(reason)) });
  recordTelemetryFailure({ type: "unhandled.rejection", error: reason });
});

async function ensureMacDockVisible(): Promise<void> {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy("regular");
  await app.dock?.show();
}

function windowChromeOptions(overlayColor = "#FFFFFF"): Electron.BrowserWindowConstructorOptions {
  if (process.platform === "darwin") {
    return { titleBarStyle: "hidden", trafficLightPosition: { x: 16, y: 21 } };
  }
  // Windows and Linux share the Window Controls Overlay. A native frame on
  // Linux would stack the system title bar on top of the in-app draggable topbar.
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: overlayColor, symbolColor: "#55637A", height: 57 },
    autoHideMenuBar: true
  };
}

function configureWindowChrome(window: BrowserWindow): void {
  if (process.platform !== "win32") return;
  // Keep the application menu alive for its fallback shortcuts while hiding its UI.
  window.setAutoHideMenuBar(true);
  window.setMenuBarVisibility(false);
}

function isOpenSettingsShortcut(input: Electron.Input): boolean {
  const primaryModifier = process.platform === "darwin" ? input.meta : input.control;
  return input.type === "keyDown" && primaryModifier && !input.alt && input.code === "Comma";
}

function installWindowShortcuts(window: BrowserWindow): void {
  window.webContents.on("before-input-event", (event, input) => {
    if (!isOpenSettingsShortcut(input)) return;
    event.preventDefault();
    openSettings();
  });
}

function rendererPath(): string { return path.join(__dirname, "../renderer/index.html"); }

function sendToAppWindows(channel: string, payload: unknown): void {
  for (const target of [windowRef, settingsWindow, wakeWindow, voiceWakeWindow]) {
    if (!target || target.isDestroyed() || target.webContents.isDestroyed()) continue;
    try {
      target.webContents.send(channel, payload);
    } catch {
      // A renderer may close between the destroyed check and send().
    }
  }
}

function installWindowDiagnostics(target: BrowserWindow, kind: string): void {
  target.webContents.on("render-process-gone", (_event, details) => {
    recordTelemetryFailure({ type: "renderer.crashed", error: new Error(details.reason || "renderer process gone"), context: { window: kind, exitCode: details.exitCode } });
  });
  target.webContents.on("unresponsive", () => {
    recordTelemetryFailure({ type: "renderer.unresponsive", context: { window: kind } });
  });
}

function closeWakeWindow(): void {
  wakeAbortController?.abort();
  wakeAbortController = undefined;
  stopSpeech();
  if (wakeWindow && !wakeWindow.isDestroyed()) wakeWindow.close();
  wakeWindow = undefined;
  resumeVoiceWake();
}

function closeVoiceWakeWindow(): void {
  stopVoiceWake();
  if (voiceWakeWindow && !voiceWakeWindow.isDestroyed()) voiceWakeWindow.close();
  voiceWakeWindow = undefined;
}

function resumeVoiceWake(): void {
  const settings = readSettings(DEFAULT_WORKSPACE);
  if (!settings.wake.voiceEnabled || !voiceWakeWindow || voiceWakeWindow.isDestroyed()) return;
  voiceWakeWindow.webContents.send("voice-wake:resume");
}

async function startConfiguredVoiceWake(): Promise<void> {
  const settings = readSettings(DEFAULT_WORKSPACE);
  if (!settings.wake.voiceEnabled) { closeVoiceWakeWindow(); return; }
  if (voiceWakeWindow && !voiceWakeWindow.isDestroyed()) return;
  const phrase = settings.wake.voicePhrase || "小泽同学";
  voiceWakeWindow = new BrowserWindow({
    width: 1, height: 1, show: false, frame: false, skipTaskbar: true,
    // This window owns the continuous microphone graph. It must keep processing
    // audio while the visible wake overlay is open in front of it.
    webPreferences: { preload: path.join(__dirname, "../preload/preload.cjs"), contextIsolation: true, nodeIntegration: false, autoplayPolicy: "no-user-gesture-required", backgroundThrottling: false }
  });
  installWindowDiagnostics(voiceWakeWindow, "voice-wake");
  voiceWakeWindow.on("closed", () => { stopVoiceWake(); voiceWakeWindow = undefined; });
  const query = new URLSearchParams({ "voice-wake": "1", phrase }).toString();
  if (process.env.ELECTRON_RENDERER_URL) await voiceWakeWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${query}`);
  else await voiceWakeWindow.loadFile(rendererPath(), { query: { "voice-wake": "1", phrase } });
}

async function openWakeWindow(): Promise<void> {
  if (wakeWindow && !wakeWindow.isDestroyed()) {
    closeWakeWindow();
    return;
  }
  await ensureMacDockVisible();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  // Every wake invocation gets an isolated, unlisted session. It remains
  // available to the overlay while never entering the main session index.
  const wakeSettings = readSettings(DEFAULT_WORKSPACE);
  const sessionId = store().create("随时唤醒", { listed: false }).meta.id;
  const wakeModelId = wakeSettings.wake.modelId || activeWakeContext.modelId;
  const query = new URLSearchParams({
    wake: "1",
    sessionId,
    ...(wakeModelId ? { modelId: wakeModelId } : {}),
    ...(activeWakeContext.reasoningEffort ? { reasoningEffort: activeWakeContext.reasoningEffort } : {})
  }).toString();
  wakeWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "../preload/preload.cjs"), contextIsolation: true, nodeIntegration: false, autoplayPolicy: "no-user-gesture-required" }
  });
  installWindowDiagnostics(wakeWindow, "wake");
  if (process.platform === "darwin") {
    // Keep the overlay in the current macOS Space, including a separate
    // full-screen app Space. Without visibleOnFullScreen, focusing this
    // window makes macOS switch back to SecAgent's normal window Space.
    // The floating level is still below another app's full-screen window, so
    // use the screen-saver level for this transient overlay.
    wakeWindow.setAlwaysOnTop(true, "screen-saver", 1);
    wakeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    wakeWindow.setAlwaysOnTop(true, "floating");
  }
  // The overlay should not block the application below. Mouse-move events are
  // still forwarded to the renderer so it can temporarily enable interaction
  // when the pointer is over the visible response card.
  wakeWindow.setIgnoreMouseEvents(true, { forward: true });
  wakeWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") closeWakeWindow();
  });
  const showWakeWindow = () => {
    if (!wakeWindow || wakeWindow.isDestroyed()) return;
    // Do not activate the Electron app here. On macOS, activating an app from
    // a different full-screen Space switches to that app's normal Space even
    // when the window is visible on all workspaces.
    wakeWindow.showInactive();
  };
  wakeWindow.once("ready-to-show", showWakeWindow);
  wakeWindow.on("closed", () => {
    wakeAbortController?.abort();
    wakeAbortController = undefined;
    stopSpeech();
    wakeWindow = undefined;
  });
  if (process.env.ELECTRON_RENDERER_URL) await wakeWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${query}`);
  else await wakeWindow.loadFile(rendererPath(), { query: { wake: "1", sessionId, ...(wakeModelId ? { modelId: wakeModelId } : {}), ...(activeWakeContext.reasoningEffort ? { reasoningEffort: activeWakeContext.reasoningEffort } : {}) } });
  // Transparent windows do not consistently emit ready-to-show on every
  // platform, so make the post-load path an additional safe fallback.
  showWakeWindow();
}

function registerWakeShortcut(shortcut: string): void {
  const normalized = normalizeWakeHotkey(shortcut);
  if (activeWakeShortcut === normalized) return;
  if (!globalShortcut.register(normalized, () => { void openWakeWindow().catch((error) => logMain("wake.open.failed", { error: String(error) })); })) throw new Error(`快捷键 ${normalized} 已被其它应用占用`);
  if (activeWakeShortcut) globalShortcut.unregister(activeWakeShortcut);
  activeWakeShortcut = normalized;
}

function createWindow(visible = true): void {
  windowRef = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    title: "SecAgent",
    show: visible,
    skipTaskbar: false,
    backgroundColor: "#FFFFFF",
    ...windowChromeOptions(),
    icon: appIconPath(),
    webPreferences: { preload: path.join(__dirname, "../preload/preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  configureWindowChrome(windowRef);
  installWindowDiagnostics(windowRef, "main");
  installWindowShortcuts(windowRef);
  windowRef.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    windowRef?.hide();
    notifyHiddenMainWindow();
  });
  windowRef.on("closed", () => {
    windowRef = undefined;
  });
  logMain("window.created");
  if (process.env.ELECTRON_RENDERER_URL) windowRef.loadURL(process.env.ELECTRON_RENDERER_URL);
  else windowRef.loadFile(path.join(__dirname, "../renderer/index.html"));
}

async function openPluginSvgPreview(request: SvgPreviewRequest): Promise<boolean> {
  const previewWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    title: request.title,
    backgroundColor: "#fffdf6",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  previewWindow.on("page-title-updated", (event) => event.preventDefault());
  previewWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try {
    await previewWindow.loadFile(request.filePath);
    const isSvgDocument = await previewWindow.webContents.executeJavaScript("document.documentElement?.namespaceURI === 'http://www.w3.org/2000/svg'", true);
    if (!isSvgDocument) throw new Error("SVG XML 解析失败，预览窗口未加载 SVG 文档");
    previewWindow.setTitle(request.title);
    if (!previewWindow.isDestroyed()) previewWindow.show();
    return true;
  } catch (error) {
    logMain("plugin.preview.failed", { path: request.filePath, error: error instanceof Error ? error.message : String(error) });
    if (!previewWindow.isDestroyed()) previewWindow.close();
    return false;
  }
}

function openSettings(oobeOrMenuItem: boolean | Electron.MenuItem = false, _window?: Electron.BaseWindow, _event?: Electron.KeyboardEvent): void {
  const oobe = typeof oobeOrMenuItem === "boolean" ? oobeOrMenuItem : false;
  if (oobe) onboardingCompletionRequested = false;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: "SecAgent设置",
    skipTaskbar: false,
    parent: windowRef && !windowRef.isDestroyed() && windowRef.isVisible() ? windowRef : undefined,
    modal: false,
    backgroundColor: "#FFFFFF",
    ...windowChromeOptions(),
    icon: appIconPath(),
    webPreferences: { preload: path.join(__dirname, "../preload/preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  configureWindowChrome(settingsWindow);
  installWindowDiagnostics(settingsWindow, "settings");
  settingsWindow.on("page-title-updated", (event) => { event.preventDefault(); });
  settingsWindow.setTitle("SecAgent设置");
  const query = oobe ? "?settings=1&oobe=1" : "?settings=1";
  if (process.env.ELECTRON_RENDERER_URL) settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`);
  else settingsWindow.loadFile(path.join(__dirname, "../renderer/index.html"), { query: oobe ? { settings: "1", oobe: "1" } : { settings: "1" } });
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
    if (oobe) {
      if (!onboardingCompletionRequested) app.quit();
      return;
    }
    if (windowRef && !windowRef.isDestroyed() && !windowRef.isVisible()) windowRef.show();
  });
}

function showMainWindow(): void {
  if (!windowRef || windowRef.isDestroyed()) {
    createWindow();
  }
  if (!windowRef || windowRef.isDestroyed()) return;
  if (windowRef.isMinimized()) windowRef.restore();
  windowRef.show();
  windowRef.focus();
  void ensureMacDockVisible();
}

let linuxHiddenNoticeShown = false;
/** GNOME ships no legacy system tray, so a window hidden on close would have no tray icon to restore it. */
function notifyHiddenMainWindow(): void {
  if (process.platform !== "linux" || linuxHiddenNoticeShown || !Notification.isSupported()) return;
  linuxHiddenNoticeShown = true;
  try {
    const hotkey = activeWakeShortcut || DEFAULT_WAKE_HOTKEY;
    const notice = new Notification({ title: "SecAgent 已在后台运行", body: `点击此通知重新打开主窗口，或按 ${hotkey} 唤起。` });
    notice.on("click", () => showMainWindow());
    notice.show();
  } catch (error) {
    logMain("main-window.hidden-notify.failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

function restartApplication(): void {
  isQuitting = true;
  app.relaunch();
  app.exit(0);
}

function createTray(): void {
  if (tray && !tray.isDestroyed()) return;
  tray = new Tray(appIconPath());
  tray.setToolTip("SecAgent");
  const trayMenu = Menu.buildFromTemplate([
    { label: "打开主窗口", click: showMainWindow },
    { label: "打开设置", click: () => openSettings() },
    { type: "separator" },
    { label: "重启应用", click: restartApplication },
    { label: "退出应用", click: () => { isQuitting = true; app.quit(); } }
  ]);
  const showTrayMenu = () => tray?.popUpContextMenu(trayMenu);
  // Explicitly handle both buttons. On Windows this also covers the usual
  // touch interaction, which is delivered as a tray click event.
  tray.on("click", showTrayMenu);
  tray.on("right-click", showTrayMenu);
}

function createApplicationMenu(): void {
  const developerToolsAccelerator = process.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { label: "文件", submenu: [{ label: "设置…", accelerator: "CmdOrCtrl+,", click: openSettings }, { type: "separator" }, { role: "quit" }] },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }] },
    { label: "开发", submenu: [{ label: "切换开发者工具", role: "toggleDevTools", accelerator: developerToolsAccelerator }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
ipcMain.handle("workspace:preview-file", (_event, relativePath: string) => openWorkspaceFilePreview(relativePath));

ipcMain.handle("oobe:progress:get", () => readOobeProgress(DEFAULT_WORKSPACE));
ipcMain.handle("oobe:progress:save", (_event, progress: OobeProgress) => {
  saveOobeProgress(DEFAULT_WORKSPACE, progress);
  return readOobeProgress(DEFAULT_WORKSPACE);
});
ipcMain.handle("oobe:complete", (event) => {
  onboardingCompletionRequested = true;
  markOnboardingComplete(DEFAULT_WORKSPACE);
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed() && senderWindow === settingsWindow) senderWindow.close();
  if (windowRef && !windowRef.isDestroyed()) { windowRef.show(); windowRef.focus(); }
  return { ok: true };
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
  const previousWakeHotkey = activeWakeShortcut;
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
    activeWakeShortcut = nextWakeHotkey;
  }
  setSentryTelemetryEnabled(saved.telemetry.enabled);
  initializeSentry();
  getTelemetry()?.setEnabled(saved.telemetry.enabled);
  // Apply the new speech-recognition preference (provider chain) immediately.
  configureSpeech(saved.speech);
  configureTts(saved.tts);
  sendToAppWindows("settings:changed", saved);
  updateManager?.setPreferences(saved.updates);
  closeVoiceWakeWindow();
  if (saved.wake.voiceEnabled) void startConfiguredVoiceWake().catch((error) => {
    logMain("voice-wake.start.failed", { error: String(error) });
    recordTelemetryFailure({ type: "speech.failed", error, context: { phase: "voice-wake-start" } });
  });
  return saved;
});
ipcMain.on("wake:context", (_event, payload: unknown) => {
  if (!payload || typeof payload !== "object") return;
  const candidate = payload as Record<string, unknown>;
  activeWakeContext = {
    ...(typeof candidate.sessionId === "string" ? { sessionId: candidate.sessionId } : {}),
    ...(typeof candidate.modelId === "string" ? { modelId: candidate.modelId } : {}),
    ...(typeof candidate.reasoningEffort === "string" ? { reasoningEffort: candidate.reasoningEffort as ReasoningEffort } : {})
  };
});
ipcMain.handle("wake:close", () => { closeWakeWindow(); return { ok: true }; });
ipcMain.on("wake:interactive", (_event, interactive: boolean) => { if (wakeWindow && !wakeWindow.isDestroyed()) wakeWindow.setIgnoreMouseEvents(!interactive); });
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
  const isWakeRequest = Boolean(wakeWindow && wakeWindow.webContents.id === _event.sender.id);
  const shouldGenerateTitle = !before.messages.some((message) => message.role === "user");
  const preRule = await pluginManager?.matchPreRule(text);
  const titlePromise = shouldGenerateTitle && !preRule
    ? generateSessionTitle(config, text, attachments, abortController.signal).catch((error) => {
      logMain("session.title.failed", { sessionId: id, error: error instanceof Error ? error.message : String(error) });
      return "";
    })
    : Promise.resolve("");
  if (isWakeRequest) wakeAbortController = abortController;
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
    const skills = [...loadEnabledSkills(config), ...(pluginManager?.getSkills() || [])];
    const runtimeConfig = isWakeRequest
      ? { ...config, agent: { ...config.agent, systemPrompt: `${config.agent.systemPrompt}\n\n## 快速唤起输出协议\n${QUICK_WAKE_OUTPUT_PROMPT}` } }
      : config;
    runtime = new SecAgentRuntime(runtimeConfig, audit, skills, trace, pluginManager, { confirmToolCall: (confirmation) => confirmSensitiveToolCall(id, confirmation) });
    const visionConfig = resolveVisionAgentConfig(config);
    if (visionConfig) logMain("session.vision-model", { model: visionConfig.agent.model, provider: visionConfig.agent.provider, baseUrl: visionConfig.agent.baseUrl });
    const previousReadSkillNames = before.messages.flatMap((message) => message.toolCalls || []).filter((call) => call.name === "secagent__read_skill" || call.name === "read_skill").map((call) => typeof (call.arguments as { name?: unknown })?.name === "string" ? (call.arguments as { name: string }).name : "");
    const result = await runtime.run(historyInput(before, text), selectedReasoningEffort, conversationInput(before, text, attachments), abortController.signal, { previousAutoLoadedSkills: before.autoLoadedSkills, previousReadSkillNames, preRule });
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
    if (wakeAbortController === abortController) wakeAbortController = undefined;
    await runtime?.close().catch(() => undefined);
    audit.close();
  }
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
  registerCompanionIpc(() => settingsWindow || windowRef);
  registerPluginIpc({ getPluginManager: () => pluginManager, getMarketplace: () => marketplace, getWindow: () => settingsWindow || windowRef });
  registerOfficialIpc();
  registerSettingsIpc({ getUpdateManager: () => updateManager, openSettings });
  registerSpeechIpc({ getWakeWindow: () => wakeWindow, getVoiceWakeWindow: () => voiceWakeWindow, openWakeWindow });
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
  }, openPluginSvgPreview);
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
    windowRef?.webContents.send("plugins:changed", list);
    settingsWindow?.webContents.send("plugins:changed", list);
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
app.on("before-quit", () => { updateManager?.handleBeforeQuit(); isQuitting = true; closeWakeWindow(); closeVoiceWakeWindow(); globalShortcut.unregisterAll(); if (marketplaceUpdateTimer) clearInterval(marketplaceUpdateTimer); if (updateCheckTimer) clearInterval(updateCheckTimer); void secAgentHttpServer?.stop(); void pluginManager?.shutdown(); getTelemetry()?.stop(); });
app.on("window-all-closed", () => { /* Keep the process alive so the tray can reopen the main window. */ });
