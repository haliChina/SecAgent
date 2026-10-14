// Overlay 浮窗专用 preload：只暴露桌宠/浮窗必需的最小桥接能力。
// 与主窗口的 preload.ts 完全隔离，不暴露 secagent API。
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__secagentOverlay", {
  /** 切换鼠标点击穿透：true=穿透（默认），false=接管（指针在内容命中区时） */
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.send("overlay:ignore-mouse", !!ignore),
  /** 拖拽移动窗口（增量像素）——旧协议，DPI 缩放下跨进程增量换算可能单向漂移，仅作兼容兜底 */
  move: (dx: number, dy: number) => ipcRenderer.send("overlay:move", Number(dx) || 0, Number(dy) || 0),
  /**
   * 拖拽绝对定位（新协议）：传「抓取点在窗口内的偏移」（拖拽期间恒定），
   * 主进程用自己读到的光标屏幕坐标定位窗口原点。不做任何跨进程增量换算，
   * 从机制上消灭 DPI 缩放导致的反向移动/棘轮漂移。
   */
  moveTo: (offsetX: number, offsetY: number) =>
    ipcRenderer.send("overlay:move-to", Number(offsetX) || 0, Number(offsetY) || 0)
});
