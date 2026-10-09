/**
 * 窗口/托盘/菜单/overlay 域（B2-d 自 main.ts 拆出，纯搬家）。
 *
 * 主窗/设置窗/托盘/应用菜单 + 插件 SVG 预览与 overlay 浮窗。
 * 窗口状态内聚（windowRef/settingsWindow/tray），经访问器暴露；
 * wake 窗口仍归 main.ts（与 sessions 域同批拆）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, Menu, Notification, Tray, session, screen, ipcMain, type BrowserWindowConstructorOptions } from "electron";
import { DEFAULT_WORKSPACE } from "../paths.js";
import type { PluginManager, SvgPreviewRequest, OverlayRequest, PluginOverlayHandle } from "../plugin-manager.js";
import { logMain } from "./main-log.js";
import { recordTelemetryFailure } from "./main-telemetry.js";
import { normalizeMessage } from "../telemetry.js";
import { DEFAULT_WAKE_HOTKEY } from "../wake-hotkey.js";

let windowRef: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let onboardingCompletionRequested = false;

export function getMainWindow(): BrowserWindow | undefined { return windowRef; }
export function getSettingsWindow(): BrowserWindow | undefined { return settingsWindow; }
export function getIsQuitting(): boolean { return isQuitting; }
export function setOnboardingCompletionRequested(value: boolean): void { onboardingCompletionRequested = value; }
export function setIsQuitting(): void { isQuitting = true; }
let notifyWakeHotkey: string | undefined;
export function setNotifyWakeHotkey(value: string): void { notifyWakeHotkey = value; }

export function appIconPath(): string {
  const bundledIcon = path.join(__dirname, "../renderer/icon.png");
  return fs.existsSync(bundledIcon) ? bundledIcon : path.join(process.cwd(), "src/renderer/public/icon.png");
}

export function installFileRendererAssetFallback(): void {
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

export async function ensureMacDockVisible(): Promise<void> {
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

export function rendererPath(): string { return path.join(__dirname, "../renderer/index.html"); }

export function installWindowDiagnostics(target: BrowserWindow, kind: string): void {
  target.webContents.on("render-process-gone", (_event, details) => {
    recordTelemetryFailure({ type: "renderer.crashed", error: new Error(details.reason || "renderer process gone"), context: { window: kind, exitCode: details.exitCode } });
  });
  target.webContents.on("unresponsive", () => {
    recordTelemetryFailure({ type: "renderer.unresponsive", context: { window: kind } });
  });
}


export function createWindow(visible = true): void {
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

export async function openPluginSvgPreview(request: SvgPreviewRequest): Promise<boolean> {
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


function isOverlayAllowedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "http:" && (host === "127.0.0.1" || host === "localhost" || host === "::1");
  } catch {
    return false;
  }
}

let overlayIpcRegistered = false;
/** overlay 桥接通道：只作用于发送者自己的窗口，防止跨窗口操作。 */
export function registerOverlayIpcOnce(): void {
  if (overlayIpcRegistered) return;
  overlayIpcRegistered = true;
  ipcMain.on("overlay:ignore-mouse", (event, ignore: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.on("overlay:move", (event, dx: unknown, dy: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const bounds = win.getBounds();
      win.setBounds({ x: bounds.x + (Number(dx) || 0), y: bounds.y + (Number(dy) || 0) });
    }
  });
}

/**
 * 插件 overlay 浮窗：透明、置顶、点击穿透的隔离窗口。
 * 安全模式对齐 openSvgPreview：无 Node 集成、沙盒渲染进程、
 * 禁止弹窗与标题伪装、只允许加载插件本地 loopback 服务。
 */
export async function openPluginOverlay(request: OverlayRequest): Promise<PluginOverlayHandle> {
  if (!isOverlayAllowedUrl(request.url)) throw new Error("overlay 只允许加载插件本地服务（http://127.0.0.1/*）");
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: request.width,
    height: request.height,
    x: Math.round(workArea.x + workArea.width - request.width - 24),
    y: Math.round(workArea.y + workArea.height - request.height - 24),
    transparent: request.transparent,
    frame: false,
    alwaysOnTop: request.alwaysOnTop,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/overlay-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.on("page-title-updated", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!isOverlayAllowedUrl(url)) event.preventDefault();
  });
  registerOverlayIpcOnce();
  if (request.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
  try {
    await win.loadURL(request.url);
  } catch (error) {
    if (!win.isDestroyed()) win.close();
    throw error;
  }
  logMain("plugin.overlay.opened", { pluginId: request.pluginId });
  const alive = () => !win.isDestroyed();
  return {
    show: async () => { if (alive() && !win.isVisible()) win.show(); },
    hide: async () => { if (alive() && win.isVisible()) win.hide(); },
    close: async () => { if (alive()) win.close(); },
    setBounds: async (bounds) => {
      if (!alive()) return;
      const current = win.getBounds();
      win.setBounds({
        x: bounds.x ?? current.x,
        y: bounds.y ?? current.y,
        width: bounds.width ?? current.width,
        height: bounds.height ?? current.height
      });
    }
  };
}

export function openSettings(oobeOrMenuItem: boolean | Electron.MenuItem = false, _window?: Electron.BaseWindow, _event?: Electron.KeyboardEvent): void {
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

export function showMainWindow(): void {
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
    const hotkey = notifyWakeHotkey || DEFAULT_WAKE_HOTKEY;
    const notice = new Notification({ title: "SecAgent 已在后台运行", body: `点击此通知重新打开主窗口，或按 ${hotkey} 唤起。` });
    notice.on("click", () => showMainWindow());
    notice.show();
  } catch (error) {
    logMain("main-window.hidden-notify.failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

export function restartApplication(): void {
  isQuitting = true;
  app.relaunch();
  app.exit(0);
}

export function createTray(): void {
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

export function createApplicationMenu(): void {
  const developerToolsAccelerator = process.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { label: "文件", submenu: [{ label: "设置…", accelerator: "CmdOrCtrl+,", click: openSettings }, { type: "separator" }, { role: "quit" }] },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }] },
    { label: "开发", submenu: [{ label: "切换开发者工具", role: "toggleDevTools", accelerator: developerToolsAccelerator }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
