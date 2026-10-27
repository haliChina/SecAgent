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
import { app, BrowserWindow, Menu, nativeTheme, Notification, Tray, session, screen, shell, ipcMain, type BrowserWindowConstructorOptions } from "electron";
import { DEFAULT_WORKSPACE } from "../paths.js";
import type { PluginManager, SvgPreviewRequest, OverlayRequest, PluginOverlayHandle, FlashMarkerKind, FlashHandler, AgentActivityHandler } from "../plugin-manager.js";
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

/** R59：应用窗口内的链接一律不得替换应用界面（点击后 UI 被网页顶掉且
 *  无法退出、只能重启）。所有导航与新窗口请求全部拦截，http/https/mailto
 *  转交系统默认浏览器打开。主窗/设置窗/唤醒浮窗统一安装。 */
export function installExternalLinkGuard(win: BrowserWindow): void {
  const toExternal = (url: string): boolean => /^https?:|^mailto:/i.test(url);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (toExternal(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (toExternal(url)) void shell.openExternal(url).catch(() => undefined);
  });
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

function windowChromeOptions(overlayColor = "#F1F4F9"): Electron.BrowserWindowConstructorOptions {
  if (process.platform === "darwin") {
    return { titleBarStyle: "hidden", trafficLightPosition: { x: 16, y: 21 } };
  }
  // Windows and Linux share the Window Controls Overlay. A native frame on
  // Linux would stack the system title bar on top of the in-app draggable topbar.
  // R57：overlay 底色默认取 topbar 浅色实色（不再是刺眼的白色）；
  // 渲染端换肤后经 window:chrome-sync 动态改写（暗色主题同步为 --bg-1 暗色）。
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: overlayColor, symbolColor: "#475569", height: 57 },
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
  installExternalLinkGuard(windowRef);
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
  /* R59 外链守卫：SVG 内 <a> 点击走 will-navigate，不拦会在窗内导航外站。 */
  installExternalLinkGuard(previewWindow);
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
/* —— overlay 位置类 IPC 的 Wayland 能力门（上游 #12，Codex review PR#7/#8）——
   原生 Wayland（ozone/wayland，无 DISPLAY）下窗口位置由合成器管理，
   setPosition/setBounds 的位置分量无效——甩出物理循环会空转。X11/
   Xwayland（DISPLAY 存在，Electron Linux 默认后端）不受影响。
   检测到原生 Wayland 时跳过位置写入，警告只打一次。 */
let warnedWaylandOverlay = false;
function overlayPositionSupported(): boolean {
  if (process.platform !== "linux") return true;
  if (process.env.DISPLAY) return true;
  const nativeWayland = process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY;
  if (nativeWayland && !warnedWaylandOverlay) {
    warnedWaylandOverlay = true;
    logMain("plugin.overlay.wayland-position-unsupported", { hint: "原生 Wayland 会话：overlay 位置类 IPC 跳过（窗口位置由合成器管理）" });
  }
  return !nativeWayland;
}

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
    if (win && !win.isDestroyed() && overlayPositionSupported()) {
      const bounds = win.getBounds();
      win.setBounds({ x: bounds.x + (Number(dx) || 0), y: bounds.y + (Number(dy) || 0) });
    }
  });
  // 绝对定位协议（桌宠 0.4.2+，上游 #6）：渲染端传「抓取点在窗口内的偏移」（拖拽期间
  // 恒定），主进程用自己读到的光标坐标反推窗口原点。旧 move 协议要跨进程传递增量并
  // 在两个坐标系之间换算——DPI 缩放/宿主版本差异下会错位（往左上拖反而往左下漂移）。
  // 此协议每次都从主进程的绝对坐标重算，无累积、自纠错。
  ipcMain.on("overlay:move-to", (event, offsetX: unknown, offsetY: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !overlayPositionSupported()) return;
    const cursor = screen.getCursorScreenPoint();
    win.setBounds({
      x: Math.round(cursor.x - (Number(offsetX) || 0)),
      y: Math.round(cursor.y - (Number(offsetY) || 0))
    });
  });
  /* 桌宠 0.5.0 甩出物理（27f7f33 直译移植）：松手后渲染端在屏幕坐标系
     积分窗口轨迹，需要绝对落位接口。渲染进程 screenX 与主进程
     setPosition 均为 DIP，坐标系一致；只作用于发送者自己的窗口。 */
  /* 混合 DPI 多显示器下渲染端与主进程坐标空间可能错位，渲染端积分值若被
     错误映射会把窗口甩出屏幕——钳位到「最近显示器工作区至少可见 64px」，
     窗口永不彻底离屏（上游 #11；插件侧另有每帧自愈，双保险）。 */
  ipcMain.on("overlay:set-position", (event, x: unknown, y: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || !overlayPositionSupported()) return;
    const wantX = Math.round(Number(x)) || 0;
    const wantY = Math.round(Number(y)) || 0;
    const [w, h] = win.getSize();
    const wa = screen.getDisplayNearestPoint({ x: wantX + w / 2, y: wantY + h / 2 }).workArea;
    const MARGIN = 64;
    const cx = Math.max(wa.x - w + MARGIN, Math.min(wa.x + wa.width - MARGIN, wantX));
    const cy = Math.max(wa.y - h + MARGIN, Math.min(wa.y + wa.height - MARGIN, wantY));
    win.setPosition(cx, cy);
  });
}

/**
 * 插件操作落点发光标记（computer-use 0.7.3+，api.flashMarker）：
 * 透明无边框置顶小窗 + CSS 发光动画，420ms 后自毁。
 * （上游 #13，从巨石 main.ts 移植进模块化结构。）
 *
 * 为什么用 BrowserWindow 而不是插件侧 GDI/分层窗口：视觉反馈属于宿主
 * UI 职责——Electron 透明窗口必然进 DWM/合成器，跨平台（Windows/macOS/
 * Linux）且动画质感（光晕/渐隐/缩放）远超手写像素；插件（in-process）的
 * koffi 原生窗口路径仅作老宿主兜底。
 *
 * 坐标约定：插件传**物理像素**（多显示器绝对坐标，与截图/点击同一空间）；
 * 按「坐标所在显示器」的 scaleFactor 换算 DIP 后创建窗口。
 * fire-and-forget：吞掉一切错误，绝不影响插件动作。
 */
export const showPluginFlash: FlashHandler = (x, y, opts) => {
  try {
    if (!app.isReady()) return;
    const kind: FlashMarkerKind = (["click", "type", "focus", "scroll", "chord"] as FlashMarkerKind[]).includes(opts?.kind as FlashMarkerKind) ? (opts?.kind as FlashMarkerKind) : "click";
    const radius = Math.max(4, Math.min(40, Number(opts?.radius) || (kind === "focus" ? 16 : 12)));
    const ms = Math.max(300, Math.min(2000, Number(opts?.ms) || (kind === "chord" ? 1100 : kind === "type" ? 650 : kind === "scroll" ? 420 : 520)));

    // 物理像素 → DIP（按落点所在显示器的缩放比；近似即可，微小偏差不影响观感）
    const disp = screen.getDisplayNearestPoint({ x, y });
    const sf = disp.scaleFactor || 1;
    const dipX = x / sf, dipY = y / sf;

    // —— 按 kind 定制内容（只用安全 CSS：transform/opacity/box-shadow/text-shadow；
    //    透明 BrowserWindow 上禁用 filter/backdrop-filter/mask——桌宠 0.5.5 实机雷区）——
    let size: number;
    let body: string;
    if (kind === "type") {
      // 输入胶囊：蓝色圆角条 + 闪烁 caret（挂在光标正上方）
      size = 64;
      body =
        `<div class="cap"><span class="bar"></span><span class="caret">▏</span></div>` +
        `<style>` +
        `.cap{position:absolute;left:50%;top:38px;transform:translateX(-50%);display:flex;align-items:center;gap:2px;` +
        `padding:5px 12px 5px 9px;border-radius:9px;background:rgba(63,140,255,.18);` +
        `border:1px solid rgba(63,140,255,.6);box-shadow:0 3px 16px rgba(63,140,255,.3);` +
        `animation:fade ${ms}ms cubic-bezier(.2,.7,.3,1) forwards}` +
        `.bar{display:inline-block;width:14px;height:3px;border-radius:2px;background:#7db3ff}` +
        `.caret{color:#dbe9ff;font:600 13px/1 system-ui;animation:blink 560ms steps(1) infinite}` +
        `@keyframes blink{50%{opacity:0}}` +
        `@keyframes fade{to{opacity:0}}` +
        `</style>`;
    } else if (kind === "chord") {
      // 组合键键帽浮标：label 形如 "Ctrl+C"，渐隐上浮。
      // 0.2 轮修复：旧固定 72px 窗宽装不下键帽序列（实测 Ctrl+S ≈99px）——
      // 右侧键帽被裁成只见 "Ctrl"，用户实测「键帽浮标没有」的直接原因。
      const label = String(opts?.label ?? "").slice(0, 12) || "组合键";
      const keys = label.split("+").map((k) => k.trim()).filter(Boolean);
      size = Math.max(64, 28 + keys.reduce((w, k) => w + k.length * 8 + 24, 0) + Math.max(0, keys.length - 1) * 19);
      const keyTags = keys.length > 1
        ? keys.map((k) => `<span class="kbd">${escapeHtml(k)}</span>`).join(`<span class="plus">+</span>`)
        : `<span class="kbd">${escapeHtml(label)}</span>`;
      body =
        `<div class="keys">${keyTags}</div>` +
        `<style>` +
        `.keys{position:absolute;left:50%;top:50%;display:flex;align-items:center;gap:5px;` +
        `transform:translate(-50%,-50%);animation:lift ${ms}ms cubic-bezier(.2,.7,.3,1) forwards}` +
        `.kbd{display:inline-flex;padding:4px 9px;border-radius:6px;background:rgba(255,255,255,.16);` +
        `border:1px solid rgba(255,255,255,.45);border-bottom-width:2.5px;` +
        `font:600 13px/1 system-ui,"Segoe UI",sans-serif;color:#fff;letter-spacing:.4px}` +
        `.plus{color:rgba(155,208,255,.9);font:600 13px system-ui}` +
        `@keyframes lift{0%{opacity:0;transform:translate(-50%,-30%)}14%{opacity:1}` +
        `to{opacity:0;transform:translate(-50%,-130%)}}` +
        `</style>`;
    } else if (kind === "scroll") {
      // 轻量滚动提示：方向箭头 + 微光（不整环，短促不打扰）。
      // 0.2 轮：箭头 22px 实测太小+260ms 一闪即逝——放大到 30px/420ms。
      size = 64;
      const up = Number(opts?.direction) >= 0;
      body =
        `<div class="arrow">${up ? "↑" : "↓"}</div>` +
        `<style>` +
        `.arrow{position:absolute;left:50%;top:50%;margin:-15px 0 0 -15px;width:30px;height:30px;` +
        `color:#cab6ff;font:700 26px/30px system-ui;text-shadow:0 0 12px 3px rgba(160,107,255,.8);` +
        `animation:up ${ms}ms ease-out forwards}` +
        `@keyframes up{from{opacity:.95;transform:translateY(4px)}to{opacity:0;transform:translateY(${up ? -18 : 18}px)}}` +
        `</style>`;
    } else {
      // click/focus：跑马灯光环（SVG 亮弧旋转——SVG 渲染无 CSS filter/mask 雷区）
      size = Math.round(radius * 2 + 52);
      const c = size / 2;
      const r = radius;
      const arc = Math.round(0.72 * 2 * Math.PI * r);
      const circumference = Math.round(2 * Math.PI * r);
      const color = kind === "focus" ? "#ffb02e" : "#ff5238";
      body =
        `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="wrap">` +
        `<circle cx="${c}" cy="${c}" r="${r + 4}" fill="none" stroke="${color}" stroke-opacity=".22" stroke-width="8"/>` +
        `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round" ` +
        `stroke-dasharray="${arc} ${circumference}" class="arc"/>` +
        `<circle cx="${c}" cy="${c}" r="2.6" fill="#ffffff" fill-opacity=".95"/>` +
        `</svg>` +
        `<style>` +
        `.wrap{animation:fade ${ms}ms cubic-bezier(.2,.7,.3,1) forwards}` +
        `.arc{animation:spin 780ms linear infinite;transform-origin:${c}px ${c}px}` +
        `@keyframes spin{to{transform:rotate(360deg)}}` +
        `@keyframes fade{to{opacity:0}}` +
        `</style>`;
    }

    const html =
      `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `html,body{margin:0;padding:0;background:transparent;overflow:hidden;` +
      `width:${size}px;height:${size}px}` +
      `</style></head><body>${body}</body></html>`;

    const win = new BrowserWindow({
      x: Math.round(dipX - size / 2),
      y: Math.round(dipY - (kind === "type" ? size : size / 2)),
      width: size,
      // chord 宽度自适应但高度固定（键帽 30px + 上浮余量）；其余正方
      height: kind === "chord" ? 64 : size,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: "#00000000",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.setIgnoreMouseEvents(true, { forward: false });
    win.setAlwaysOnTop(true, "screen-saver");
    const kill = () => { if (!win.isDestroyed()) win.destroy(); };
    // 兜底自毁：动画时长 + 渲染余量。**不要**在 ready-to-show 之前杀——见下。
    const timer = setTimeout(kill, ms + 450);
    if (typeof timer.unref === "function") timer.unref();
    win.once("closed", () => clearTimeout(timer));
    // 根治「发光从未可见」（实机反馈）：旧代码等 ready-to-show 再 show——
    // data URL + 透明窗组合下 ready-to-show 有永不触发的案例，而旧兜底
    // 400ms 内「不可见即销毁」，窗口从生到死都没被用户看到。透明窗的
    // 空白帧本身就是透明（无白闪），创建后直接显示。
    win.showInactive();
    // ready-to-show 仅作幂等保险（已显示时再触发无副作用）
    win.once("ready-to-show", () => { if (!win.isDestroyed() && !win.isVisible()) win.showInactive(); });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(kill);
  } catch { /* 视觉反馈失败无碍 */ }
};

/** 转义注入 HTML 的短文本（键帽 label 等）。 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));
}

/**
 * 「Agent 正在操作电脑」常驻徽标（对齐 ZCode 的使用中标识，2026-10-26）：
 * 插件动作会话期间于主屏右下角常驻显示；每次动作 touch 续期，空闲
 * 8 秒自动淡出，active=false 立即隐藏。单例窗口复用（高频 touch 不
 * 重建）。CSS 同样只用 transform/opacity/box-shadow 安全属性。
 */
const BADGE_IDLE_MS = 8000;
let badgeWin: BrowserWindow | null = null;
let badgeIdleTimer: ReturnType<typeof setTimeout> | null = null;

export const agentActivityBadge: AgentActivityHandler = ({ active, label }) => {
  try {
    if (!app.isReady()) return;
    if (!active) { fadeOutBadge(); return; }
    if (!badgeWin || badgeWin.isDestroyed()) createBadgeWindow(label);
    // touch 续期（label 变化时热更新文本，不重建窗口）
    else if (label) {
      badgeWin.webContents
        .executeJavaScript(`var el=document.getElementById("lbl"); if(el) el.textContent=${JSON.stringify(label)};`)
        .catch(() => { /* 文本更新失败无碍 */ });
    }
    if (badgeIdleTimer) clearTimeout(badgeIdleTimer);
    badgeIdleTimer = setTimeout(fadeOutBadge, BADGE_IDLE_MS);
    if (typeof badgeIdleTimer.unref === "function") badgeIdleTimer.unref();
  } catch { /* 徽标失败无碍 */ }
};

function createBadgeWindow(label?: string): void {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 252, H = 44;
  const labelText = label ? `·${escapeHtml(label)}` : "";
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;padding:0;background:transparent;overflow:hidden;width:${W}px;height:${H}px}` +
    `.badge{position:absolute;right:0;bottom:0;display:flex;align-items:center;gap:8px;` +
    `padding:0 16px;height:38px;border-radius:999px;background:rgba(18,20,26,.86);` +
    `border:1px solid rgba(255,255,255,.18);color:#fff;` +
    `box-shadow:0 6px 24px rgba(0,0,0,.38),0 0 0 1px rgba(255,138,61,.06);` +
    `font:500 12.5px/1 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;` +
    `opacity:0;animation:in .28s ease-out .05s forwards}` +
    `.dot{width:8px;height:8px;border-radius:50%;background:#ff8a3d;` +
    `box-shadow:0 0 8px 2px rgba(255,138,61,.66);animation:pulse 1.15s ease-in-out infinite}` +
    `.txt{white-space:nowrap}` +
    `.sub{color:rgba(255,164,102,.95);font-weight:600}` +
    `@keyframes in{to{opacity:1}}` +
    `@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}` +
    `</style></head><body><div class="badge">` +
    `<span class="dot"></span><span class="txt">SecAgent 正在操作电脑</span>` +
    (labelText ? `<span class="sub">${labelText}</span>` : ``) +
    `</div></body></html>`;
  badgeWin = new BrowserWindow({
    x: Math.round(workArea.x + workArea.width - W - 20),
    y: Math.round(workArea.y + workArea.height - H - 20),
    width: W,
    height: H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  badgeWin.setIgnoreMouseEvents(true, { forward: false });
  badgeWin.setAlwaysOnTop(true, "screen-saver");
  badgeWin.once("closed", () => { badgeWin = null; });
  // 同 flash：不等 ready-to-show，直接显示（透明窗空白帧=透明无白闪）
  badgeWin.showInactive();
  badgeWin.once("ready-to-show", () => { if (badgeWin && !badgeWin.isDestroyed() && !badgeWin.isVisible()) badgeWin.showInactive(); });
  badgeWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => fadeOutBadge());
}

function fadeOutBadge(): void {
  if (badgeIdleTimer) { clearTimeout(badgeIdleTimer); badgeIdleTimer = null; }
  const win = badgeWin;
  badgeWin = null;
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents
      .executeJavaScript("document.body.style.setProperty('transition','opacity .3s');document.body.style.setProperty('opacity','0');")
      .catch(() => { /* ignore */ });
    setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, 340);
  } catch { /* ignore */ }
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
      const next = {
        x: bounds.x ?? current.x,
        y: bounds.y ?? current.y,
        width: bounds.width ?? current.width,
        height: bounds.height ?? current.height
      };
      // anchor="bottom-right"（上游 #6）：只改宽高时保持右下角不动（桌宠锚定
      // 窗口右下角，改尺寸时视觉位置保持原地；旧插件不传 anchor 行为不变）。
      // （上游 #12，Codex review PR#8）：调用方显式给了 x/y 时不得用锚定值
      // 覆盖——只对**未提供**的轴做右下角保持（修「锚定 resize 悄悄挪回旧角落」）。
      if ((bounds as { anchor?: string }).anchor === "bottom-right") {
        if (bounds.x == null) next.x = current.x + current.width - next.width;
        if (bounds.y == null) next.y = current.y + current.height - next.height;
      }
      win.setBounds(next);
    }
  };
}

export function openSettings(oobeOrMenuItem: boolean | Electron.MenuItem = false, _window?: Electron.BaseWindow, _event?: Electron.KeyboardEvent, page?: string): void {
  const oobe = typeof oobeOrMenuItem === "boolean" ? oobeOrMenuItem : false;
  if (oobe) onboardingCompletionRequested = false;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    /* R73：定位分区（如从侧栏归档入口进 settings-sessions）。 */
    if (typeof page === "string" && page && !settingsWindow.webContents.isLoading()) {
      settingsWindow.webContents.send("settings:navigate", page);
    }
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    title: "SecAgent设置",
    skipTaskbar: false,
    /* R61：设置窗独立化——此前 parent 挂主窗，Windows 把 owned 窗口视为
       附属于主窗（永不进任务栏、主窗隐藏时被连带藏起）。去掉后为独立
       顶层窗口：任务栏有自己图标，主窗最小化/隐藏不再影响设置窗。 */
    modal: false,
    /* R73：白屏根治——首帧窗口就带主题底色（React 挂载前 1-2s 的
       backgroundColor 恒白，深色主题下闪白更刺眼），且等首帧画完
       （ready-to-show）再显示。 */
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0B0F14" : "#FAFBFD",
    ...windowChromeOptions(),
    icon: appIconPath(),
    webPreferences: { preload: path.join(__dirname, "../preload/preload.cjs"), contextIsolation: true, nodeIntegration: false }
  });
  configureWindowChrome(settingsWindow);
  installWindowDiagnostics(settingsWindow, "settings");
  installExternalLinkGuard(settingsWindow);
  settingsWindow.on("page-title-updated", (event) => { event.preventDefault(); });
  settingsWindow.setTitle("SecAgent设置");
  const query = oobe ? "?settings=1&oobe=1" : "?settings=1";
  const hash = typeof page === "string" && page ? `#${page}` : "";
  if (process.env.ELECTRON_RENDERER_URL) settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}${hash}`);
  else settingsWindow.loadFile(path.join(__dirname, "../renderer/index.html"), { query: oobe ? { settings: "1", oobe: "1" } : { settings: "1" }, ...(hash ? { hash: page! } : {}) });
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
