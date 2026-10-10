/**
 * 插件与市场 IPC 域（B2 自 main.ts 拆出，纯搬家）。
 *
 * 9 通道：plugins:list/settings-call/set-enabled/reload/uninstall/
 * install/update + marketplace:list/install。插件管理器与市场客户端
 * 经访问器注入（实例由启动流程创建）。
 */
import crypto from "node:crypto";
import { dialog, ipcMain, type BrowserWindow } from "electron";
import type { MarketplaceVersion, MarketplaceClient } from "../marketplace.js";
import type { PluginManager } from "../plugin-manager.js";
import { logMain } from "./main-log.js";
import { recordTelemetryFailure } from "./main-telemetry.js";

export function registerPluginIpc(deps: {
  getPluginManager: () => PluginManager | undefined;
  getMarketplace: () => MarketplaceClient;
  getWindow: () => BrowserWindow | undefined;
}): void {
  const { getPluginManager, getMarketplace, getWindow } = deps;

  ipcMain.handle("plugins:list", () => getPluginManager()?.list() || []);
  ipcMain.handle("plugins:settings-call", async (_event, pluginId: string, pageId: string, action: string, args: Record<string, unknown> = {}) => {
    try { return await getPluginManager()?.callSettings(pluginId, pageId, action, args); }
    catch (error) { recordTelemetryFailure({ type: "plugin.call.failed", error, context: { pluginId, pageId, action } }); throw error; }
  });
  ipcMain.handle("plugins:set-enabled", async (_event, id: string, enabled: boolean) => {
    try { await getPluginManager()?.setEnabled(id, enabled); return getPluginManager()?.list() || []; }
    catch (error) { recordTelemetryFailure({ type: "plugin.start.failed", error, context: { pluginId: id, enabled } }); throw error; }
  });
  ipcMain.handle("plugins:reload", async (_event, id: string) => {
    try { await getPluginManager()?.reload(id); return getPluginManager()?.list() || []; }
    catch (error) { recordTelemetryFailure({ type: "plugin.start.failed", error, context: { pluginId: id, phase: "reload" } }); throw error; }
  });
  ipcMain.handle("plugins:uninstall", async (_event, id: string) => { await getPluginManager()?.uninstall(id); return getPluginManager()?.list() || []; });
  ipcMain.handle("plugins:install", async () => {
    const result = await dialog.showOpenDialog(getWindow()!, { properties: ["openFile"], filters: [{ name: "SecAgent plugin", extensions: ["zip"] }] });
    if (result.canceled || !result.filePaths[0]) return getPluginManager()?.list() || [];
    try { await getPluginManager()?.install(result.filePaths[0]); return getPluginManager()?.list() || []; }
    catch (error) { recordTelemetryFailure({ type: "plugin.start.failed", error, context: { phase: "install" } }); throw error; }
  });
  ipcMain.handle("marketplace:list", async () => {
    const operationId = crypto.randomUUID();
    logMain("marketplace.list.started", { operationId });
    try {
      const entries = await getMarketplace().list();
      logMain("marketplace.list.completed", {
        operationId,
        count: entries.length,
        available: entries.filter((entry) => Boolean(entry.latest)).map((entry) => ({ id: entry.id, version: entry.latest?.version })),
        unavailable: entries.filter((entry) => !entry.latest).map((entry) => ({ id: entry.id, error: entry.releaseError }))
      });
      return entries;
    } catch (error) {
      logMain("marketplace.list.failed", { operationId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
  ipcMain.handle("marketplace:install", async (_event, version: MarketplaceVersion) => {
    const pluginManager = getPluginManager();
    if (!pluginManager) throw new Error("插件管理器尚未启动");
    try { await getMarketplace().install(pluginManager, version); return pluginManager.list(); }
    catch (error) { recordTelemetryFailure({ type: "plugin.start.failed", error, context: { phase: "marketplace-install", version: version.version } }); throw error; }
  });
  ipcMain.handle("plugins:update", async (_event, id: string) => {
    const pluginManager = getPluginManager();
    if (!pluginManager) throw new Error("插件管理器尚未启动");
    try {
      const result = await getMarketplace().updatePlugin(pluginManager, id);
      logMain("marketplace.plugins.manual-update", result);
      return result;
    } catch (error) {
      recordTelemetryFailure({ type: "plugin.start.failed", error, context: { pluginId: id, phase: "manual-update" } });
      throw error;
    }
  });
}
