import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closeHostProcesses, enumerateHostProcesses, installCompanionPackage, startCompanionProcessWithSameElevation, type CompanionExecutor, type CompanionLogger, type CompanionPackageSpec, type HostProcessFilter, type HostProcessInfo } from "./companion-package.js";
import { compareVersions, defaultCommandRunner, defaultExists, defaultForceTerminate, defaultIsProcessRunning, defaultReadFile, defaultRequestGracefulClose, defaultVersionOf, discoverRunningProcesses, discoverWindowsExternalPaths, downloadLatestCompanionPlugin, hashId, normalizePath, parseJsonList, parseWindowsCommandLine, platformPath, waitForInstalledPlugin, type CommandRunner, type CompanionDownloadSpec, type DiscoveredProcess, type Fetcher, type PathApi, type SupportedPlatform } from "./companion-installer-shared.js";
import { DEFAULT_MARKETPLACE_PROXY_URL, describeDownloadAttempt, marketplaceRequestUrls, type DownloadAttemptLogger } from "./marketplace.js";

export const CLASSISLAND_PLUGIN_REPOSITORY = "SECTL/ClassIsland-SecAgent-Plugin";
export const CLASSISLAND_PLUGIN_ID = "classisland.secagent";
export const CLASSISLAND_PLUGIN_ASSET_NAME = "ClassIsland.SecAgent.Plugin.cipx";
// The ClassIsland-side plugin (manifest.yml) declares apiVersion: 2.0.0.0, and
// ClassIsland 2.0.0.0 already enforces that plugins target API version
// >= 2.0.0.0 (PluginService.InitializePlugins) and lists only those in the
// marketplace (PluginMarketService). Every host API the plugin uses exists
// unchanged in 2.0.0.0, so 2.0.0.0 is the real lower bound.
export const MIN_CLASSISLAND_VERSION = "2.0.0.0";
export const CLASSISLAND_RELEASE_API_URL = `https://api.github.com/repos/${CLASSISLAND_PLUGIN_REPOSITORY}/releases/latest`;

const CLASSISLAND_DOWNLOAD_SPEC = {
  productName: "ClassIsland",
  releaseApiUrl: CLASSISLAND_RELEASE_API_URL,
  releasePageUrl: `https://github.com/${CLASSISLAND_PLUGIN_REPOSITORY}/releases/latest`,
  repository: CLASSISLAND_PLUGIN_REPOSITORY,
  assetName: CLASSISLAND_PLUGIN_ASSET_NAME,
  maxBytes: MAX_CLASSISLAND_PLUGIN_BYTES,
} satisfies CompanionDownloadSpec;
const CLASSISLAND_RELEASE_PAGE_URL = `https://github.com/${CLASSISLAND_PLUGIN_REPOSITORY}/releases/latest`;

const CLASSISLAND_PLUGIN_VERSION_PATTERN = /^version\s*:\s*["']?([^"'\r\n#]+)["']?/im;
const CLASSISLAND_PLUGIN_ID_PATTERN = /^id\s*:\s*["']?([^"'\r\n#]+)["']?/im;
const CLASSISLAND_PLUGIN_ENTRANCE_PATTERN = /^entranceAssembly\s*:\s*["']?([^"'\r\n#]+)["']?/im;
const WINDOWS_CLASSISLAND_EXE = "ClassIsland.exe";
const WINDOWS_CLASSISLAND_RUNTIME_EXE = "ClassIsland.Desktop.exe";
const MAX_CLASSISLAND_PLUGIN_BYTES = 100 * 1024 * 1024;
const CLASSISLAND_HEALTH_URL = "http://127.0.0.1:18789/health";

export interface ClassIslandInstallCandidate {
  id: string;
  executablePath: string;
  rootPath: string;
  dataRoot: string;
  pluginPackagesPath: string;
  version?: string;
  installedPluginVersion?: string;
  pluginHealthy?: boolean;
  packageType?: string;
  isRunning: boolean;
  pid?: number;
  /** Every running process belonging to this ClassIsland installation. */
  processIds?: number[];
  launchArgs: string[];
  source: string;
  compatible: boolean;
  reason?: string;
}

export interface ClassIslandInstallResult {
  targetId: string;
  ok: boolean;
  action: "installed" | "already-installed" | "skipped" | "failed";
  message: string;
  version?: string;
}

export type ClassIslandInstallPhase = "downloading" | "verifying" | "installing" | "closing" | "restarting";
export interface ClassIslandInstallProgress {
  phase: ClassIslandInstallPhase;
  targetIds: string[];
  /** Determinate progress for the companion half (0-100). */
  percent?: number;
  message?: string;
}

export type ClassIslandRunningProcess = DiscoveredProcess;

export interface ClassIslandDiscoveryOptions {
  platform?: SupportedPlatform;
  home?: string;
  env?: NodeJS.ProcessEnv;
  executablePaths?: string[];
  runningProcesses?: ClassIslandRunningProcess[];
  commandRunner?: CommandRunner;
  versionOf?: (executablePath: string) => Promise<string | undefined> | string | undefined;
  exists?: (candidate: string) => boolean;
  readFile?: (filePath: string) => string;
  fetcher?: Fetcher;
}

export interface ClassIslandInstallerOptions extends ClassIslandDiscoveryOptions {
  requestGracefulClose?: (pid: number) => Promise<void | boolean>;
  forceTerminateProcess?: (pid: number) => Promise<void>;
  isProcessRunning?: (pid: number) => Promise<boolean>;
  /** Process query used while closing; defaults to the elevated worker when one
   *  is available, so elevated host instances are visible to the kill list. */
  listProcesses?: (filter: HostProcessFilter) => Promise<HostProcessInfo[]>;
  restartProcess?: (executablePath: string, args: string[]) => Promise<void>;
  /** Graceful close is only a brief opportunity; force termination follows. */
  gracefulCloseTimeoutMs?: number;
  waitForExitTimeoutMs?: number;
  waitForExitPollMs?: number;
  /** Delay between post-kill re-checks for relaunched processes. */
  closeSettlePollMs?: number;
  waitForPluginTimeoutMs?: number;
  waitForPluginPollMs?: number;
  installPackage?: (destinationPath: string, bytes: Buffer, spec: CompanionPackageSpec) => Promise<string> | string;
  writePackage?: (filePath: string, bytes: Buffer) => Promise<string> | string;
  log?: CompanionLogger;
  now?: () => number;
}

interface ResolvedClassIslandLayout {
  packageRoot: string;
  dataRoot: string;
  pluginPackagesPath: string;
  packageType?: string;
}

interface CachedCandidate extends ClassIslandInstallCandidate {
  canonicalExecutablePath: string;
  canonicalDataRoot: string;
}

const execFileAsync = promisify(execFile);

function canonicalClassIslandExecutable(
  executablePath: string,
  platform: SupportedPlatform,
  exists: (candidate: string) => boolean
): string {
  if (platform !== "win32") return executablePath;
  const api = path.win32;
  const normalized = executablePath.trim().replace(/^"(.*)"$/, "$1");
  if (api.basename(normalized).toLowerCase() === WINDOWS_CLASSISLAND_EXE.toLowerCase()) return normalized;

  let directory = api.dirname(normalized);
  for (let depth = 0; depth < 6; depth++) {
    const launcher = api.join(directory, WINDOWS_CLASSISLAND_EXE);
    if (exists(launcher)) return launcher;
    const parent = api.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return normalized;
}

function isClassIslandRuntimeProcess(processInfo: ClassIslandRunningProcess): boolean {
  return (processInfo.processName || path.win32.basename(processInfo.executablePath)).toLowerCase() === WINDOWS_CLASSISLAND_RUNTIME_EXE.toLowerCase();
}

function potentialExecutablePaths(input: string, platform: SupportedPlatform): string[] {
  const api = platformPath(platform);
  const normalizedInput = input.trim().replace(/,\d+$/, "").replace(/^"(.*)"$/, "$1");
  if (api.extname(normalizedInput).toLowerCase() === (platform === "win32" ? ".exe" : "")) return [normalizedInput];
  if (platform === "darwin" && normalizedInput.endsWith(".app")) return [api.join(normalizedInput, "Contents", "MacOS", "ClassIsland")];
  return platform === "win32" ? [api.join(normalizedInput, WINDOWS_CLASSISLAND_EXE), api.join(normalizedInput, "ClassIsland", WINDOWS_CLASSISLAND_EXE)] : [api.join(normalizedInput, "ClassIsland")];
}

function staticExecutablePaths(platform: SupportedPlatform, home: string, env: NodeJS.ProcessEnv): string[] {
  const api = platformPath(platform);
  if (platform === "darwin") {
    return [
      "/Applications/ClassIsland.app/Contents/MacOS/ClassIsland",
      api.join(home, "Applications", "ClassIsland.app", "Contents", "MacOS", "ClassIsland")
    ];
  }
  if (platform !== "win32") return [api.join(home, "ClassIsland", "ClassIsland")];
  const local = env.LOCALAPPDATA || api.join(home, "AppData", "Local");
  const roaming = env.APPDATA || api.join(home, "AppData", "Roaming");
  const programFiles = env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const roots = [
    local,
    api.join(local, "Programs"),
    roaming,
    programFiles,
    programFilesX86,
    home,
    api.join(home, "Desktop"),
    api.join(home, "Downloads")
  ];
  return roots.flatMap((root) => [
    api.join(root, WINDOWS_CLASSISLAND_EXE),
    api.join(root, "ClassIsland", WINDOWS_CLASSISLAND_EXE),
    api.join(root, "ClassIsland", "ClassIsland", WINDOWS_CLASSISLAND_EXE)
  ]);
}

function readPackageType(executablePath: string, platform: SupportedPlatform, env: NodeJS.ProcessEnv, readFile: (filePath: string) => string): { packageRoot: string; packageType?: string } {
  const api = platformPath(platform);
  const executableDirectory = api.dirname(executablePath);
  const overrideRoot = env.ClassIsland_PackageRoot?.trim();
  if (overrideRoot) {
    const typePath = api.join(overrideRoot, "PackageType");
    try { return { packageRoot: api.resolve(overrideRoot), packageType: readFile(typePath).trim() || undefined }; } catch { return { packageRoot: api.resolve(overrideRoot) }; }
  }
  for (const [packageRoot, typePath] of [[executableDirectory, api.join(executableDirectory, "PackageType")], [api.dirname(executableDirectory), api.join(api.dirname(executableDirectory), "PackageType")]] as const) {
    try {
      const packageType = readFile(typePath).replace(/[\r\n]/g, "").trim();
      if (packageType) return { packageRoot: api.resolve(packageRoot), packageType };
    } catch { /* Try the other packaging marker. */ }
  }
  return { packageRoot: api.resolve(executableDirectory) };
}

export function resolveClassIslandLayout(executablePath: string, options: { platform?: SupportedPlatform; home?: string; env?: NodeJS.ProcessEnv; readFile?: (filePath: string) => string } = {}): ResolvedClassIslandLayout {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const readFile = options.readFile || defaultReadFile;
  const marker = readPackageType(executablePath, platform, env, readFile);
  const portable = marker.packageType?.toLowerCase() === "folder";
  const appData = platform === "win32"
    ? env.APPDATA || api.join(home, "AppData", "Roaming")
    : platform === "darwin"
      ? api.join(home, "Library", "Application Support")
      : env.XDG_CONFIG_HOME || api.join(home, ".config");
  const dataRoot = portable
    ? api.join(marker.packageRoot, "data")
    : ["installer", "deb", "appimage", "pkg", "msix"].includes(marker.packageType?.toLowerCase() || "") || platform === "darwin"
      ? api.join(appData, "ClassIsland", "Data")
      : marker.packageRoot;
  return { packageRoot: marker.packageRoot, dataRoot, pluginPackagesPath: api.join(dataRoot, "Cache", "PluginPackages"), ...(marker.packageType ? { packageType: marker.packageType } : {}) };
}

function installedPluginVersion(dataRoot: string, platform: SupportedPlatform, exists: (candidate: string) => boolean, readFile: (filePath: string) => string): string | undefined {
  const api = platformPath(platform);
  const pluginPath = api.join(dataRoot, "Plugins", CLASSISLAND_PLUGIN_ID);
  const manifestPath = api.join(pluginPath, "manifest.yml");
  if (!exists(manifestPath)) return undefined;
  if (exists(api.join(pluginPath, ".disabled")) || exists(api.join(pluginPath, ".uninstall"))) return undefined;
  try {
    const manifest = readFile(manifestPath);
    if (CLASSISLAND_PLUGIN_ID_PATTERN.exec(manifest)?.[1]?.trim().toLowerCase() !== CLASSISLAND_PLUGIN_ID) return undefined;
    const entranceAssembly = CLASSISLAND_PLUGIN_ENTRANCE_PATTERN.exec(manifest)?.[1]?.trim();
    if (!entranceAssembly || entranceAssembly.includes("..") || entranceAssembly.includes("/") || entranceAssembly.includes("\\")) return undefined;
    if (!exists(api.join(pluginPath, entranceAssembly))) return undefined;
    return CLASSISLAND_PLUGIN_VERSION_PATTERN.exec(manifest)?.[1]?.trim();
  } catch { return undefined; }
}

interface PluginHealthResult {
  healthy: boolean;
  reason: string;
  status?: number;
}

async function probeClassIslandPluginDetailed(fetcher: Fetcher): Promise<PluginHealthResult> {
  try {
    const response = await fetcher(CLASSISLAND_HEALTH_URL, { signal: AbortSignal.timeout(1_500), headers: { Accept: "application/json" } });
    if (!response.ok) return { healthy: false, reason: `健康检查返回 HTTP ${response.status}`, status: response.status };
    const payload = await response.json() as { apiVersion?: unknown; name?: unknown; status?: unknown };
    if (payload.apiVersion === 1 && payload.name === "classisland" && payload.status === "ok") return { healthy: true, reason: "ok", status: response.status };
    return { healthy: false, reason: "健康检查返回内容不匹配", status: response.status };
  } catch { return { healthy: false, reason: "健康检查服务未响应" }; }
}

async function probeClassIslandPlugin(fetcher: Fetcher): Promise<boolean> {
  return (await probeClassIslandPluginDetailed(fetcher)).healthy;
}

// A cold ClassIsland start takes ~12s on a slow machine before its plugin
// health endpoint answers, so the wait must comfortably exceed that.
async function waitForClassIslandHealth(fetcher: Fetcher, timeoutMs = 45_000, pollMs = 250): Promise<PluginHealthResult> {
  const deadline = Date.now() + timeoutMs;
  let last: PluginHealthResult = { healthy: false, reason: "健康检查服务未响应" };
  while (true) {
    last = await probeClassIslandPluginDetailed(fetcher);
    if (last.healthy) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export function compareClassIslandVersions(left: string, right: string): number {
  return compareVersions(left, right);
}

export function isCompatibleClassIslandVersion(version: string | undefined): boolean {
  return Boolean(version && compareClassIslandVersions(version, MIN_CLASSISLAND_VERSION) >= 0);
}

export async function discoverClassIslandInstallations(options: ClassIslandDiscoveryOptions = {}): Promise<ClassIslandInstallCandidate[]> {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const exists = options.exists || defaultExists;
  const readFile = options.readFile || defaultReadFile;
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const fetcher = options.fetcher;
  const runningProcesses = options.runningProcesses || await discoverRunningProcesses(platform, commandRunner, [WINDOWS_CLASSISLAND_EXE, WINDOWS_CLASSISLAND_RUNTIME_EXE]);
  const running = runningProcesses.map((processInfo) => ({
    ...processInfo,
    executablePath: canonicalClassIslandExecutable(processInfo.executablePath, platform, exists)
  }));
  const externalPaths = platform === "win32" && !options.executablePaths?.length && !options.runningProcesses ? await discoverWindowsExternalPaths(commandRunner, env, {
      displayNameFilter: "-like '*ClassIsland*'",
      targetPathPattern: "(?i)ClassIsland"
    }) : [];
  const inputPaths = [
    ...staticExecutablePaths(platform, home, env),
    ...(options.executablePaths || []),
    ...externalPaths.flatMap((item) => potentialExecutablePaths(item, platform)),
    ...running.map((item) => item.executablePath)
  ];
  const candidates = new Map<string, CachedCandidate>();
  const runningByPath = new Map<string, ClassIslandRunningProcess>();
  const runningPidsByPath = new Map<string, number[]>();
  for (const item of running) {
    const key = normalizePath(item.executablePath, platform);
    const pids = runningPidsByPath.get(key) || [];
    if (!pids.includes(item.pid)) pids.push(item.pid);
    runningPidsByPath.set(key, pids);
    const previous = runningByPath.get(key);
    if (!previous || (isClassIslandRuntimeProcess(item) && !isClassIslandRuntimeProcess(previous))) runningByPath.set(key, item);
  }
  const runningByName = new Map<string, ClassIslandRunningProcess>();
  for (const item of running) {
    if (/[\\/]/.test(item.executablePath)) continue;
    const key = api.basename(item.executablePath).toLowerCase();
    const previous = runningByName.get(key);
    if (!previous || (isClassIslandRuntimeProcess(item) && !isClassIslandRuntimeProcess(previous))) runningByName.set(key, item);
  }
  const versionOf = options.versionOf || ((executablePath: string) => defaultVersionOf(executablePath, platform, commandRunner));
  for (const executablePath of [...new Set(inputPaths.map((item) => api.normalize(item)))]) {
    if (!exists(executablePath)) continue;
    const processInfo = runningByPath.get(normalizePath(executablePath, platform)) || runningByName.get(api.basename(executablePath).toLowerCase());
    const version = processInfo?.version || await versionOf(executablePath);
    const layout = resolveClassIslandLayout(executablePath, { platform, home, env, readFile });
    const compatible = isCompatibleClassIslandVersion(version);
    const installedVersion = installedPluginVersion(layout.dataRoot, platform, exists, readFile);
    const pluginHealthy = processInfo && fetcher ? await probeClassIslandPlugin(fetcher) : undefined;
    const processIds = processInfo ? runningPidsByPath.get(normalizePath(executablePath, platform)) : undefined;
    const candidate: CachedCandidate = {
      id: hashId(executablePath, layout.dataRoot, platform),
      executablePath,
      rootPath: layout.packageRoot,
      dataRoot: layout.dataRoot,
      pluginPackagesPath: layout.pluginPackagesPath,
      ...(version ? { version } : {}),
      ...(installedVersion ? { installedPluginVersion: installedVersion } : {}),
      ...(pluginHealthy !== undefined ? { pluginHealthy } : {}),
      ...(layout.packageType ? { packageType: layout.packageType } : {}),
      isRunning: Boolean(processInfo),
      ...(processInfo ? { pid: processInfo.pid, launchArgs: parseWindowsCommandLine(processInfo.commandLine).slice(1) } : { launchArgs: [] }),
      ...(processIds?.length ? { processIds: [...processIds] } : {}),
      source: processInfo ? "running-process" : options.executablePaths?.includes(executablePath) ? "manual-or-explicit" : "discovery",
      compatible,
      ...(compatible ? {} : { reason: version ? `ClassIsland 版本过低，需要 ${MIN_CLASSISLAND_VERSION} 及以上` : "无法确认 ClassIsland 版本，请选择可识别的 ClassIsland.exe" }),
      canonicalExecutablePath: normalizePath(executablePath, platform),
      canonicalDataRoot: normalizePath(layout.dataRoot, platform)
    };
    const key = `${candidate.canonicalExecutablePath}\0${candidate.canonicalDataRoot}`;
    const previous = candidates.get(key);
    if (!previous || (!previous.isRunning && candidate.isRunning)) candidates.set(key, candidate);
  }
  return [...candidates.values()].map(({ canonicalExecutablePath: _executable, canonicalDataRoot: _data, ...candidate }) => candidate);
}

function isClassIslandPluginReady(candidate: ClassIslandInstallCandidate): boolean {
  return Boolean(candidate.installedPluginVersion && (!candidate.isRunning || candidate.pluginHealthy === true));
}

/** ClassIsland's `--waitMutex` makes a duplicate instance WAIT for the
 *  single-instance mutex instead of exiting. Inheriting it on restart turns any
 *  surviving mutex owner into a silent, forever-blocked process that never
 *  reaches plugin loading. Every other argument is preserved. */
function classIslandRestartArgs(args: string[]): string[] {
  return args.filter((arg) => !/^--?waitmutex$/i.test(arg) && !/^-m$/i.test(arg));
}

export class ClassIslandInstaller {
  private candidates = new Map<string, ClassIslandInstallCandidate>();
  private readonly platform: SupportedPlatform;
  private readonly fetcher: Fetcher;
  private readonly commandRunner: CommandRunner;
  private readonly options: ClassIslandInstallerOptions;

  constructor(options: ClassIslandInstallerOptions = {}) {
    this.options = options;
    this.platform = options.platform || process.platform;
    this.fetcher = options.fetcher || fetch;
    this.commandRunner = options.commandRunner || defaultCommandRunner;
  }

  async detect(): Promise<ClassIslandInstallCandidate[]> {
    const discovered = await discoverClassIslandInstallations({ ...this.options, fetcher: this.fetcher, commandRunner: this.commandRunner, platform: this.platform, executablePaths: [...(this.options.executablePaths || []), ...[...this.candidates.values()].map((candidate) => candidate.executablePath)] });
    this.candidates = new Map(discovered.map((candidate) => [candidate.id, candidate]));
    return discovered;
  }

  async inspect(executablePath: string): Promise<ClassIslandInstallCandidate | undefined> {
    const discovered = await discoverClassIslandInstallations({ ...this.options, fetcher: this.fetcher, commandRunner: this.commandRunner, platform: this.platform, executablePaths: [executablePath] });
    const candidate = discovered[0];
    if (candidate) this.candidates.set(candidate.id, candidate);
    return candidate;
  }

  async install(targetIds: string[], onProgress?: (progress: ClassIslandInstallProgress) => void, executor?: CompanionExecutor): Promise<ClassIslandInstallResult[]> {
    const latestCandidates = await this.detect();
    const selected = latestCandidates.filter((candidate) => targetIds.includes(candidate.id));
    const missing = targetIds.filter((id) => !selected.some((candidate) => candidate.id === id)).map((targetId) => ({ targetId, ok: false, action: "failed" as const, message: "找不到 ClassIsland 安装目标，请重新检测" }));
    if (!selected.length) return missing;
    const invalid = selected.filter((candidate) => !candidate.compatible);
    const valid = selected.filter((candidate) => candidate.compatible);
    const results: ClassIslandInstallResult[] = invalid.map((candidate) => ({ targetId: candidate.id, ok: false, action: "skipped", message: candidate.reason || "ClassIsland 版本不兼容" }));
    if (!valid.length) return [...results, ...missing];

    const report = (phase: ClassIslandInstallPhase, message?: string, percent?: number) => {
      const phasePercent = percent ?? ({ downloading: 18, verifying: 38, installing: 62, closing: 72, restarting: 80 } as const)[phase];
      onProgress?.({ phase, targetIds, percent: phasePercent, ...(message ? { message } : {}) });
    };
    const log = (stage: string, data: unknown = {}) => this.options.log?.(`companion.classisland.${stage}`, data);
    log("install.begin", { targetIds, candidates: selected.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, dataRoot: candidate.dataRoot, pluginPackagesPath: candidate.pluginPackagesPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, pluginHealthy: candidate.pluginHealthy, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds })) });
    const packageData = await downloadLatestCompanionPlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log("download.attempt", attempt), CLASSISLAND_DOWNLOAD_SPEC);
    log("download.success", { version: packageData.version, bytes: packageData.bytes.length, sha256: packageData.sha256, repository: CLASSISLAND_PLUGIN_REPOSITORY, asset: CLASSISLAND_PLUGIN_ASSET_NAME });
    const api = platformPath(this.platform);
    // Restart with the same token as SecAgent. A normal SecAgent uses the
    // interactive-shell broker; an administrator-launched SecAgent starts the
    // companion directly with the administrator token.
    const restart = this.options.restartProcess || ((executablePath: string, args: string[]) =>
      startCompanionProcessWithSameElevation(executablePath, args, this.platform, (stage, data) => log(stage, data)));
    const isRunning = this.options.isProcessRunning || ((pid: number) => executor ? executor.isProcessRunning(pid, (stage, data) => log(stage, data)) : defaultIsProcessRunning(pid));
    const requestClose = this.options.requestGracefulClose || ((pid: number) => executor ? executor.requestGracefulClose(pid, (stage, data) => log(stage, data)) : defaultRequestGracefulClose(pid, this.platform, this.commandRunner));
    const forceTerminate = this.options.forceTerminateProcess || ((pid: number) => executor ? executor.forceTerminate(pid, (stage, data) => log(stage, data)) : defaultForceTerminate(pid, this.platform, this.commandRunner));
    const gracefulCloseTimeoutMs = this.options.gracefulCloseTimeoutMs ?? 2_000;
    const restartArgsOf = (candidate: ClassIslandInstallCandidate) => classIslandRestartArgs(candidate.launchArgs);
    const exists = this.options.exists || defaultExists;
    const readFile = this.options.readFile || defaultReadFile;
    const installPackage = this.options.installPackage || ((destinationPath: string, bytes: Buffer, spec: CompanionPackageSpec) =>
      installCompanionPackage(destinationPath, bytes, spec, this.platform, executor, (stage, data) => log(stage, data)));
    // The first detection can be several seconds old after downloading the
    // package. Refresh immediately before touching the plugin directory so a
    // ClassIsland instance started during the download is also closed
    // automatically instead of racing the package replacement.
    let currentValid = valid;
    try {
      const refreshed = await this.detect();
      const refreshedById = new Map(refreshed.map((candidate) => [candidate.id, candidate]));
      currentValid = valid.map((candidate) => refreshedById.get(candidate.id) || candidate);
      log("process.refresh.result", { candidates: currentValid.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds })) });
    } catch (error) {
      log("process.refresh.failed", { error: error instanceof Error ? error.message : String(error) });
    }
    const groups = new Map<string, ClassIslandInstallCandidate[]>();
    for (const candidate of currentValid) {
      const key = normalizePath(candidate.dataRoot, this.platform);
      groups.set(key, [...(groups.get(key) || []), candidate]);
    }
    for (const group of groups.values()) {
      log("group.begin", { dataRoot: group[0].dataRoot, targets: group.map((candidate) => candidate.id), pluginPackagesPath: group[0].pluginPackagesPath });
      const alreadyInstalled = group.every((candidate) => isClassIslandPluginReady(candidate) && compareClassIslandVersions(candidate.installedPluginVersion!, packageData.version) >= 0);
      if (alreadyInstalled) {
        for (const candidate of group) results.push({ targetId: candidate.id, ok: true, action: "already-installed", message: `已安装 ClassIsland 插件 v${packageData.version}`, version: packageData.version });
        continue;
      }
      const pluginPath = api.join(group[0].dataRoot, "Plugins", CLASSISLAND_PLUGIN_ID);
      // Write the plugin BEFORE closing ClassIsland. ClassIsland scans the plugin
      // directory only at startup, so files written up front are picked up by
      // whichever instance starts next — including one relaunched by anything
      // other than SecAgent. If the write fails (e.g. the currently-loaded plugin
      // files are locked), fall back to the close-then-write order below.
      let preinstalled = false;
      try {
        report("installing", "正在写入 ClassIsland 插件文件");
        const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: CLASSISLAND_PLUGIN_ID, manifestFileName: "manifest.yml" });
        preinstalled = true;
        log("package.preinstall.result", { requestedPath: pluginPath, actualPluginPath, hostRunning: group.some((candidate) => candidate.isRunning) });
      } catch (error) {
        log("package.preinstall.failed", { requestedPath: pluginPath, error: error instanceof Error ? error.message : String(error) });
      }
      const running = group.flatMap((candidate) => {
        const processIds = candidate.processIds?.length ? candidate.processIds : candidate.pid === undefined ? [] : [candidate.pid];
        return processIds.map((pid) => ({ candidate, pid }));
      }).filter((item, index, all) => all.findIndex((other) => other.pid === item.pid) === index);
      // Close EVERY process of the installation, not only the pids detection
      // attached. An elevated ClassIsland.Desktop.exe is invisible to the
      // non-elevated scan (null Win32_Process.ExecutablePath), survives a
      // launcher-only kill, and keeps the Global\ClassIsland.Lock mutex — after
      // which no restarted instance can ever load the plugin.
      const processFilter: HostProcessFilter = {
        names: [WINDOWS_CLASSISLAND_EXE, WINDOWS_CLASSISLAND_RUNTIME_EXE],
        roots: [...new Set(group.map((candidate) => api.dirname(candidate.executablePath)))]
      };
      const listProcesses = this.options.listProcesses
        ? (filter: HostProcessFilter) => this.options.listProcesses!(filter)
        : (filter: HostProcessFilter) => enumerateHostProcesses(filter, this.platform, executor, this.commandRunner, (stage, data) => log(stage, data));
      const closeOutcome = await closeHostProcesses({
        hostLabel: "ClassIsland",
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
          await restart(candidate.executablePath, restartArgsOf(candidate)).catch(() => undefined);
        }
        for (const candidate of group) results.push({
          targetId: candidate.id,
          ok: false,
          action: "failed",
          message: closeOutcome.remaining.length
            ? `ClassIsland 进程 ${closeOutcome.remaining.map((item) => item.pid).join("、")} 无法退出（${closeOutcome.remaining.map((item) => item.name || item.executablePath || `pid ${item.pid}`).join("、")}），请手动关闭后重试`
            : preinstalled
              ? "插件文件已写入，但 ClassIsland 无法自动退出；请手动重启 ClassIsland 后重新检测"
              : "ClassIsland 无法退出，强制结束也失败，未安装插件；请手动关闭后重试"
        });
        continue;
      }
      try {
        if (!preinstalled) {
          report("installing", "正在解压安装 ClassIsland 插件");
          const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: CLASSISLAND_PLUGIN_ID, manifestFileName: "manifest.yml" });
          log("package.install.result", { requestedPath: pluginPath, actualPluginPath });
        }
        const launchCandidate = closed[0]?.candidate || group[0];
        // "重启" vs "启动": the host was running when we started, even if its
        // process died between detection and the close loop.
        const restarting = running.length > 0;
        const launchArgs = restartArgsOf(launchCandidate);
        report("restarting", restarting ? "正在重新启动 ClassIsland" : "正在启动 ClassIsland");
        log("process.restart.begin", { executablePath: launchCandidate.executablePath, args: launchArgs, inheritedArgs: launchCandidate.launchArgs, wasRunning: restarting, closedPids: closed.map((item) => item.pid) });
        let launchFailed = false;
        try { await restart(launchCandidate.executablePath, launchArgs); log("process.restart.success", { executablePath: launchCandidate.executablePath, args: launchArgs }); }
        catch (error) { launchFailed = true; log("process.restart.failed", { executablePath: launchCandidate.executablePath, error: error instanceof Error ? error.message : String(error) }); }
        if (!launchFailed) report("verifying", "正在等待 ClassIsland 插件响应", 94);
        const writtenVersion = installedPluginVersion(group[0].dataRoot, this.platform, exists, readFile);
        const verifiedVersion = launchFailed ? undefined : await waitForInstalledPlugin(
          () => installedPluginVersion(group[0].dataRoot, this.platform, exists, readFile),
          packageData.version,
          this.options.waitForPluginTimeoutMs,
          this.options.waitForPluginPollMs
        );
        const health = launchFailed
          ? { healthy: false, reason: "对方软件未成功启动" }
          : await waitForClassIslandHealth(this.fetcher, this.options.waitForPluginTimeoutMs, this.options.waitForPluginPollMs);
        const pluginHealthy = health.healthy;
        const verified = Boolean(verifiedVersion) && pluginHealthy;
        const detectedVersion = verified ? verifiedVersion : writtenVersion;
        // Diagnostic snapshot: which ClassIsland processes exist after the
        // restart (launcher, real ClassIsland.Desktop.exe app, or a duplicate
        // still stuck on the single-instance mutex).
        try {
          const snapshot = await listProcesses(processFilter);
          log("process.post-restart.snapshot", { processes: snapshot });
        } catch { /* Diagnostic only. */ }
        log("verification.result", { expectedVersion: packageData.version, writtenVersion, verifiedVersion, detectedVersion, pluginHealthy, healthReason: health.reason, healthStatus: health.status, healthUrl: CLASSISLAND_HEALTH_URL, verified, launchFailed });
        for (const candidate of group) {
          results.push({
            targetId: candidate.id,
            ok: !launchFailed && verified,
            action: !launchFailed && verified ? "installed" : "failed",
            message: launchFailed
              ? `插件包已写入，但 ClassIsland 自动${restarting ? "重启" : "启动"}失败，请手动启动`
              : verified
                ? restarting ? `已安装 ClassIsland 插件 v${verifiedVersion}，ClassIsland 已自动重启` : `已安装 ClassIsland 插件 v${verifiedVersion}，ClassIsland 已自动启动`
                : verifiedVersion
                  ? `插件文件已写入，但 ClassIsland 尚未加载插件（${health.reason}），请重试或手动重启 ClassIsland`
                  : `插件已解压并启动，但未检测到 ClassIsland 插件（${health.reason}），请查看诊断日志后重试`,
            ...(verified && detectedVersion ? { version: detectedVersion } : {})
          });
        }
      } catch (error) {
        log("install.failed", { error: error instanceof Error ? error.message : String(error) });
        const restarted = new Set<string>();
        for (const { candidate } of closed) {
          if (restarted.has(candidate.id)) continue;
          restarted.add(candidate.id);
          await restart(candidate.executablePath, restartArgsOf(candidate)).catch(() => undefined);
        }
        for (const candidate of group) results.push({ targetId: candidate.id, ok: false, action: "failed", message: `安装 ClassIsland 插件失败：${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return [...results, ...missing];
  }
}

export { DEFAULT_MARKETPLACE_PROXY_URL, parseWindowsCommandLine };
