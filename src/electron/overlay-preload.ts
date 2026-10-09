// Overlay 浮窗专用 preload：只暴露桌宠/浮窗必需的最小桥接能力。
// 与主窗口的 preload.ts 完全隔离，不暴露 secagent API。
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__secagentOverlay", {
  /** 切换鼠标点击穿透：true=穿透（默认），false=接管（指针在内容命中区时） */
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send("overlay:ignore-mouse", !!ignore),
  /** 拖拽移动窗口（增量像素） */
  move: (dx: number, dy: number) => ipcRenderer.send("overlay:move", Number(dx) || 0, Number(dy) || 0)
});
