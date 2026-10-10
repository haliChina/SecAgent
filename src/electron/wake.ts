/**
 * 唤醒域（B2-d2 自 main.ts 拆出，纯搬家）。
 *
 * 唤醒浮窗（全屏透明 overlay + 独立未列入会话）与语音唤醒隐藏窗。
 * 状态内聚：wakeWindow/voiceWakeWindow/activeWakeShortcut/
 * activeWakeContext/wakeAbortController。sessions 域经访问器读写
 * （isWakeSender/setWakeAbortController），notifyHiddenMainWindow
 * 的热键镜像由 registerWakeShortcut 同步。
 */
import path from "node:path";
import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { readSettings } from "../config.js";
import { DEFAULT_WORKSPACE } from "../paths.js";
import { SessionStore } from "../session-store.js";
import { DEFAULT_WAKE_HOTKEY, normalizeWakeHotkey } from "../wake-hotkey.js";
import { stopSpeech, stopVoiceWake } from "./speech.js";
import { ensureMacDockVisible, installWindowDiagnostics, rendererPath, setNotifyWakeHotkey } from "./windows.js";
import { logMain } from "./main-log.js";
import type { ReasoningEffort } from "../types.js";

let wakeWindow: BrowserWindow | undefined;
let voiceWakeWindow: BrowserWindow | undefined;
let activeWakeShortcut: string | undefined;
let activeWakeContext: { sessionId?: string; modelId?: string; reasoningEffort?: ReasoningEffort } = {};
let wakeAbortController: AbortController | undefined;

export function getWakeWindow(): BrowserWindow | undefined { return wakeWindow; }
export function getVoiceWakeWindow(): BrowserWindow | undefined { return voiceWakeWindow; }
export function getActiveWakeShortcut(): string | undefined { return activeWakeShortcut; }
export function setActiveWakeShortcut(value: string | undefined): void { activeWakeShortcut = value; }
export function isWakeSender(webContentsId: number): boolean { return Boolean(wakeWindow && !wakeWindow.isDestroyed() && wakeWindow.webContents.id === webContentsId); }
export function setWakeAbortController(controller: AbortController): void { wakeAbortController = controller; }
export function clearWakeAbortController(controller: AbortController): void { if (wakeAbortController === controller) wakeAbortController = undefined; }

function store(): SessionStore { return new SessionStore(DEFAULT_WORKSPACE); }

export function closeWakeWindow(): void {
  wakeAbortController?.abort();
  wakeAbortController = undefined;
  stopSpeech();
  if (wakeWindow && !wakeWindow.isDestroyed()) wakeWindow.close();
  wakeWindow = undefined;
  resumeVoiceWake();
}

export function closeVoiceWakeWindow(): void {
  stopVoiceWake();
  if (voiceWakeWindow && !voiceWakeWindow.isDestroyed()) voiceWakeWindow.close();
  voiceWakeWindow = undefined;
}

export function resumeVoiceWake(): void {
  const settings = readSettings(DEFAULT_WORKSPACE);
  if (!settings.wake.voiceEnabled || !voiceWakeWindow || voiceWakeWindow.isDestroyed()) return;
  voiceWakeWindow.webContents.send("voice-wake:resume");
}

export async function startConfiguredVoiceWake(): Promise<void> {
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

export async function openWakeWindow(): Promise<void> {
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

export function registerWakeShortcut(shortcut: string): void {
  const normalized = normalizeWakeHotkey(shortcut);
  if (activeWakeShortcut === normalized) return;
  if (!globalShortcut.register(normalized, () => { void openWakeWindow().catch((error) => logMain("wake.open.failed", { error: String(error) })); })) throw new Error(`快捷键 ${normalized} 已被其它应用占用`);
  if (activeWakeShortcut) globalShortcut.unregister(activeWakeShortcut);
  activeWakeShortcut = normalized;
  setNotifyWakeHotkey(normalized);
}
export function registerWakeIpc(): void {
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
}
