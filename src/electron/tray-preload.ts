/**
 * 托盘气泡专用 preload：只暴露菜单需要的三个能力，
 * 不复用主窗 preload（避免托盘小窗拿到全部 IPC）。
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("secagentTray", {
  platform: process.platform,
  state: () => ipcRenderer.invoke("tray:state"),
  run: (action: string) => ipcRenderer.invoke("tray:run", action),
  close: () => ipcRenderer.send("tray:close")
});
