/**
 * 设置/模型目录/更新/诊断 IPC 域（B2 自 main.ts 拆出，纯搬家）。
 *
 * 14 通道：models:list/fetch、providers:list、settings:get/open/
 * skills/open-skills、telemetry:dsn/enabled、updates:get-state/
 * check/download/install、diagnostics:open-logs/export-logs、
 * shell:open-external。更新管理器与设置窗打开回调经注入。
 *
 * settings:save 留在 main.ts——它联动 wake 快捷键注册（与 wake
 * 域同生命周期，后续批次一起拆）。
 */
import fs from "node:fs";
import path from "node:path";
import { app, dialog, ipcMain, shell } from "electron";
import { configuredModels, configPath, loadConfig, OFFICIAL_VISION_MODEL, saveSettings } from "../config.js";
import { DEFAULT_WORKSPACE } from "../paths.js";
import { readSettings } from "../config.js";
import { readAutostart } from "./autostart.js";
import { diagnosticLogDirectory, exportDiagnosticLogs } from "./diagnostic-logs.js";
import { listGoogleModels, type GoogleModelInfo } from "../google-models.js";
import { loadEnabledSkills } from "../skills.js";
import { Models } from "@opencode-ai/models";
import type { UpdateState } from "../types.js";
import type { WindowsUpdateManager } from "./update-manager.js";
import { SENTRY_DSN } from "./main-telemetry.js";
import { officialProvider } from "./ipc-official.js";
import { logMain } from "./main-log.js";

/** Client-facing virtual tiers served by the relay. Latency tier is deferred (回头再用). */
const OFFICIAL_TIER_IDS = ["virtual-fast", "virtual-standard", "virtual-deep"] as const;

export function registerSettingsIpc(deps: {
  getUpdateManager: () => WindowsUpdateManager | undefined;
  openSettings: () => void;
}): void {
  const { getUpdateManager, openSettings } = deps;

  ipcMain.handle("models:list", async () => {
    const { config } = loadConfig(DEFAULT_WORKSPACE);
    // Pull the live catalog for every Google provider (official key, relays, ...)
    // instead of only the first one — the rest used to lose all their models.
    const googleProfiles = (config.agent.models || []).filter((model) => model.provider === "google");
    const googleModels = googleProfiles.length
      ? (await Promise.all(googleProfiles.map((profile) => listGoogleModels(process.env[profile.apiKeyEnv] || "", profile.baseUrl).catch(() => [] as GoogleModelInfo[])))).flat()
      : [];
    const options = configuredModels(config, googleModels).filter((option) => option.id !== "sectl-official" && !option.id.startsWith("sectl-official:"));
    const customModelMode = Boolean(config.defaults?.customModelMode);
    const token = process.env.SECTL_OFFICIAL_TOKEN;
    const baseUrl = (process.env.SECTL_OFFICIAL_API_URL || "").replace(/\/$/, "");
    if (!token || !baseUrl) return customModelMode ? options : [];
    try {
      const current = readSettings(DEFAULT_WORKSPACE);
      if (!current.providers.some((provider) => provider.id === "sectl-official")) {
        saveSettings(DEFAULT_WORKSPACE, { ...current, providers: [...current.providers, officialProvider(baseUrl)] });
      }
    } catch { /* 自愈失败不阻塞模型列表 */ }
    try {
      const query = new URLSearchParams({ custom_model_mode: String(customModelMode) });
      const response = await fetch(`${baseUrl}/models?${query}`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json() as { data?: Array<{ id?: string; name?: string; virtual?: boolean }> };
      const remote = (payload.data || []).filter((model) => model.id).map((model) => ({ id: `official:sectl-official:${model.id}`, name: model.name || model.id || "官方模型", model: model.id || "", provider: "openai-responses", virtual: model.virtual === true }));
      // 低延迟档位暂不开放（回头再用）。
      // 自定义模型模式永远不显示中转服务的虚拟档位；后端也会按后台 allow-list 过滤真实模型。
      const visibleRemote = remote.filter((model) => model.model !== "virtual-latency" && (!customModelMode || (!model.virtual && !model.model.startsWith("virtual-"))));
      if (customModelMode) {
        // 自定义模型模式开启：只加入后台允许的官方真实模型与本地自定义模型。
        return [...visibleRemote, ...options];
      }
      // 关闭：官方档位模式 —— 下拉只有快速/标准/深度三个虚拟档位，看不到具体模型；
      // 另外提供一个识图虚拟模型（virtual-vision），它只作为识图工具的后端模型，
      // 不作为主 Agent 模型出现在前端下拉中（前端按 vision 标记过滤）。
      return visibleRemote.filter((model) => (OFFICIAL_TIER_IDS as readonly string[]).includes(model.model) || model.model === OFFICIAL_VISION_MODEL)
        .map((model) => ({ ...model, vision: model.model === OFFICIAL_VISION_MODEL }));
    } catch { return customModelMode ? options : []; }
  });
  ipcMain.handle("providers:list", async () => {
    try {
      const catalog = await Models.make().providers();
      return Object.values(catalog).map((provider) => ({
        id: provider.id,
        name: provider.name || provider.id,
        env: provider.env || [],
        api: provider.api || "",
        models: Object.values(provider.models || {}).map((model) => ({ id: model.id, name: model.name || model.id }))
      }));
    } catch (error) {
      logMain("providers.list.failed", { error: String(error) });
      return [];
    }
  });
  ipcMain.handle("settings:get", () => {
    const settings = readSettings(DEFAULT_WORKSPACE);
    return { ...settings, autostart: readAutostart() };
  });
  ipcMain.on("telemetry:dsn", (event) => { event.returnValue = SENTRY_DSN; });
  ipcMain.on("telemetry:enabled", (event) => {
    try {
      // Preload runs before app.ready. An existing workspace has the persisted
      // choice; a fresh workspace follows the default opt-in setting.
      event.returnValue = !fs.existsSync(configPath(DEFAULT_WORKSPACE)) || readSettings(DEFAULT_WORKSPACE).telemetry.enabled;
    } catch {
      event.returnValue = false;
    }
  });
  ipcMain.handle("settings:open", () => { openSettings(); return { ok: true }; });
  ipcMain.handle("updates:get-state", () => getUpdateManager()?.getState() || ({ currentVersion: app.getVersion(), channel: "stable", status: "unsupported", downloadedBytes: 0 } satisfies UpdateState));
  ipcMain.handle("updates:check", () => getUpdateManager()?.check(false) || ({ currentVersion: app.getVersion(), channel: "stable", status: "unsupported", downloadedBytes: 0 } satisfies UpdateState));
  ipcMain.handle("updates:download", async () => {
    const updateManager = getUpdateManager();
    if (!updateManager) throw new Error("更新服务尚未启动");
    return updateManager.download();
  });
  ipcMain.handle("updates:install", () => {
    const updateManager = getUpdateManager();
    if (!updateManager) throw new Error("更新服务尚未启动");
    return updateManager.install();
  });
  ipcMain.handle("diagnostics:open-logs", async () => {
    const directory = diagnosticLogDirectory(DEFAULT_WORKSPACE);
    fs.mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
    logMain("diagnostics.logs.opened");
    return directory;
  });
  ipcMain.handle("diagnostics:export-logs", async () => {
    const defaultPath = path.join(app.getPath("documents"), `SecAgent-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
    const result = await dialog.showSaveDialog({
      title: "导出 SecAgent 诊断日志",
      defaultPath,
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true as const };
    const archivePath = exportDiagnosticLogs(DEFAULT_WORKSPACE, result.filePath, {
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isPackaged: app.isPackaged
    });
    logMain("diagnostics.logs.exported", { path: archivePath });
    return { canceled: false as const, path: archivePath };
  });
  ipcMain.handle("settings:skills", () => {
    const { config } = loadConfig(DEFAULT_WORKSPACE);
    return loadEnabledSkills(config).map((skill) => ({ name: skill.name, description: skill.description, path: skill.path }));
  });
  ipcMain.handle("settings:open-skills", async () => {
    const directory = path.join(DEFAULT_WORKSPACE, "skills");
    fs.mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
    return directory;
  });
  // Fetch an OpenAI-compatible provider's model catalogue (GET {base}/models),
  // e.g. https://api.xiaomimimo.com/v1/models — feeds the settings dropdowns.
  ipcMain.handle("models:fetch", async (_event, request: { baseUrl?: string; apiKey?: string; apiKeyEnv?: string }) => {
    const apiKey = (request.apiKey && request.apiKey.trim()) || (request.apiKeyEnv ? process.env[request.apiKeyEnv] || "" : "");
    if (!request.baseUrl?.trim()) return { ok: false, message: "请填写 Base URL（例如 https://api.xiaomimimo.com/v1）", models: [] };
    if (!apiKey) return { ok: false, message: "缺少 API Key（先保存到工作区 .env 或在输入框填写）", models: [] };
    const { fetchProviderModels } = await import("../models/fetch-models.js");
    return fetchProviderModels({ baseUrl: request.baseUrl, apiKey, timeoutMs: 15_000 });
  });
  ipcMain.handle("shell:open-external", async (_event, url: string) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("无效的链接"); }
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname))) throw new Error("只允许打开 http(s) 链接");
    await shell.openExternal(parsed.toString());
    return { ok: true };
  });
}
