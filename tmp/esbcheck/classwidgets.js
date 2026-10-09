import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closeHostProcesses, enumerateHostProcesses, installCompanionPackage, startCompanionProcessWithSameElevation } from "./companion-package.js";
import { compareVersions, defaultCommandRunner, defaultExists, defaultForceTerminate, defaultIsProcessRunning, defaultReadFile, defaultRequestGracefulClose, defaultVersionOf, discoverRunningProcesses, discoverWindowsExternalPaths, downloadLatestCompanionPlugin, hashId, normalizePath, parseWindowsCommandLine, platformPath, waitForInstalledPlugin } from "./companion-installer-shared.js";
const CLASSWIDGETS_PLUGIN_REPOSITORY = "SECTL/ClassWidgets-SecAgent-Plugin";
const CLASSWIDGETS_PLUGIN_ID = "cn.sectl.secagent";
const CLASSWIDGETS_PLUGIN_ASSET_NAME = "cn.sectl.secagent.cwplugin";
const MIN_CLASSWIDGETS_VERSION = "2.0.0.0";
const CLASSWIDGETS_RELEASE_API_URL = `https://api.github.com/repos/${CLASSWIDGETS_PLUGIN_REPOSITORY}/releases/latest`;
const CLASSWIDGETS_DOWNLOAD_SPEC = {
  productName: "Class Widgets",
  releaseApiUrl: CLASSWIDGETS_RELEASE_API_URL,
  releasePageUrl: CLASSWIDGETS_RELEASE_PAGE_URL,
  repository: CLASSWIDGETS_PLUGIN_REPOSITORY,
  assetName: CLASSWIDGETS_PLUGIN_ASSET_NAME,
  maxBytes: MAX_CLASSWIDGETS_PLUGIN_BYTES
};
const CLASSWIDGETS_RELEASE_PAGE_URL = `https://github.com/${CLASSWIDGETS_PLUGIN_REPOSITORY}/releases/latest`;
const CLASSWIDGETS_PLUGIN_VERSION_PATTERN = /"version"\s*:\s*"([^"]+)"/i;
const CLASSWIDGETS_PLUGIN_ID_PATTERN = /"id"\s*:\s*"([^"]+)"/i;
const CLASSWIDGETS_PLUGIN_ENTRY_PATTERN = /"entry"\s*:\s*"([^"]+)"/i;
const WINDOWS_CLASSWIDGETS_EXE = "ClassWidgets.exe";
const MAX_CLASSWIDGETS_PLUGIN_BYTES = 100 * 1024 * 1024;
const CLASSWIDGETS_HEALTH_URL = "http://127.0.0.1:18791/health";
const execFileAsync = promisify(execFile);
function potentialExecutablePaths(input, platform) {
  const api = platformPath(platform);
  const normalizedInput = input.trim().replace(/,\d+$/, "").replace(/^"(.*)"$/, "$1");
  if (api.extname(normalizedInput).toLowerCase() === (platform === "win32" ? ".exe" : "")) return [normalizedInput];
  if (platform === "darwin" && normalizedInput.endsWith(".app")) return [api.join(normalizedInput, "Contents", "MacOS", "ClassWidgets")];
  return platform === "win32" ? [api.join(normalizedInput, WINDOWS_CLASSWIDGETS_EXE)] : [api.join(normalizedInput, "ClassWidgets")];
}
function staticExecutablePaths(platform, home, env) {
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
function resolveClassWidgetsLayout(executablePath, options = {}) {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const exists = options.exists || defaultExists;
  const packageRoot = api.resolve(api.dirname(executablePath));
  const portablePlugins = api.join(packageRoot, "plugins");
  if (exists(portablePlugins)) return { packageRoot, pluginsPath: portablePlugins };
  const roaming = platform === "win32" ? env.APPDATA || api.join(home, "AppData", "Roaming") : platform === "darwin" ? api.join(home, "Library", "Application Support") : env.XDG_DATA_HOME || api.join(home, ".local", "share");
  return { packageRoot, pluginsPath: api.join(roaming, "Class Widgets", "plugins") };
}
function installedPluginVersion(pluginsPath, platform, exists, readFile) {
  const api = platformPath(platform);
  const pluginPath = api.join(pluginsPath, CLASSWIDGETS_PLUGIN_ID);
  const manifestPath = api.join(pluginPath, "cwplugin.json");
  if (!exists(manifestPath)) return void 0;
  if (exists(api.join(pluginPath, ".disabled")) || exists(api.join(pluginPath, ".uninstall"))) return void 0;
  try {
    const manifest = readFile(manifestPath);
    if (CLASSWIDGETS_PLUGIN_ID_PATTERN.exec(manifest)?.[1]?.trim().toLowerCase() !== CLASSWIDGETS_PLUGIN_ID) return void 0;
    const entry = CLASSWIDGETS_PLUGIN_ENTRY_PATTERN.exec(manifest)?.[1]?.trim();
    if (!entry || entry.includes("..") || entry.includes("/") || entry.includes("\\")) return void 0;
    if (!exists(api.join(pluginPath, entry))) return void 0;
    return CLASSWIDGETS_PLUGIN_VERSION_PATTERN.exec(manifest)?.[1]?.trim();
  } catch {
    return void 0;
  }
}
async function probeClassWidgetsPluginDetailed(fetcher) {
  try {
    const response = await fetcher(CLASSWIDGETS_HEALTH_URL, { signal: AbortSignal.timeout(1500), headers: { Accept: "application/json" } });
    if (!response.ok) return { healthy: false, reason: `\u5065\u5EB7\u68C0\u67E5\u8FD4\u56DE HTTP ${response.status}`, status: response.status };
    const payload = await response.json();
    if (payload.apiVersion === 1 && payload.name === "classwidgets" && payload.status === "ok") return { healthy: true, reason: "ok", status: response.status };
    return { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u8FD4\u56DE\u5185\u5BB9\u4E0D\u5339\u914D", status: response.status };
  } catch {
    return { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u670D\u52A1\u672A\u54CD\u5E94" };
  }
}
async function waitForClassWidgetsHealth(fetcher, timeoutMs = 45e3, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u670D\u52A1\u672A\u54CD\u5E94" };
  while (true) {
    last = await probeClassWidgetsPluginDetailed(fetcher);
    if (last.healthy) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
function compareClassWidgetsVersions(left, right) {
  return compareVersions(left, right);
}
function isCompatibleClassWidgetsVersion(version) {
  return Boolean(version && compareClassWidgetsVersions(version, MIN_CLASSWIDGETS_VERSION) >= 0);
}
async function discoverClassWidgetsInstallations(options = {}) {
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
    ...options.executablePaths || [],
    ...externalPaths.flatMap((item) => potentialExecutablePaths(item, platform)),
    ...running.map((item) => item.executablePath)
  ];
  const candidates = /* @__PURE__ */ new Map();
  const runningByPath = /* @__PURE__ */ new Map();
  const runningPidsByPath = /* @__PURE__ */ new Map();
  for (const item of running) {
    const key = normalizePath(item.executablePath, platform);
    const pids = runningPidsByPath.get(key) || [];
    if (!pids.includes(item.pid)) pids.push(item.pid);
    runningPidsByPath.set(key, pids);
    if (!runningByPath.has(key)) runningByPath.set(key, item);
  }
  const versionOf = options.versionOf || ((executablePath) => defaultVersionOf(executablePath, platform, commandRunner));
  for (const executablePath of [...new Set(inputPaths.map((item) => api.normalize(item)))]) {
    if (!exists(executablePath)) continue;
    const processInfo = runningByPath.get(normalizePath(executablePath, platform));
    const version = processInfo?.version || await versionOf(executablePath);
    const layout = resolveClassWidgetsLayout(executablePath, { platform, home, env, exists });
    const compatible = isCompatibleClassWidgetsVersion(version);
    const installedVersion = installedPluginVersion(layout.pluginsPath, platform, exists, defaultReadFile);
    const processIds = processInfo ? runningPidsByPath.get(normalizePath(executablePath, platform)) : void 0;
    const candidate = {
      id: hashId(executablePath, layout.pluginsPath, platform),
      executablePath,
      rootPath: layout.packageRoot,
      pluginsPath: layout.pluginsPath,
      ...version ? { version } : {},
      ...installedVersion ? { installedPluginVersion: installedVersion } : {},
      isRunning: Boolean(processInfo),
      ...processInfo ? { pid: processInfo.pid, launchArgs: parseWindowsCommandLine(processInfo.commandLine).slice(1) } : { launchArgs: [] },
      ...processIds?.length ? { processIds: [...processIds] } : {},
      source: processInfo ? "running-process" : options.executablePaths?.includes(executablePath) ? "manual-or-explicit" : "discovery",
      compatible,
      ...compatible ? {} : { reason: version ? `Class Widgets \u7248\u672C\u8FC7\u4F4E\uFF0C\u9700\u8981 ${MIN_CLASSWIDGETS_VERSION} \u53CA\u4EE5\u4E0A` : "\u65E0\u6CD5\u786E\u8BA4 Class Widgets \u7248\u672C\uFF0C\u8BF7\u9009\u62E9\u53EF\u8BC6\u522B\u7684 ClassWidgets.exe" }
    };
    const key = `${normalizePath(executablePath, platform)}\0${normalizePath(layout.pluginsPath, platform)}`;
    const previous = candidates.get(key);
    if (!previous || !previous.isRunning && candidate.isRunning) candidates.set(key, candidate);
  }
  return [...candidates.values()];
}
function isClassWidgetsPluginReady(candidate) {
  return Boolean(candidate.installedPluginVersion && (!candidate.isRunning || candidate.pluginHealthy === true));
}
class ClassWidgetsInstaller {
  candidates = /* @__PURE__ */ new Map();
  platform;
  fetcher;
  commandRunner;
  options;
  constructor(options = {}) {
    this.options = options;
    this.platform = options.platform || process.platform;
    this.fetcher = options.fetcher || fetch;
    this.commandRunner = options.commandRunner || defaultCommandRunner;
  }
  async detect() {
    const discovered = await discoverClassWidgetsInstallations({ ...this.options, platform: this.platform, executablePaths: [...this.options.executablePaths || [], ...[...this.candidates.values()].map((candidate) => candidate.executablePath)] });
    this.candidates = new Map(discovered.map((candidate) => [candidate.id, candidate]));
    return discovered;
  }
  async inspect(executablePath) {
    const discovered = await discoverClassWidgetsInstallations({ ...this.options, platform: this.platform, executablePaths: [executablePath] });
    const candidate = discovered[0];
    if (candidate) this.candidates.set(candidate.id, candidate);
    return candidate;
  }
  async install(targetIds, onProgress, executor) {
    const latestCandidates = await this.detect();
    const selected = latestCandidates.filter((candidate) => targetIds.includes(candidate.id));
    const missing = targetIds.filter((id) => !selected.some((candidate) => candidate.id === id)).map((targetId) => ({ targetId, ok: false, action: "failed", message: "\u627E\u4E0D\u5230 Class Widgets \u5B89\u88C5\u76EE\u6807\uFF0C\u8BF7\u91CD\u65B0\u68C0\u6D4B" }));
    if (!selected.length) return missing;
    const invalid = selected.filter((candidate) => !candidate.compatible);
    const valid = selected.filter((candidate) => candidate.compatible);
    const results = invalid.map((candidate) => ({ targetId: candidate.id, ok: false, action: "skipped", message: candidate.reason || "Class Widgets \u7248\u672C\u4E0D\u517C\u5BB9" }));
    if (!valid.length) return [...results, ...missing];
    const report = (phase, message, percent) => {
      const phasePercent = percent ?? { downloading: 18, verifying: 38, installing: 62, closing: 72, restarting: 80 }[phase];
      onProgress?.({ phase, targetIds, percent: phasePercent, ...message ? { message } : {} });
    };
    const log = (stage, data = {}) => this.options.log?.(`companion.classwidgets.${stage}`, data);
    log("install.begin", { targetIds, candidates: selected.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, pluginsPath: candidate.pluginsPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds })) });
    const packageData = await downloadLatestCompanionPlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log("download.attempt", attempt), CLASSWIDGETS_DOWNLOAD_SPEC);
    log("download.success", { version: packageData.version, bytes: packageData.bytes.length, sha256: packageData.sha256, repository: CLASSWIDGETS_PLUGIN_REPOSITORY, asset: CLASSWIDGETS_PLUGIN_ASSET_NAME });
    const api = platformPath(this.platform);
    const restart = this.options.restartProcess || ((executablePath, args) => startCompanionProcessWithSameElevation(executablePath, args, this.platform, (stage, data) => log(stage, data)));
    const isRunning = this.options.isProcessRunning || ((pid) => executor ? executor.isProcessRunning(pid, (stage, data) => log(stage, data)) : defaultIsProcessRunning(pid));
    const requestClose = this.options.requestGracefulClose || ((pid) => executor ? executor.requestGracefulClose(pid, (stage, data) => log(stage, data)) : defaultRequestGracefulClose(pid, this.platform, this.commandRunner));
    const forceTerminate = this.options.forceTerminateProcess || ((pid) => executor ? executor.forceTerminate(pid, (stage, data) => log(stage, data)) : defaultForceTerminate(pid, this.platform, this.commandRunner));
    const gracefulCloseTimeoutMs = this.options.gracefulCloseTimeoutMs ?? 2e3;
    const exists = this.options.exists || defaultExists;
    const installPackage = this.options.installPackage || ((destinationPath, bytes, spec) => installCompanionPackage(destinationPath, bytes, spec, this.platform, executor, (stage, data) => log(stage, data)));
    let currentValid = valid;
    try {
      const refreshed = await this.detect();
      const refreshedById = new Map(refreshed.map((candidate) => [candidate.id, candidate]));
      currentValid = valid.map((candidate) => refreshedById.get(candidate.id) || candidate);
      log("process.refresh.result", { candidates: currentValid.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds })) });
    } catch (error) {
      log("process.refresh.failed", { error: error instanceof Error ? error.message : String(error) });
    }
    const groups = /* @__PURE__ */ new Map();
    for (const candidate of currentValid) {
      const key = normalizePath(candidate.pluginsPath, this.platform);
      groups.set(key, [...groups.get(key) || [], candidate]);
    }
    for (const group of groups.values()) {
      log("group.begin", { pluginsPath: group[0].pluginsPath, targets: group.map((candidate) => candidate.id) });
      const alreadyInstalled = group.every((candidate) => isClassWidgetsPluginReady(candidate) && candidate.installedPluginVersion && compareClassWidgetsVersions(candidate.installedPluginVersion, packageData.version) >= 0);
      if (alreadyInstalled) {
        for (const candidate of group) results.push({ targetId: candidate.id, ok: true, action: "already-installed", message: `\u5DF2\u5B89\u88C5 Class Widgets \u63D2\u4EF6 v${packageData.version}`, version: packageData.version });
        continue;
      }
      const pluginPath = api.join(group[0].pluginsPath, CLASSWIDGETS_PLUGIN_ID);
      let preinstalled = false;
      try {
        report("installing", "\u6B63\u5728\u5199\u5165 Class Widgets \u63D2\u4EF6\u6587\u4EF6");
        const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: CLASSWIDGETS_PLUGIN_ID, manifestFileName: "cwplugin.json" });
        preinstalled = true;
        log("package.preinstall.result", { requestedPath: pluginPath, actualPluginPath, hostRunning: group.some((candidate) => candidate.isRunning) });
      } catch (error) {
        log("package.preinstall.failed", { requestedPath: pluginPath, error: error instanceof Error ? error.message : String(error) });
      }
      const running = group.flatMap((candidate) => {
        const processIds = candidate.processIds?.length ? candidate.processIds : candidate.pid === void 0 ? [] : [candidate.pid];
        return processIds.map((pid) => ({ candidate, pid }));
      }).filter((item, index, all) => all.findIndex((other) => other.pid === item.pid) === index);
      const processFilter = {
        names: [WINDOWS_CLASSWIDGETS_EXE],
        roots: [...new Set(group.map((candidate) => api.dirname(candidate.executablePath)))]
      };
      const listProcesses = this.options.listProcesses ? (filter) => this.options.listProcesses(filter) : (filter) => enumerateHostProcesses(filter, this.platform, executor, this.commandRunner, (stage, data) => log(stage, data));
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
        const restarted = /* @__PURE__ */ new Set();
        for (const { candidate } of closed) {
          if (restarted.has(candidate.id)) continue;
          restarted.add(candidate.id);
          await restart(candidate.executablePath, candidate.launchArgs).catch(() => void 0);
        }
        for (const candidate of group) results.push({
          targetId: candidate.id,
          ok: false,
          action: "failed",
          message: closeOutcome.remaining.length ? `Class Widgets \u8FDB\u7A0B ${closeOutcome.remaining.map((item) => item.pid).join("\u3001")} \u65E0\u6CD5\u9000\u51FA\uFF08${closeOutcome.remaining.map((item) => item.name || item.executablePath || `pid ${item.pid}`).join("\u3001")}\uFF09\uFF0C\u8BF7\u624B\u52A8\u5173\u95ED\u540E\u91CD\u8BD5` : preinstalled ? "\u63D2\u4EF6\u6587\u4EF6\u5DF2\u5199\u5165\uFF0C\u4F46 Class Widgets \u65E0\u6CD5\u81EA\u52A8\u9000\u51FA\uFF1B\u8BF7\u624B\u52A8\u91CD\u542F Class Widgets \u540E\u91CD\u65B0\u68C0\u6D4B" : "Class Widgets \u65E0\u6CD5\u9000\u51FA\uFF0C\u5F3A\u5236\u7ED3\u675F\u4E5F\u5931\u8D25\uFF0C\u672A\u5B89\u88C5\u63D2\u4EF6\uFF1B\u8BF7\u624B\u52A8\u5173\u95ED\u540E\u91CD\u8BD5"
        });
        continue;
      }
      try {
        if (!preinstalled) {
          report("installing", "\u6B63\u5728\u89E3\u538B\u5B89\u88C5 Class Widgets \u63D2\u4EF6");
          const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: CLASSWIDGETS_PLUGIN_ID, manifestFileName: "cwplugin.json" });
          log("package.install.result", { requestedPath: pluginPath, actualPluginPath });
        }
        const launchCandidate = closed[0]?.candidate || group[0];
        const restarting = running.length > 0;
        const launchArgs = launchCandidate.launchArgs;
        report("restarting", restarting ? "\u6B63\u5728\u91CD\u65B0\u542F\u52A8 Class Widgets" : "\u6B63\u5728\u542F\u52A8 Class Widgets");
        log("process.restart.begin", { executablePath: launchCandidate.executablePath, args: launchArgs, inheritedArgs: launchCandidate.launchArgs, wasRunning: restarting, closedPids: closed.map((item) => item.pid) });
        let launchFailed = false;
        try {
          await restart(launchCandidate.executablePath, launchArgs);
          log("process.restart.success", { executablePath: launchCandidate.executablePath, args: launchArgs });
        } catch (error) {
          launchFailed = true;
          log("process.restart.failed", { executablePath: launchCandidate.executablePath, error: error instanceof Error ? error.message : String(error) });
        }
        if (!launchFailed) report("verifying", "\u6B63\u5728\u7B49\u5F85 Class Widgets \u63D2\u4EF6\u54CD\u5E94", 94);
        const writtenVersion = installedPluginVersion(group[0].pluginsPath, this.platform, exists, defaultReadFile);
        const verifiedVersion = launchFailed ? void 0 : await waitForInstalledPlugin(
          () => installedPluginVersion(group[0].pluginsPath, this.platform, exists, defaultReadFile),
          packageData.version,
          this.options.waitForPluginTimeoutMs,
          this.options.waitForPluginPollMs,
          compareClassWidgetsVersions
        );
        const health = launchFailed ? { healthy: false, reason: "\u5BF9\u65B9\u8F6F\u4EF6\u672A\u6210\u529F\u542F\u52A8" } : await waitForClassWidgetsHealth(this.fetcher, this.options.waitForPluginTimeoutMs, this.options.waitForPluginPollMs);
        const pluginHealthy = health.healthy;
        const verified = Boolean(verifiedVersion) && pluginHealthy;
        const detectedVersion = verified ? verifiedVersion : writtenVersion;
        log("verification.result", { expectedVersion: packageData.version, writtenVersion, verifiedVersion, detectedVersion, pluginHealthy, healthReason: health.reason, healthStatus: health.status, healthUrl: CLASSWIDGETS_HEALTH_URL, verified, launchFailed });
        for (const candidate of group) {
          results.push({
            targetId: candidate.id,
            ok: !launchFailed && verified,
            action: !launchFailed && verified ? "installed" : "failed",
            message: launchFailed ? `\u63D2\u4EF6\u5305\u5DF2\u5199\u5165\uFF0C\u4F46 Class Widgets \u81EA\u52A8${restarting ? "\u91CD\u542F" : "\u542F\u52A8"}\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u542F\u52A8` : verified ? restarting ? `\u5DF2\u5B89\u88C5 Class Widgets \u63D2\u4EF6 v${verifiedVersion}\uFF0CClass Widgets \u5DF2\u81EA\u52A8\u91CD\u542F` : `\u5DF2\u5B89\u88C5 Class Widgets \u63D2\u4EF6 v${verifiedVersion}\uFF0CClass Widgets \u5DF2\u81EA\u52A8\u542F\u52A8` : verifiedVersion ? `\u63D2\u4EF6\u6587\u4EF6\u5DF2\u5199\u5165\uFF0C\u4F46 Class Widgets \u5C1A\u672A\u52A0\u8F7D\u63D2\u4EF6\uFF08${health.reason}\uFF09\uFF0C\u8BF7\u91CD\u8BD5\u6216\u624B\u52A8\u91CD\u542F Class Widgets` : `\u63D2\u4EF6\u5DF2\u89E3\u538B\u5E76\u542F\u52A8\uFF0C\u4F46\u672A\u68C0\u6D4B\u5230 Class Widgets \u63D2\u4EF6\uFF08${health.reason}\uFF09\uFF0C\u8BF7\u67E5\u770B\u8BCA\u65AD\u65E5\u5FD7\u540E\u91CD\u8BD5`,
            ...verified && detectedVersion ? { version: detectedVersion } : {}
          });
        }
      } catch (error) {
        log("install.failed", { error: error instanceof Error ? error.message : String(error) });
        const restarted = /* @__PURE__ */ new Set();
        for (const { candidate } of closed) {
          if (restarted.has(candidate.id)) continue;
          restarted.add(candidate.id);
          await restart(candidate.executablePath, candidate.launchArgs).catch(() => void 0);
        }
        for (const candidate of group) results.push({ targetId: candidate.id, ok: false, action: "failed", message: `\u5B89\u88C5 Class Widgets \u63D2\u4EF6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return [...results, ...missing];
  }
}
export {
  CLASSWIDGETS_DOWNLOAD_SPEC,
  CLASSWIDGETS_PLUGIN_ASSET_NAME,
  CLASSWIDGETS_PLUGIN_ID,
  CLASSWIDGETS_PLUGIN_REPOSITORY,
  CLASSWIDGETS_RELEASE_API_URL,
  ClassWidgetsInstaller,
  MIN_CLASSWIDGETS_VERSION,
  compareClassWidgetsVersions,
  discoverClassWidgetsInstallations,
  isCompatibleClassWidgetsVersion,
  resolveClassWidgetsLayout
};
