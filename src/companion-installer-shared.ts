/**
 * 伴随软件安装器共享内核（B1-2）。
 *
 * classisland/classwidgets/iccce/secrandom 四安装器经 B0 审计确认：
 * 辅助函数 13 个四文件逐字一致，5 个仅差常量注入。本模块由
 * gen-shared.py 从 classwidgets.ts 机械提取生成（函数体零手改，
 * 仅参数化替换），各安装器保留平台特有逻辑。
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_MARKETPLACE_PROXY_URL, describeDownloadAttempt, marketplaceRequestUrls, type DownloadAttemptLogger } from "./marketplace.js";

export type SupportedPlatform = NodeJS.Platform;
export type PathApi = typeof path.win32;
export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface CompanionReleaseMetadata {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string; digest: string }>;
}

export interface DiscoveredProcess {
  executablePath: string;
  pid: number;
  commandLine?: string;
  version?: string;
  processName?: string;
}

export interface CompanionDownloadSpec {
  productName: string;
  releaseApiUrl: string;
  releasePageUrl: string;
  repository: string;
  assetName: string;
  maxBytes: number;
}

const execFileAsync = promisify(execFile);

export function platformPath(platform: SupportedPlatform): PathApi {
  return platform === "win32" ? path.win32 : path.posix;
}

export function normalizePath(value: string, platform: SupportedPlatform): string {
  const api = platformPath(platform);
  const normalized = api.normalize(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function hashId(executablePath: string, rootPath: string, platform: SupportedPlatform): string {
  return crypto.createHash("sha256").update(`${normalizePath(executablePath, platform)}\0${normalizePath(rootPath, platform)}`).digest("hex").slice(0, 20);
}

export function defaultExists(candidate: string): boolean {
  try { return fs.existsSync(candidate); } catch { return false; }
}

export function defaultReadFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

export function defaultCommandRunner(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).then((result) => ({ stdout: result.stdout, stderr: result.stderr }));
}

export function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function parseJsonList(output: string): string[] {
  if (!output.trim()) return [];
  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    return typeof parsed === "string" ? [parsed] : [];
  } catch {
    return [];
  }
}

export async function discoverWindowsExternalPaths(commandRunner: CommandRunner, env: NodeJS.ProcessEnv, patterns: { displayNameFilter: string; targetPathPattern: string }): Promise<string[]> {
  const registryScript = String.raw`
$keys = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$result = Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and $_.DisplayName ${patterns.displayNameFilter} } |
  ForEach-Object { @($_.InstallLocation, ($_.DisplayIcon -replace ',\d+$', '')) } |
  Where-Object { $_ -and $_.ToString().Trim() }
@($result) | ConvertTo-Json -Compress
`;
  const shortcutRoots = [
    path.win32.join(env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.win32.join(env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.win32.join(env.USERPROFILE || "", "Desktop")
  ];
  const shortcutScript = String.raw`
$roots = @(${shortcutRoots.map(quotePowerShell).join(",")})
$shell = New-Object -ComObject WScript.Shell
$result = Get-ChildItem -Path $roots -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
  ForEach-Object {
    try {
      $shortcut = $shell.CreateShortcut($_.FullName)
      if ($shortcut.TargetPath -match '${patterns.targetPathPattern}') { $shortcut.TargetPath }
    } catch { }
  }
@($result) | ConvertTo-Json -Compress
`;
  const paths: string[] = [];
  try {
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", registryScript]);
    paths.push(...parseJsonList(result.stdout));
  } catch { /* Registry access is best effort. */ }
  try {
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", shortcutScript]);
    paths.push(...parseJsonList(result.stdout));
  } catch { /* Shortcut access is best effort. */ }
  return paths;
}

export async function discoverRunningProcesses(platform: SupportedPlatform, commandRunner: CommandRunner, exeNames: string[]): Promise<DiscoveredProcess[]> {
  if (platform !== "win32") return [];
  const script = String.raw`
$names = @('${exeNames.join("', '")}')
Get-CimInstance Win32_Process |
  Where-Object { $names -contains $_.Name } |
  ForEach-Object {
    $version = $null
    try { $version = (Get-Item -LiteralPath $_.ExecutablePath).VersionInfo.ProductVersion } catch { }
    [pscustomobject]@{
      executablePath = if ($_.ExecutablePath) { [string]$_.ExecutablePath } else { [string]$_.Name }
      pid = [int]$_.ProcessId
      commandLine = $_.CommandLine
      version = $version
      processName = [string]$_.Name
    }
  } | ConvertTo-Json -Compress
`;
  try {
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    if (!result.stdout.trim()) return [];
    const raw = JSON.parse(result.stdout) as unknown;
    const items = Array.isArray(raw) ? raw : [raw];
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record.executablePath !== "string" || typeof record.pid !== "number") return [];
      return [{ executablePath: record.executablePath, pid: record.pid, ...(typeof record.commandLine === "string" ? { commandLine: record.commandLine } : {}), ...(typeof record.version === "string" ? { version: record.version } : {}), ...(typeof record.processName === "string" ? { processName: record.processName } : {}) }];
    });
  } catch {
    return [];
  }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function releaseTagFromPage(url: string | undefined, html: string): string | undefined {
  const candidates = [url || "", ...(html.match(/\/releases\/tag\/[^\s"'<]+/gi) || [])];
  for (const candidate of candidates) {
    const match = candidate.match(/\/releases\/tag\/([^/?#"'<]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return undefined;
}

export function releaseAssetFromExpandedPage(html: string, assetName: string): CompanionReleaseMetadata["assets"][number] | undefined {
  const blocks = html.match(/<li\b[\s\S]*?<\/li>/gi) || [];
  for (const block of blocks) {
    if (!new RegExp(`>${escapeRegExp(assetName)}<`, "i").test(block)) continue;
    const href = block.match(/href=["']([^"']+\/releases\/download\/[^"']+)["']/i)?.[1]?.replaceAll("&amp;", "&");
    const digest = block.match(/sha256:([a-f0-9]{64})/i)?.[1];
    if (!href || !digest) continue;
    const browserDownloadUrl = new URL(href, "https://github.com").toString();
    if (new URL(browserDownloadUrl).hostname !== "github.com") continue;
    return { name: assetName, browser_download_url: browserDownloadUrl, digest: `sha256:${digest}` };
  }
  return undefined;
}

export async function fetchReleasePageMetadata(fetcher: Fetcher, now: () => number, releasePageUrl: string, repository: string, assetName: string): Promise<CompanionReleaseMetadata | undefined> {
  let lastError: unknown;
  for (const pageUrl of marketplaceRequestUrls(`${releasePageUrl}?secagent_cache=${now()}`)) {
    try {
      const response = await fetcher(pageUrl, { signal: AbortSignal.timeout(12_000), headers: { Accept: "text/html", "User-Agent": "SecAgent" } });
      if (!response.ok) { lastError = new Error(`HTTP ${response.status}`); continue; }
      const html = await response.text();
      const tag = releaseTagFromPage(response.url, html);
      if (!tag) { lastError = new Error("GitHub Release 页面缺少版本标签"); continue; }
      const expandedUrl = `https://github.com/${repository}/releases/expanded_assets/${encodeURIComponent(tag)}?secagent_cache=${now()}`;
      for (const assetsUrl of marketplaceRequestUrls(expandedUrl)) {
        try {
          const assetsResponse = await fetcher(assetsUrl, { signal: AbortSignal.timeout(12_000), headers: { Accept: "text/html", "User-Agent": "SecAgent" } });
          if (!assetsResponse.ok) { lastError = new Error(`HTTP ${assetsResponse.status}`); continue; }
          const asset = releaseAssetFromExpandedPage(await assetsResponse.text(), assetName);
          if (asset) return { tag_name: tag, assets: [asset] };
          lastError = new Error(`Release 页面缺少 ${assetName} 或 SHA-256`);
        } catch (error) { lastError = error; }
      }
    } catch (error) { lastError = error; }
  }
  return undefined;
}

export function parseWindowsCommandLine(commandLine: string | undefined): string[] {
  if (!commandLine?.trim()) return [];
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let slashCount = 0;
  const pushSlashes = (count: number) => { current += "\\".repeat(count); };
  for (let index = 0; index < commandLine.length; index++) {
    const char = commandLine[index];
    if (char === "\\") { slashCount++; continue; }
    if (char === '"') {
      pushSlashes(Math.floor(slashCount / 2));
      if (slashCount % 2 === 1) current += '"';
      else quoted = !quoted;
      slashCount = 0;
      continue;
    }
    pushSlashes(slashCount);
    slashCount = 0;
    if (/\s/.test(char) && !quoted) {
      if (current) { args.push(current); current = ""; }
    } else current += char;
  }
  pushSlashes(slashCount);
  if (current) args.push(current);
  return args;
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.trim().replace(/^v/i, "").split(/[.+-]/).map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export async function waitForInstalledPlugin(
  readVersion: () => string | undefined,
  expectedVersion: string,
  timeoutMs = 15_000,
  pollMs = 250
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const current = readVersion();
    if (current && compareVersions(current, expectedVersion) >= 0) return current;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export async function defaultVersionOf(executablePath: string, platform: SupportedPlatform, commandRunner: CommandRunner): Promise<string | undefined> {
  if (platform === "win32") {
    const script = `$item = Get-Item -LiteralPath ${quotePowerShell(executablePath)}; $item.VersionInfo.ProductVersion`;
    try {
      const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
      return result.stdout.trim() || undefined;
    } catch { return undefined; }
  }
  if (platform === "darwin") {
    const api = path.posix;
    const appPath = executablePath.match(/^(.*?\.app)\/Contents\/MacOS\//i)?.[1];
    if (!appPath) return undefined;
    try {
      const result = await commandRunner("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", api.join(appPath, "Contents", "Info.plist")]);
      return result.stdout.trim() || undefined;
    } catch { return undefined; }
  }
  return undefined;
}

export async function downloadLatestCompanionPlugin<TPhase extends string>(fetcher: Fetcher, now: () => number, onProgress: ((phase: TPhase, message?: string) => void) | undefined, onRoute: DownloadAttemptLogger | undefined, spec: CompanionDownloadSpec): Promise<{ bytes: Buffer; version: string; sha256: string }> {
  onProgress?.("downloading", `正在通过 ghproxy.sectl.cn 下载最新 ${spec.productName} 插件`);
  let release: { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown } | undefined;
  let lastError: unknown;
  for (const directUrl of [spec.releaseApiUrl]) {
    const metadataCandidates = marketplaceRequestUrls(`${directUrl}?secagent_cache=${now()}`);
    for (let index = 0; index < metadataCandidates.length; index++) {
      const candidate = metadataCandidates[index];
      const startedAt = Date.now();
      try {
        const response = await fetcher(candidate, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/vnd.github+json", "User-Agent": "SecAgent" } });
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`);
          onRoute?.(describeDownloadAttempt("release-metadata", candidate, startedAt, { status: response.status, error: `HTTP ${response.status}` }, metadataCandidates.slice(index + 1)));
          continue;
        }
        const payload = await response.json() as typeof release;
        if (!payload || typeof payload.tag_name !== "string" || payload.draft === true || payload.prerelease === true || !Array.isArray(payload.assets)) {
          lastError = new Error("GitHub 最新 Release 信息无效");
          onRoute?.(describeDownloadAttempt("release-metadata", candidate, startedAt, { status: response.status, error: "GitHub 最新 Release 信息无效" }, metadataCandidates.slice(index + 1)));
          continue;
        }
        onRoute?.(describeDownloadAttempt("release-metadata", candidate, startedAt, { status: response.status }, []));
        release = payload;
        break;
      } catch (error) {
        lastError = error;
        onRoute?.(describeDownloadAttempt("release-metadata", candidate, startedAt, { error: error instanceof Error ? error.message : String(error) }, metadataCandidates.slice(index + 1)));
      }
    }
  }
  if (!release) {
    const pageRelease = await fetchReleasePageMetadata(fetcher, now, spec.releasePageUrl, spec.repository, spec.assetName);
    if (pageRelease) release = pageRelease;
  }
  if (!release) throw new Error(`无法读取 ${spec.productName} 最新 Release：${lastError instanceof Error ? lastError.message : String(lastError)}`);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return record.name === spec.assetName && typeof record.browser_download_url === "string";
  }) as Record<string, unknown> | undefined;
  if (!asset) throw new Error(`最新 ${spec.productName} Release 缺少 ${spec.assetName}`);
  const size = typeof asset.size === "number" ? asset.size : 0;
  if (size > spec.maxBytes) throw new Error(`${spec.productName} 插件包过大，已停止安装`);
  const digest = typeof asset.digest === "string" ? asset.digest.replace(/^sha256:/i, "") : "";
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error(`${spec.productName} Release 缺少有效的 SHA-256 校验值`);
  const downloadUrl = asset.browser_download_url as string;
  const packageCandidates = marketplaceRequestUrls(downloadUrl);
  for (let index = 0; index < packageCandidates.length; index++) {
    const candidate = packageCandidates[index];
    const startedAt = Date.now();
    try {
      const response = await fetcher(candidate, { signal: AbortSignal.timeout(60_000), headers: { "User-Agent": "SecAgent" } });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, error: `HTTP ${response.status}` }, packageCandidates.slice(index + 1)));
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > spec.maxBytes) {
        lastError = new Error(`${spec.productName} 插件包过大`);
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, error: `${spec.productName} 插件包过大` }, packageCandidates.slice(index + 1)));
        continue;
      }
      onProgress?.("verifying", `正在校验 ${spec.productName} 插件 SHA-256`);
      const actual = crypto.createHash("sha256").update(bytes).digest("hex");
      if (actual.toLowerCase() !== digest.toLowerCase()) {
        lastError = new Error(`${spec.productName} 插件 SHA-256 校验失败`);
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, sha256: actual, error: `SHA-256 校验失败，期望 ${digest}` }, packageCandidates.slice(index + 1)));
        continue;
      }
      onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, sha256: actual }, []));
      return { bytes, version: typeof release.tag_name === "string" ? release.tag_name : "unknown", sha256: actual };
    } catch (error) {
      lastError = error;
      onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { error: error instanceof Error ? error.message : String(error) }, packageCandidates.slice(index + 1)));
    }
  }
  throw new Error(`下载 ${spec.productName} 插件失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function defaultRequestGracefulClose(pid: number, platform: SupportedPlatform, commandRunner: CommandRunner): Promise<boolean> {
  if (platform === "win32") {
    const script = `$process = Get-Process -Id ${pid} -ErrorAction Stop; [bool]$process.CloseMainWindow()`;
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return result.stdout.trim().toLowerCase() !== "false";
  }
  process.kill(pid, "SIGTERM");
  return true;
}

export async function defaultForceTerminate(pid: number, platform: SupportedPlatform, commandRunner: CommandRunner): Promise<void> {
  if (platform === "win32") {
    const script = `Stop-Process -Id ${pid} -Force -ErrorAction Stop`;
    await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  }
  process.kill(pid, "SIGKILL");
}

export async function defaultIsProcessRunning(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
