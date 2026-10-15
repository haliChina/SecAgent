/**
 * 伴随软件安装 IPC 域（B2 自 main.ts 拆出，纯搬家）。
 *
 * 14 通道：apps/classisland/secrandom/iccce/cw 的 detect/pick/install +
 * companions:install-all 批量。窗口引用经访问器注入（dialog 父窗口：
 * 设置窗优先，主窗兜底）；安装器实例与提权桥/串行锁同域内组装。
 */
import { dialog, ipcMain, type BrowserWindow } from "electron";
import { detectCompanionApps } from "../companion-apps.js";
import { ClassIslandInstaller } from "../classisland.js";
import { SecRandomInstaller } from "../secrandom.js";
import { IccceInstaller } from "../iccce.js";
import { ClassWidgetsInstaller } from "../classwidgets.js";
import { logMain } from "./main-log.js";
import { createCompanionExecutor, withCompanionInstallLock } from "./companion-bridge.js";

export function registerCompanionIpc(getWindow: () => BrowserWindow | undefined): void {
  const classIslandInstaller = new ClassIslandInstaller({ log: logMain });
  const secRandomInstaller = new SecRandomInstaller({ log: logMain });
  const iccceInstaller = new IccceInstaller({ log: logMain });
  const classWidgetsInstaller = new ClassWidgetsInstaller({ log: logMain });
  const dialogParent = () => { const settings = getWindow(); return settings; };

  ipcMain.handle("apps:detect", () => detectCompanionApps());
  ipcMain.handle("classisland:detect", async () => {
    const candidates = await classIslandInstaller.detect();
    logMain("companion.classisland.detect", { candidates: candidates.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, dataRoot: candidate.dataRoot, pluginPackagesPath: candidate.pluginPackagesPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, pluginHealthy: candidate.pluginHealthy, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds, compatible: candidate.compatible, source: candidate.source })) });
    return candidates;
  });
  ipcMain.handle("classisland:pick", async () => {
    const result = await dialog.showOpenDialog(dialogParent()!, {
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "ClassIsland", extensions: ["exe"] }] : undefined
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return classIslandInstaller.inspect(result.filePaths[0]);
  });
  ipcMain.handle("classisland:install", async (event, targetIds: unknown) => {
    if (!Array.isArray(targetIds) || targetIds.some((item) => typeof item !== "string")) throw new Error("ClassIsland 安装目标无效");
    return withCompanionInstallLock("classisland", async () => {
      const executor = await createCompanionExecutor();
      try {
        return await classIslandInstaller.install(targetIds, (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send("classisland:progress", progress);
        }, executor);
      } finally {
        await executor?.close();
      }
    });
  });
  ipcMain.handle("secrandom:detect", async () => {
    const candidates = await secRandomInstaller.detect();
    logMain("companion.secrandom.detect", { candidates: candidates.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, dataRoot: candidate.dataRoot, pluginPackagesPath: candidate.pluginPackagesPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, isRunning: candidate.isRunning, compatible: candidate.compatible, source: candidate.source })) });
    return candidates;
  });
  ipcMain.handle("secrandom:pick", async () => {
    const result = await dialog.showOpenDialog(dialogParent()!, {
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "SecRandom", extensions: ["exe"] }] : undefined
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return secRandomInstaller.inspect(result.filePaths[0]);
  });
  ipcMain.handle("secrandom:install", async (event, targetIds: unknown) => {
    if (!Array.isArray(targetIds) || targetIds.some((item) => typeof item !== "string")) throw new Error("SecRandom 安装目标无效");
    return withCompanionInstallLock("secrandom", async () => {
      const executor = await createCompanionExecutor();
      try {
        return await secRandomInstaller.install(targetIds, (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send("secrandom:progress", progress);
        }, executor);
      } finally {
        await executor?.close();
      }
    });
  });
  ipcMain.handle("iccce:detect", async () => {
    const candidates = await iccceInstaller.detect();
    logMain("companion.iccce.detect", { candidates: candidates.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, rootPath: candidate.rootPath, pluginPackagesPath: candidate.pluginPackagesPath, pluginsPath: candidate.pluginsPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, pluginHealthy: candidate.pluginHealthy, isRunning: candidate.isRunning, compatible: candidate.compatible, source: candidate.source })) });
    return candidates;
  });
  ipcMain.handle("iccce:pick", async () => {
    const result = await dialog.showOpenDialog(dialogParent()!, {
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "ICC-CE", extensions: ["exe"] }] : undefined
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return iccceInstaller.inspect(result.filePaths[0]);
  });
  ipcMain.handle("iccce:install", async (event, targetIds: unknown) => {
    if (!Array.isArray(targetIds) || targetIds.some((item) => typeof item !== "string")) throw new Error("ICC-CE 安装目标无效");
    return withCompanionInstallLock("iccce", async () => {
      const executor = await createCompanionExecutor();
      try {
        return await iccceInstaller.install(targetIds, (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send("iccce:progress", progress);
        }, executor);
      } finally {
        await executor?.close();
      }
    });
  });
  ipcMain.handle("cw:detect", async () => {
    const candidates = await classWidgetsInstaller.detect();
    logMain("companion.classwidgets.detect", { candidates: candidates.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, pluginsPath: candidate.pluginsPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds, compatible: candidate.compatible, source: candidate.source })) });
    return candidates;
  });
  ipcMain.handle("cw:pick", async () => {
    const result = await dialog.showOpenDialog(dialogParent()!, {
      properties: ["openFile"],
      filters: process.platform === "win32" ? [{ name: "Class Widgets", extensions: ["exe"] }] : undefined
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    return classWidgetsInstaller.inspect(result.filePaths[0]);
  });
  ipcMain.handle("cw:install", async (event, targetIds: unknown) => {
    if (!Array.isArray(targetIds) || targetIds.some((item) => typeof item !== "string")) throw new Error("Class Widgets 安装目标无效");
    return withCompanionInstallLock("classwidgets", async () => {
      const executor = await createCompanionExecutor();
      try {
        return await classWidgetsInstaller.install(targetIds, (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send("cw:progress", progress);
        }, executor);
      } finally {
        await executor?.close();
      }
    });
  });
  ipcMain.handle("companions:install-all", async (event, payload: unknown) => {
    if (!payload || typeof payload !== "object") throw new Error("联动插件安装目标无效");
    const input = payload as Record<string, unknown>;
    const readIds = (key: string): string[] => {
      const value = input[key];
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${key} 安装目标无效`);
      return value;
    };
    const classIslandIds = readIds("classIsland");
    const secRandomIds = readIds("secRandom");
    const iccceIds = readIds("iccce");
    const cwIds = readIds("cw");
    const sendProgress = (channel: string) => (progress: unknown) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, progress);
    };
    const failureResults = (targetIds: string[], error: unknown) => targetIds.map((targetId) => ({
      targetId,
      ok: false,
      action: "failed" as const,
      message: error instanceof Error ? error.message : String(error)
    }));
    return withCompanionInstallLock("batch", async () => {
      const executor = await createCompanionExecutor();
      logMain("companion.batch.begin", { classIslandIds, secRandomIds, iccceIds, cwIds, elevatedExecutor: Boolean(executor) });
      try {
        // The four installers run concurrently: each has its own download/
        // package/decompress phases, and the long "waiting for the host app to
        // come back" health polls overlap instead of adding up. The shared
        // elevated worker serialises the actually-privileged file operations
        // through its request directory, so one UAC still covers everything.
        const runInstaller = async (label: string, ids: string[], install: () => Promise<unknown[]>): Promise<unknown[]> => {
          if (!ids.length) return [];
          try { return await install(); }
          catch (error) {
            logMain(`companion.batch.${label}.failed`, { error: error instanceof Error ? error.message : String(error) });
            return failureResults(ids, error);
          }
        };
        const [classIsland, secRandom, iccce, cw] = await Promise.all([
          runInstaller("classisland", classIslandIds, () => classIslandInstaller.install(classIslandIds, sendProgress("classisland:progress"), executor)),
          runInstaller("secrandom", secRandomIds, () => secRandomInstaller.install(secRandomIds, sendProgress("secrandom:progress"), executor)),
          runInstaller("iccce", iccceIds, () => iccceInstaller.install(iccceIds, sendProgress("iccce:progress"), executor)),
          runInstaller("classwidgets", cwIds, () => classWidgetsInstaller.install(cwIds, sendProgress("cw:progress"), executor))
        ]);
        const allResults = [...classIsland, ...secRandom, ...iccce, ...cw];
        const failed = allResults.filter((item) => !item || (item as { ok?: unknown }).ok !== true);
        logMain(failed.length ? "companion.batch.completed-with-failures" : "companion.batch.success", {
          classIsland: classIsland.length,
          secRandom: secRandom.length,
          iccce: iccce.length,
          cw: cw.length,
          ok: allResults.length - failed.length,
          failed: failed.length,
          failedTargets: failed.map((item) => (item as { targetId?: unknown }).targetId).filter((item): item is string => typeof item === "string")
        });
        return { classIsland, secRandom, iccce, cw };
      } finally {
        await executor?.close();
        logMain("companion.batch.end", { classIslandIds, secRandomIds, iccceIds, cwIds });
      }
    });
  });
}
