/**
 * Agent 观察窗（R104，「不打架」第三层视觉分离）。
 *
 * 一块像 UU 远程观战画面的置顶小窗：帧流（Agent 视角截图）+ Swarm 风格
 * 光标精灵（持久驻留、ease 滑行）+ thinking 字幕（正在想什么）+ 当前动作行
 * （正在干什么）。
 *
 * 「不打扰工作」的命门（R100 研究定稿）：SendInput 绝对坐标按 Z 序命中——
 * 置顶观察窗会挡住 Agent 自己的点击。因此窗口**默认永久点击穿透**
 * （setIgnoreMouseEvents(true, {forward:true})，Agent 操作穿窗直达真实
 * 目标），用户交互只走顶部把手条：渲染层检测把手 hover → IPC 临时切交互
 * 模式（可拖动/按钮），鼠标离开恢复穿透——画中画播放器模式。
 *
 * 数据通路（全部现成事件的旁路转发，零新增轮询）：
 *  - 帧：PluginHostApi.agentFrame(base64Png)——CU 0.9.4+ 的 screenshot 产物
 *  - 光标：showPluginFlash(x,y,opts) 落点事件旁路（每个坐标动作必经）
 *  - 字幕：session-run trace 的 thinking/summary delta
 *  - 动作行：trace 的 tools/call + flash 的 label
 *
 * 渲染层为内嵌 data URL HTML（flash 同款模式，无构建产物依赖）。
 */

/* electron 是 CJS 且 BrowserWindow 为 lazy getter——node --test（CI 直跑 dist）
   的 named import 会炸（R104 CI 实锤：SyntaxError: Named export 'BrowserWindow'
   not found）。default import 走 CJS interop 恒安全；类型用 typeof import 保真。 */
import electron from "electron";
const { BrowserWindow } = electron as typeof import("electron");

let observeWindow: BrowserWindow | null = null;

/** 光标事件投影（物理像素 + 动作类型/标签——渲染层换算显示比例）。 */
interface ObserveCursorEvent {
  x: number;
  y: number;
  kind: "click" | "type" | "focus" | "scroll" | "chord";
  label?: string;
}

const PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: #0d1117; color: #e6edf3;
    font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; overflow: hidden; user-select: none; }
  .handle { position: fixed; top: 0; left: 0; right: 0; height: 30px; z-index: 30;
    display: flex; align-items: center; gap: 8px; padding: 0 10px;
    background: linear-gradient(to bottom, #161b22, #0d1117);
    border-bottom: 1px solid #21262d; font-size: 12px; color: #8b949e;
    -webkit-app-region: no-drag; cursor: default; }
  .handle .title { flex: 1; font-weight: 600; color: #c9d1d9; }
  .handle .dot { width: 7px; height: 7px; border-radius: 50%; background: #f0883e;
    animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
  .handle button { background: none; border: 0; color: #8b949e; font-size: 13px;
    cursor: pointer; padding: 4px 8px; border-radius: 6px; }
  .handle button:hover { background: #21262d; color: #e6edf3; }
  .stage { position: absolute; inset: 30px 0 64px 0; overflow: hidden; background: #000; }
  .frame { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  .frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .placeholder { color: #484f58; font-size: 12px; text-align: center; line-height: 1.8; padding: 12px; }
  /* Swarm 光标精灵：持久驻留，transform 滑行（GPU），press 缩放绕热点。 */
  .cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px;
    transition: transform .32s cubic-bezier(.3,1.4,.5,1);
    transform-origin: 5px 3.5px; will-change: transform; }
  .cursor.pressing { transition: transform .08s ease, scale .08s ease; scale: .86; }
  .cursor .name { position: absolute; left: 15px; top: 16px; white-space: nowrap;
    font-size: 10px; font-weight: 600; color: #fff; background: #1f6feb;
    padding: 2px 7px; border-radius: 999px; box-shadow: 0 1px 3px rgba(0,0,0,.5); }
  .captions { position: absolute; left: 0; right: 0; bottom: 0; height: 64px;
    background: linear-gradient(to top, #0d1117 70%, transparent);
    padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
  .action { font-size: 12px; font-weight: 600; color: #79c0ff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .thought { font-size: 11.5px; color: #8b949e; line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .hint { position: absolute; right: 10px; bottom: 68px; font-size: 10px; color: #30363d;
    background: rgba(13,17,23,.8); padding: 3px 8px; border-radius: 6px; pointer-events: none; }
</style>
</head>
<body>
  <div class="handle" id="handle">
    <span class="dot"></span>
    <span class="title">SecAgent · 操作观察</span>
    <button id="btnClose" title="关闭观察窗">✕</button>
  </div>
  <div class="stage" id="stage">
    <div class="frame"><div class="placeholder" id="ph">等待 Agent 的屏幕画面…<br>（插件截图后此处显示 Agent 视角）</div></div>
    <div class="cursor" id="cursor" style="display:none">
      <svg viewBox="0 0 28 28" width="26" height="26">
        <path d="M5 3 L5 19.5 L10 14.8 L13.3 21.5 L16.1 20.1 L12.9 13.6 L19.6 13.4 Z"
          fill="#1f6feb" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
      <div class="name">SecAgent</div>
    </div>
  </div>
  <div class="captions">
    <div class="action" id="action">待命</div>
    <div class="thought" id="thought">—</div>
  </div>
  <div class="hint">窗口点击穿透中 · 顶部把手可拖动</div>
<script>
  const { ipcRenderer } = require("electron");
  const cursor = document.getElementById("cursor");
  const stage = document.getElementById("stage");
  const actionEl = document.getElementById("action");
  const thoughtEl = document.getElementById("thought");
  const ph = document.getElementById("ph");
  let frameImg = null;

  /* 帧到达后铺满画面区。 */
  ipcRenderer.on("observe:frame", (_e, data) => {
    if (!data || typeof data.png !== "string") return;
    if (!frameImg) {
      ph && ph.remove();
      frameImg = document.createElement("img");
      document.querySelector(".frame").appendChild(frameImg);
    }
    frameImg.src = "data:image/png;base64," + data.png;
  });

  /* 光标事件：物理像素 → 画面显示比例（按帧图实际渲染尺寸换算）。 */
  ipcRenderer.on("observe:cursor", (_e, ev) => {
    if (!ev) return;
    requestAnimationFrame(() => {
      const img = frameImg;
      if (img && img.naturalWidth) {
        const box = img.getBoundingClientRect();
        const sx = box.width / img.naturalWidth, sy = box.height / img.naturalHeight;
        const px = ev.x * sx, py = ev.y * sy;
        const origin = stage.getBoundingClientRect();
        cursor.style.transform = "translate(" + (px + box.left - origin.left) + "px," + (py + box.top - origin.top) + "px)";
      } else {
        /* 无帧：按画面区比例近似（Agent 视口即全屏的常见情形）。 */
        const origin = stage.getBoundingClientRect();
        cursor.style.transform = "translate(" + (ev.x / 1920 * origin.width) + "px," + (ev.y / 1080 * origin.height) + "px)";
      }
      cursor.style.display = "block";
      cursor.classList.add("pressing");
      setTimeout(() => cursor.classList.remove("pressing"), 160);
      if (ev.label) actionEl.textContent = ev.label;
      else if (ev.kind === "type") actionEl.textContent = "正在输入…";
      else if (ev.kind === "scroll") actionEl.textContent = "正在滚动…";
      else if (ev.kind === "focus") actionEl.textContent = "正在聚焦窗口…";
      else if (ev.kind === "chord") actionEl.textContent = "正在按组合键…";
      else actionEl.textContent = "正在点击…";
    });
  });

  ipcRenderer.on("observe:thought", (_e, data) => {
    if (data && typeof data.text === "string" && data.text.trim()) {
      thoughtEl.textContent = data.text.slice(-240);
    }
  });
  ipcRenderer.on("observe:action", (_e, data) => {
    if (data && typeof data.label === "string") actionEl.textContent = data.label;
  });

  /* 把手交互协议：hover 把手 = 临时可交互（拖动/按钮）；离开 = 恢复穿透。 */
  const handle = document.getElementById("handle");
  handle.addEventListener("mouseenter", () => ipcRenderer.send("observe:set-interact", true));
  handle.addEventListener("mouseleave", () => ipcRenderer.send("observe:set-interact", false));
  document.getElementById("btnClose").addEventListener("click", () => ipcRenderer.send("observe:close"));
</script>
</body>
</html>`;

/** 打开（或聚焦已开的）观察窗。 */
export function openObserveWindow(): void {
  if (observeWindow && !observeWindow.isDestroyed()) {
    observeWindow.showInactive();
    return;
  }
  observeWindow = new BrowserWindow({
    width: 460,
    height: 360,
    resizable: true,
    skipTaskbar: false,
    focusable: false,
    show: false,
    backgroundColor: "#0d1117",
    title: "SecAgent · 操作观察",
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  observeWindow.setAlwaysOnTop(true, "screen-saver");
  observeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  /* 默认永久点击穿透（Agent 的 SendInput 坐标点击穿窗直达真实目标）。
     forward:true——渲染层仍收 mousemove（把手 hover 检测依赖它）。 */
  observeWindow.setIgnoreMouseEvents(true, { forward: true });
  observeWindow.on("ready-to-show", () => {
    if (!observeWindow || observeWindow.isDestroyed() || observeWindow.isVisible()) return;
    observeWindow.showInactive();
  });
  observeWindow.on("closed", () => { observeWindow = null; });
  /* 兜底：ready-to-show 在个别平台不触发（桌宠/flash 历史雷区）。 */
  setTimeout(() => { if (observeWindow && !observeWindow.isDestroyed() && !observeWindow.isVisible()) observeWindow.showInactive(); }, 400);
  observeWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(PAGE_HTML));
}

/** 观察窗是否开着（frame/cursor 推送前查，省无窗 IPC）。 */
export function observeWindowOpen(): boolean {
  return observeWindow !== null && !observeWindow.isDestroyed();
}

/** 把手交互切换：hover 进入=可交互（拖动/按钮），离开=恢复穿透。 */
function setObserveInteract(interact: boolean): void {
  if (!observeWindowOpen()) return;
  observeWindow!.setIgnoreMouseEvents(!interact, { forward: !interact });
}

export function closeObserveWindow(): void {
  if (observeWindowOpen()) observeWindow!.close();
}

/** 帧：CU screenshot 产物（base64 PNG + 视口元信息）。 */
export function pushObserveFrame(png: string, meta?: { width?: number; height?: number; display?: number }): void {
  if (!observeWindowOpen()) return;
  observeWindow!.webContents.send("observe:frame", { png, ...meta });
}

/** 光标：showPluginFlash 旁路（每个坐标动作必经）。 */
export function pushObserveCursor(event: ObserveCursorEvent): void {
  if (!observeWindowOpen()) return;
  observeWindow!.webContents.send("observe:cursor", event);
}

/** thinking/summary 增量（字幕）。 */
export function pushObserveThought(kind: "thinking" | "summary", text: string): void {
  if (!observeWindowOpen() || !text) return;
  observeWindow!.webContents.send("observe:thought", { kind, text });
}

/** 工具调用动作行（tools/call）。 */
export function pushObserveAction(label: string): void {
  if (!observeWindowOpen() || !label) return;
  observeWindow!.webContents.send("observe:action", { label });
}

/** 观察窗 IPC（把手/关闭/开关）。在 main 统一注册。 */
export function registerObserveIpc(ipcMain: Electron.IpcMain): void {
  ipcMain.on("observe:set-interact", (_e, interact: boolean) => setObserveInteract(interact === true));
  ipcMain.on("observe:close", () => closeObserveWindow());
}
