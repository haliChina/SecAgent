import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closeHostProcesses, enumerateHostProcesses, installCompanionPackage, startCompanionProcessWithSameElevation, type CompanionExecutor, type CompanionLogger, type CompanionPackageSpec, type HostProcessFilter, type HostProcessInfo } from "./companion-package.js";
import { compareVersions, defaultCommandRunner, defaultExists, defaultForceTerminate, defaultIsProcessRunning, defaultReadFile, defaultRequestGracefulClose, defaultVersionOf, discoverRunningProcesses, discoverWindowsExternalPaths, downloadLatestCompanionPlugin, hashId, normalizePath, parseJsonList, parseWindowsCommandLine, platformPath, waitForInstalledPlugin, type CommandRunner, type CompanionDownloadSpec, type DiscoveredProcess, type Fetcher, type PathApi, type SupportedPlatform } from "./companion-installer-shared.js";
import { DEFAULT_MARKETPLACE_PROXY_URL, describeDownloadAttempt, marketplaceRequestUrls, type DownloadAttemptLogger } from "./marketplace.js";

export const CLASSWIDGETS_PLUGIN_REPOSITORY = "SECTL/ClassWidgets-SecAgent-Plugin";
export const CLASSWIDGETS_PLUGIN_ID = "cn.sectl.secagent";
export const CLASSWIDGETS_PLUGIN_ASSET_NAME = "cn.sectl.secagent.cwplugin";
export const MIN_CLASSWIDGETS_VERSION = "2.0.0.0";
export const CLASSWIDGETS_RELEASE_API_URL = `https://api.github.com/repos/${CLASSWIDGETS_PLUGIN_REPOSITORY}/releases/latest`;

/** B1-2：共享下载内核的差异化描述（GitHub Release 下载降级链/资产名/体积上限）。 */
export const CLASSWIDGETS_DOWNLOAD_SPEC: CompanionDownloadSpec = {
  productName: "Class Widgets",
  releaseApiUrl: CLASSWIDGETS_RELEASE_API_URL,
  releasePageUrl: CLASSWIDGETS_RELEASE_PAGE_URL,
  repository: CLASSWIDGETS_PLUGIN_REPOSITORY,
  assetName: CLASSWIDGETS_PLUGIN_ASSET_NAME,
  maxBytes: MAX_CLASSWIDGETS_PLUGIN_BYTES
};
const CLASSWIDGETS_RELEASE_PAGE_URL = `https://github.com/${CLASSWIDGETS_PLUGIN_REPOSITORY}/releases/latest`;

/** CW2 stores its plugin API compatibility in `api_version` (PEP 440 specifier).
 *  Patterns are deliberately line-anchored-free: cwplugin.json may be printed
 *  compact (all fields on one line) or pretty (one field per line). */
const CLASSWIDGETS_PLUGIN_VERSION_PATTERN = /"version"\s*:\s*"([^"]+)"/i;
const CLASSWIDGETS_PLUGIN_ID_PATTERN = /"id"\s*:\s*"([^"]+)"/i;
const CLASSWIDGETS_PLUGIN_ENTRY_PATTERN = /"entry"\s*:\s*"([^"]+)"/i;
const WINDOWS_CLASSWIDGETS_EXE = "ClassWidgets.exe";
const MAX_CLASSWIDGETS_PLUGIN_BYTES = 100 * 1024 * 1024;
const CLASSWIDGETS_HEALTH_URL = "http://127.0.0.1:18791/health";

export interface ClassWidgetsInstallCandidate {
  id: string;
  executablePath: string;
  rootPath: string;
  /** Directory that holds the CW2 plugin folders ("plugins" inside the app tree). */
  pluginsPath: string;
  version?: string;
  installedPluginVersion?: string;
  pluginHealthy?: boolean;
  isRunning: boolean;
  pid?: number;
  /** Every running process belonging to this Class Widgets installation. */
  processIds?: number[];
  launchArgs: string[];
  source: string;
  compatible: boolean;
  reason?: string;
}

export interface ClassWidgetsInstallResult {
  targetId: string;
  ok: boolean;
  action: "installed" | "already-installed" | "skipped" | "failed";
  message: string;
  version?: string;
}

export type ClassWidgetsInstallPhase = "downloading" | "verifying" | "installing" | "closing" | "restarting";
export interface ClassWidgetsInstallProgress {
  phase: ClassWidgetsInstallPhase;
  targetIds: string[];
  /** Determinate progress for the companion half (0-100). */
  percent?: number;
  message?: string;
}

export type ClassWidgetsRunningProcess = DiscoveredProcess;

export interface ClassWidgetsDiscoveryOptions {
  platform?: SupportedPlatform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  executablePaths?: string[];
  runningProcesses?: ClassWidgetsRunningProcess[];
  commandRunner?: CommandRunner;
  versionOf?: (executablePath: string) => Promise<string | undefined> | string | undefined;
  exists?: (candidate: string) => boolean;
  readFile?: (filePath: string) => string;
  fetcher?: Fetcher;
}

export interface ClassWidgetsInstallerOptions extends ClassWidgetsDiscoveryOptions {
  requestGracefulClose?: (pid: number) => Promise<void | boolean>;
  forceTerminateProcess?: (pid: number) => Promise<void>;
  isProcessRunning?: (pid: number) => Promise<boolean>;
  listProcesses?: (filter: HostProcessFilter) => Promise<HostProcessInfo[]>;
  restartProcess?: (executablePath: string, args: string[]) => Promise<void>;
  gracefulCloseTimeoutMs?: number;
  waitForExitTimeoutMs?: number;
  waitForExitPollMs?: number;
  closeSettlePollMs?: number;
  waitForPluginTimeoutMs?: number;
  waitForPluginPollMs?: number;
  installPackage?: (destinationPath: string, bytes: Buffer, spec: CompanionPackageSpec) => Promise<string> | string;
  log?: CompanionLogger;
  now?: () => number;
}

const execFileAsync = promisify(execFile);

function potentialExecutablePaths(input: string, platform: SupportedPlatform): string[] {
  const api = platformPath(platform);
  const normalizedInput = input.trim().replace(/,\d+$/, "").replace(/^"(.*)"$/, "$1");
  if (api.extname(normalizedInput).toLowerCase() === (platform === "win32" ? ".exe" : "")) return [normalizedInput];
  if (platform === "darwin" && normalizedInput.endsWith(".app")) return [api.join(normalizedInput, "Contents", "MacOS", "ClassWidgets")];
  return platform === "win32" ? [api.join(normalizedInput, WINDOWS_CLASSWIDGETS_EXE)] : [api.join(normalizedInput, "ClassWidgets")];
}

function staticExecutablePaths(platform: SupportedPlatform, home: string, env: NodeJS.ProcessEnv): string[] {
  const api = platformPath(platform);
  if (platform === "darwin") {
    return [
      "/Applications/ClassWidgets.app/Contents/MacOS/ClassWidgets",
      api.join(home, "Applications", "ClassWidgets.app", "Contents", "MacOS", "ClassWidgets")
    ];
  }
  if (platform !== "win32") return [api.join(home, "ClassWidgets", "ClassWidgets")];
  const local = env.LOCALAPPDATA || api.join(home, "AppData", "Local");
  const programFiles = env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const roots = [local, api.join(local, "Programs"), programFiles, programFilesX86, home, api.join(home, "Desktop"), api.join(home, "Downloads")];
  return roots.flatMap((root) => [
    api.join(root, WINDOWS_CLASSWIDGETS_EXE),
    api.join(root, "Class Widgets", WINDOWS_CLASSWIDGETS_EXE),
    api.join(root, "ClassWidgets", WINDOWS_CLASSWIDGETS_EXE)
  ]);
}

/**
 * CW2's portable layout keeps everything inside the app folder (its default);
 * non-portable installs keep plugins in %APPDATA%\Class Widgets\plugins.
 */
export function resolveClassWidgetsLayout(executablePath: string, options: { platform?: SupportedPlatform; home?: string; env?: NodeJS.ProcessEnv; exists?: (candidate: string) => boolean } = {}): { packageRoot: string; pluginsPath: string } {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const exists = options.exists || defaultExists;
  const packageRoot = api.resolve(api.dirname(executablePath));
  const portablePlugins = api.join(packageRoot, "plugins");
  if (exists(portablePlugins)) return { packageRoot, pluginsPath: portablePlugins };
  const roaming = platform === "win32"
    ? env.APPDATA || api.join(home, "AppData", "Roaming")
    : platform === "darwin"
      ? api.join(home, "Library", "Application Support")
      : env.XDG_DATA_HOME || api.join(home, ".local", "share");
  return { packageRoot, pluginsPath: api.join(roaming, "Class Widgets", "plugins") };
}

function installedPluginVersion(pluginsPath: string, platform: SupportedPlatform, exists: (candidate: string) => boolean, readFile: (filePath: string) => string): string | undefined {
  const api = platformPath(platform);
  const pluginPath = api.join(pluginsPath, CLASSWIDGETS_PLUGIN_ID);
  const manifestPath = api.join(pluginPath, "cwplugin.json");
  if (!exists(manifestPath)) return undefined;
  if (exists(api.join(pluginPath, ".disabled")) || exists(api.join(pluginPath, ".uninstall"))) return undefined;
  try {
    const manifest = readFile(manifestPath);
    if (CLASSWIDGETS_PLUGIN_ID_PATTERN.exec(manifest)?.[1]?.trim().toLowerCase() !== CLASSWIDGETS_PLUGIN_ID) return undefined;
    const entry = CLASSWIDGETS_PLUGIN_ENTRY_PATTERN.exec(manifest)?.[1]?.trim();
    if (!entry || entry.includes("..") || entry.includes("/") || entry.includes("\\")) return undefined;
    if (!exists(api.join(pluginPath, entry))) return undefined;
    return CLASSWIDGETS_PLUGIN_VERSION_PATTERN.exec(manifest)?.[1]?.trim();
  } catch { return undefined; }
}

interface PluginHealthResult {
  healthy: boolean;
  reason: string;
  status?: number;
}

async function probeClassWidgetsPluginDetailed(fetcher: Fetcher): Promise<PluginHealthResult> {
  try {
    const response = await fetcher(CLASSWIDGETS_HEALTH_URL, { signal: AbortSignal.timeout(1_500), headers: { Accept: "application/json" } });
    if (!response.ok) return { healthy: false, reason: `健康检查返回 HTTP ${response.status}`, status: response.status };
    const payload = await response.json() as { apiVersion?: unknown; name?: unknown; status?: unknown };
    if (payload.apiVersion === 1 && payload.name === "classwidgets" && payload.status === "ok") return { healthy: true, reason: "ok", status: response.status };
    return { healthy: false, reason: "健康检查返回内容不匹配", status: response.status };
  } catch { return { healthy: false, reason: "健康检查服务未响应" }; }
}

async function waitForClassWidgetsHealth(fetcher: Fetcher, timeoutMs = 45_000, pollMs = 250): Promise<PluginHealthResult> {
  const deadline = Date.now() + timeoutMs;
  let last: PluginHealthResult = { healthy: false, reason: "健康检查服务未响应" };
  while (true) {
    last = await probeClassWidgetsPluginDetailed(fetcher);
    if (last.healthy) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function compareClassWidgetsVersions(left: string, right: string): number {
  return compareVersions(left, right);
}

export function isCompatibleClassWidgetsVersion(version: string | undefined): boolean {
  return Boolean(version && compareClassWidgetsVersions(version, MIN_CLASSWIDGETS_VERSION) >= 0);
}

export async function discoverClassWidgetsInstallations(options: ClassWidgetsDiscoveryOptions = {}): Promise<ClassWidgetsInstallCandidate[]> {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const exists = options.exists || defaultExists;
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const runningProcesses = options.runningProcesses || await discoverRunningProcesses(platform, commandRunner, [WINDOWS_CLASSWIDGETS_EXE]);
  const running = runningProcesses.map((processInfo) => ({ ...processInfo }));
  const externalPaths = platform === "win32" && !options.executablePaths?.length && !options.runningProcesses ? await discoverWindowsExternalPaths(commandRunner, env, {
      displayNameFilter: "-like '*Class*Widgets*'",
      targetPathPattern: "(?i)Class.?Widgets"
    }) : [];
  const inputPaths = [
    ...staticExecutablePaths(platform, home, env),
    ...(options.executablePaths || []),
    ...externalPaths.flatMap((item) => potentialExecutablePaths(item, platform)),
    ...running.map((item) => item.executablePath)
  ];
  const candidates = new Map<string, ClassWidgetsInstallCandidate>();
  const runningByPath = new Map<string, ClassWidgetsRunningProcess>();
  const runningPidsByPath = new Map<string, number[]>();
  for (const item of running) {
    const key = normalizePath(item.executablePath, platform);
    const pids = runningPidsByPath.get(key) || [];
    if (!pids.includes(item.pid)) pids.push(item.pid);
    runningPidsByPath.set(key, pids);
    if (!runningByPath.has(key)) runningByPath.set(key, item);
  }
  const versionOf = options.versionOf || ((executablePath: string) => defaultVersionOf(executablePath, platform, commandRunner));
  for (const executablePath of [...new Set(inputPaths.map((item) => api.normalize(item)))]) {
    if (!exists(executablePath)) continue;
    const processInfo = runningByPath.get(normalizePath(executablePath, platform));
    const version = processInfo?.version || await versionOf(executablePath);
    const layout = resolveClassWidgetsLayout(executablePath, { platform, home, env, exists });
    const compatible = isCompatibleClassWidgetsVersion(version);
    const installedVersion = installedPluginVersion(layout.pluginsPath, platform, exists, defaultReadFile);
    const processIds = processInfo ? runningPidsByPath.get(normalizePath(executablePath, platform)) : undefined;
    const candidate: ClassWidgetsInstallCandidate = {
      id: hashId(executablePath, layout.pluginsPath, platform),
      executablePath,
      rootPath: layout.packageRoot,
      pluginsPath: layout.pluginsPath,
      ...(version ? { version } : {}),
      ...(installedVersion ? { installedPluginVersion: installedVersion } : {}),
      isRunning: Boolean(processInfo),
      ...(processInfo ? { pid: processInfo.pid, launchArgs: parseWindowsCommandLine(processInfo.commandLine).slice(1) } : { launchArgs: [] }),
      ...(processIds?.length ? { processIds: [...processIds] } : {}),
      source: processInfo ? "running-process" : options.executablePaths?.includes(executablePath) ? "manual-or-explicit" : "discovery",
      compatible,
      ...(compatible ? {} : { reason: version ? `Class Widgets 版本过低，需要 ${MIN_CLASSWIDGETS_VERSION} 及以上` : "无法确认 Class Widgets 版本，请选择可识别的 ClassWidgets.exe" })
    };
    const key = `${normalizePath(executablePath, platform)}\0${normalizePath(layout.pluginsPath, platform)}`;
    const previous = candidates.get(key);
    if (!previous || (!previous.isRunning && candidate.isRunning)) candidates.set(key, candidate);
  }
  return [...candidates.values()];
}

function isClassWidgetsPluginReady(candidate: ClassWidgetsInstallCandidate): boolean {
  return Boolean(candidate.installedPluginVersion && (!candidate.isRunning || candidate.pluginHealthy === true));
}

export class ClassWidgetsInstaller {
  private candidates = new Map<string, ClassWidgetsInstallCandidate>();
  private readonly platform: SupportedPlatform;
  private readonly fetcher: Fetcher;
  private readonly commandRunner: CommandRunner;
  private readonly options: ClassWidgetsInstallerOptions;

  constructor(options: ClassWidgetsInstallerOptions = {}) {
    this.options = options;
    this.platform = options.platform || process.platform;
    this.fetcher = options.fetcher || fetch;
    this.commandRunner = options.commandRunner || defaultCommandRunner;
  }

  async detect(): Promise<ClassWidgetsInstallCandidate[]> {
    const discovered = await discoverClassWidgetsInstallations({ ...this.options, platform: this.platform, executablePaths: [...(this.options.executablePaths || []), ...[...this.candidates.values()].map((candidate) => candidate.executablePath)] });
    this.candidates = new Map(discovered.map((candidate) => [candidate.id, candidate]));
    return discovered;
  }

  async inspect(executablePath: string): Promise<ClassWidgetsInstallCandidate | undefined> {
    const discovered = await discoverClassWidgetsInstallations({ ...this.options, platform: this.platform, executablePaths: [executablePath] });
    const candidate = discovered[0];
    if (candidate) this.candidates.set(candidate.id, candidate);
    return candidate;
  }

  async install(targetIds: string[], onProgress?: (progress: ClassWidgetsInstallProgress) => void, executor?: CompanionExecutor): Promise<ClassWidgetsInstallResult[]> {
    const latestCandidates = await this.detect();
    const selected = latestCandidates.filter((candidate) => targetIds.includes(candidate.id));
    const missing = targetIds.filter((id) => !selected.some((candidate) => candidate.id === id)).map((targetId) => ({ targetId, ok: false, action: "failed" as const, message: "找不到 Class Widgets 安装目标，请重新检测" }));
    if (!selected.length) return missing;
    const invalid = selected.filter((candidate) => !candidate.compatible);
    const valid = selected.filter((candidate) => candidate.compatible);
    const results: ClassWidgetsInstallResult[] = invalid.map((candidate) => ({ targetId: candidate.id, ok: false, action: "skipped", message: candidate.reason || "Class Widgets 版本不兼容" }));
    if (!valid.length) return [...results, ...missing];

    const report = (phase: ClassWidgetsInstallPhase, message?: string, percent?: number) => {
      const phasePercent = percent ?? ({ downloading: 18, verifying: 38, installing: 62, closing: 72, restarting: 80 } as const)[phase];
      onProgress?.({ phase, targetIds, percent: phasePercent, ...(message ? { message } : {}) });
    };
    const log = (stage: string, data: unknown = {}) => this.options.log?.(`companion.classwidgets.${stage}`, data);
    log("install.begin", { targetIds, candidates: selected.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, pluginsPath: candidate.pluginsPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds })) });
    const packageData = await downloadLatestCompanionPlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log("download.attempt", attempt), CLASSWIDGETS_DOWNLOAD_SPEC);
    log("download.success", { version: packageData.version, bytes: packageData.bytes.length, sha256: packageData.sha256, repository: CLASSWIDGETS_PLUGIN_REPOSITORY, asset: CLASSWIDGETS_PLUGIN_ASSET_NAME });
    const api = platformPath(this.platform);
    const restart = this.options.restartProcess || ((executablePath: string, args: string[]) =>
      startCompanionProcessWithSameElevation(executablePath, args, this.platform, (stage, data) => log(stage, data)));
    const isRunning = this.options.isProcessRunning || ((pid: number) => executor ? executor.isProcessRunning(pid, (stage, data) => log(stage, data)) : defaultIsProcessRunning(pid));
    const requestClose = this.options.requestGracefulClose || ((pid: number) => executor ? executor.requestGracefulClose(pid, (stage, data) => log(stage, data)) : defaultRequestGracefulClose(pid, this.platform, this.commandRunner));
    const forceTerminate = this.options.forceTerminateProcess || ((pid: number) => executor ? executor.forceTerminate(pid, (stage, data) => log(stage, data)) : defaultForceTerminate(pid, this.platform, this.commandRunner));
    const gracefulCloseTimeoutMs = this.options.gracefulCloseTimeoutMs ?? 2_000;
    const exists = this.options.exists || defaultExists;
    const installPackage = this.options.installPackage || ((destinationPath: string, bytes: Buffer, spec: CompanionPackageSpec) =>
      installCompanionPackage(destinationPath, bytes, spec, this.platform, executor, (stage, data) => log(stage, data)));
    // Refresh immediately before touching the plugin directory so a Class
    // Widgets instance started during the download is also closed automatically.
    let currentValid = valid;
    try {
      const refreshed = await this.detect();
      const refreshedById = new Map(refreshed.map((candidate) => [candidate.id, candidate]));
      currentValid = valid.map((candidate) => refreshedById.get(candidate.id) || candidate);
      log("process.refresh.result", { candidates: currentValid.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds })) });
    } catch (error) {
      log("process.refresh.failed", { error: error instanceof Error ? error.message : String(error) });
    }
    const groups = new Map<string, ClassWidgetsInstallCandidate[]>();
    for (const candidate of currentValid) {
      const key = normalizePath(candidate.pluginsPath, this.platform);
      groups.set(key, [...(groups.get(key) || []), candidate]);
    }
    for (const group of groups.values()) {
      log("group.begin", { pluginsPath: group[0].pluginsPath, targets: group.map((candidate) => candidate.id) });
      const alreadyInstalled = group.every((candidate) => isClassWidgetsPluginReady(candidate) && candidate.installedPluginVersion && compareClassWidgetsVersions(candidate.installedPluginVersion, packageData.version) >= 0);
      if (alreadyInstalled) {
        for (const candidate of group) results.push({ targetId: candidate.id, ok: true, action: "already-installed", message: `已安装 Class Widgets 插件 v${packageData.version}`, version: packageData.version });
        continue;
      }
      const pluginPath = api.join(group[0].pluginsPath, CLASSWIDGETS_PLUGIN_ID);
      // Write the plugin BEFORE closing Class Widgets. The host scans its
      // plugin folder at startup, so files written up front are picked up by
      // whichever instance starts next. If the write fails (locked files),
      // fall back to the close-then-write order below.
      let preinstalled = false;
      try {
        report("installing", "正在写入 Class Widgets 插件文件");
        const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: CLASSWIDGETS_PLUGIN_ID, manifestFileName: "cwplugin.json" });
        preinstalled = true;
        log("package.preinstall.result", { requestedPath: pluginPath, actualPluginPath, hostRunning: group.some((candidate) => candidate.isRunning) });
      } catch (error) {
        log("package.preinstall.failed", { requestedPath: pluginPath, error: error instanceof Error ? error.message : String(error) });
      }
      const running = group.flatMap((candidate) => {
        const processIds = candidate.processIds?.length ? candidate.processIds : candidate.pid === undefined ? [] : [candidate.pid];
        return processIds.map((pid) => ({ candidate, pid }));
      }).filter((item, index, all) => all.findIndex((other) => other.pid === item.pid) === index);
      const processFilter: HostProcessFilter = {
        names: [WINDOWS_CLASSWIDGETS_EXE],
        roots: [...new Set(group.map((candidate) => api.dirname(candidate.executablePath)))]
      };
      const listProcesses = this.options.listProcesses
        ? (filter: HostProcessFilter) => this.options.listProcesses!(filter)
        : (filter: HostProcessFilter) => enumerateHostProcesses(filter, this.platform, executor, this.commandRunner, (stage, data) => log(stage, data));
      const closeOutcome = await closeHostProcesses({
        hostLabel: "Class Widgets",
        initialPids: running.map((item) => item.pid),
        filter: processFilter,
        platform: this.platform,
        listProcesses,
        isProcessRunning: isRunning,
        requestGracefulClose: requestClose,
        forceTerminate,
        gracefulCloseTimeoutMs,
        waitForExitTimeoutMs: this.options.waitForExitTimeoutMs,
        waitForExitPollMs: this.options.waitForExitPollMs,
        settlePollMs: this.options.closeSettlePollMs,
        onProgress: (message) => report("closing", message),
        logger: (stage, data) => log(stage, data)
      });
      log("process.close.summary", { closedPids: closeOutcome.closedPids, remaining: closeOutcome.remaining, failed: closeOutcome.failed, rounds: closeOutcome.rounds });
      const closed = running.filter((item) => closeOutcome.closedPids.includes(item.pid));
      if (closeOutcome.failed) {
        const restarted = new Set<string>();
        for (const { candidate } of closed) {
          if (restarted.has(candidate.id)) continue;
          restarted.add(candidate.id);
          await restart(candidate.executablePath, candidate.launchArgs).catch(() => undefined);
        }
        for (const candidate of group) results.push({
          targetId: candidate.id,
          ok: false,
          action: "failed",
          message: closeOutcome.remaining.length
            ? `Class Widgets 进程 ${closeOutcome.remaining.map((item) => item.pid).join("、")} 无法退出（${closeOutcome.remaining.map((item) => item.name || item.executablePath || `pid ${item.pid}`).join("、")}），请手动关闭后重试`
            : preinstalled
              ? "插件文件已写入，但 Class Widgets 无法自动退出；请手动重启 Class Widgets 后重新检测"
              : "Class Widgets 无法退出，强制结束也失败，未安装插件；请手动关闭后重试"
        });
        continue;
      }
      try {
        if (!preinstalled) {
          report("installing", "正在解压安装 Class Widgets 插件");
          const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: CLASSWIDGETS_PLUGIN_ID, manifestFileName: "cwplugin.json" });
          log("package.install.result", { requestedPath: pluginPath, actualPluginPath });
        }
        const launchCandidate = closed[0]?.candidate || group[0];
        const restarting = running.length > 0;
        const launchArgs = launchCandidate.launchArgs;
        report("restarting", restarting ? "正在重新启动 Class Widgets" : "正在启动 Class Widgets");
        log("process.restart.begin", { executablePath: launchCandidate.executablePath, args: launchArgs, inheritedArgs: launchCandidate.launchArgs, wasRunning: restarting, closedPids: closed.map((item) => item.pid) });
        let launchFailed = false;
        try { await restart(launchCandidate.executablePath, launchArgs); log("process.restart.success", { executablePath: launchCandidate.executablePath, args: launchArgs }); }
        catch (error) { launchFailed = true; log("process.restart.failed", { executablePath: launchCandidate.executablePath, error: error instanceof Error ? error.message : String(error) }); }
        if (!launchFailed) report("verifying", "正在等待 Class Widgets 插件响应", 94);
        const writtenVersion = installedPluginVersion(group[0].pluginsPath, this.platform, exists, defaultReadFile);
        const verifiedVersion = launchFailed ? undefined : await waitForInstalledPlugin(
          () => installedPluginVersion(group[0].pluginsPath, this.platform, exists, defaultReadFile),
          packageData.version,
          this.options.waitForPluginTimeoutMs,
          this.options.waitForPluginPollMs, compareClassWidgetsVersions
        );
        const health = launchFailed
          ? { healthy: false, reason: "对方软件未成功启动" }
          : await waitForClassWidgetsHealth(this.fetcher, this.options.waitForPluginTimeoutMs, this.options.waitForPluginPollMs);
        const pluginHealthy = health.healthy;
        const verified = Boolean(verifiedVersion) && pluginHealthy;
        const detectedVersion = verified ? verifiedVersion : writtenVersion;
        log("verification.result", { expectedVersion: packageData.version, writtenVersion, verifiedVersion, detectedVersion, pluginHealthy, healthReason: health.reason, healthStatus: health.status, healthUrl: CLASSWIDGETS_HEALTH_URL, verified, launchFailed });
        for (const candidate of group) {
          results.push({
            targetId: candidate.id,
            ok: !launchFailed && verified,
            action: !launchFailed && verified ? "installed" : "failed",
            message: launchFailed
              ? `插件包已写入，但 Class Widgets 自动${restarting ? "重启" : "启动"}失败，请手动启动`
              : verified
                ? restarting ? `已安装 Class Widgets 插件 v${verifiedVersion}，Class Widgets 已自动重启` : `已安装 Class Widgets 插件 v${verifiedVersion}，Class Widgets 已自动启动`
                : verifiedVersion
                  ? `插件文件已写入，但 Class Widgets 尚未加载插件（${health.reason}），请重试或手动重启 Class Widgets`
                  : `插件已解压并启动，但未检测到 Class Widgets 插件（${health.reason}），请查看诊断日志后重试`,
            ...(verified && detectedVersion ? { version: detectedVersion } : {})
          });
        }
      } catch (error) {
        log("install.failed", { error: error instanceof Error ? error.message : String(error) });
        const restarted = new Set<string>();
        for (const { candidate } of closed) {
          if (restarted.has(candidate.id)) continue;
          restarted.add(candidate.id);
          await restart(candidate.executablePath, candidate.launchArgs).catch(() => undefined);
        }
        for (const candidate of group) results.push({ targetId: candidate.id, ok: false, action: "failed", message: `安装 Class Widgets 插件失败：${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return [...results, ...missing];
  }
}
