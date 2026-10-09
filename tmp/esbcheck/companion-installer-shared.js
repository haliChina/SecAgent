import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describeDownloadAttempt, marketplaceRequestUrls } from "./marketplace.js";
const execFileAsync = promisify(execFile);
function platformPath(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}
function normalizePath(value, platform) {
  const api = platformPath(platform);
  const normalized = api.normalize(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}
function hashId(executablePath, rootPath, platform) {
  return crypto.createHash("sha256").update(`${normalizePath(executablePath, platform)}\0${normalizePath(rootPath, platform)}`).digest("hex").slice(0, 20);
}
function defaultExists(candidate) {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}
function defaultReadFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}
function defaultCommandRunner(file, args) {
  return execFileAsync(file, args, { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).then((result) => ({ stdout: result.stdout, stderr: result.stderr }));
}
function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
function parseJsonList(output) {
  if (!output.trim()) return [];
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === "string");
    return typeof parsed === "string" ? [parsed] : [];
  } catch {
    return [];
  }
}
async function discoverWindowsExternalPaths(commandRunner, env, patterns) {
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
  const paths = [];
  try {
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", registryScript]);
    paths.push(...parseJsonList(result.stdout));
  } catch {
  }
  try {
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", shortcutScript]);
    paths.push(...parseJsonList(result.stdout));
  } catch {
  }
  return paths;
}
async function discoverRunningProcesses(platform, commandRunner, exeNames) {
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
    const raw = JSON.parse(result.stdout);
    const items = Array.isArray(raw) ? raw : [raw];
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item;
      if (typeof record.executablePath !== "string" || typeof record.pid !== "number") return [];
      return [{ executablePath: record.executablePath, pid: record.pid, ...typeof record.commandLine === "string" ? { commandLine: record.commandLine } : {}, ...typeof record.version === "string" ? { version: record.version } : {}, ...typeof record.processName === "string" ? { processName: record.processName } : {} }];
    });
  } catch {
    return [];
  }
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function releaseTagFromPage(url, html) {
  const candidates = [url || "", ...html.match(/\/releases\/tag\/[^\s"'<]+/gi) || []];
  for (const candidate of candidates) {
    const match = candidate.match(/\/releases\/tag\/([^/?#"'<]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return void 0;
}
function releaseAssetFromExpandedPage(html, assetName) {
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
  return void 0;
}
async function fetchReleasePageMetadata(fetcher, now, releasePageUrl, repository, assetName) {
  let lastError;
  for (const pageUrl of marketplaceRequestUrls(`${releasePageUrl}?secagent_cache=${now()}`)) {
    try {
      const response = await fetcher(pageUrl, { signal: AbortSignal.timeout(12e3), headers: { Accept: "text/html", "User-Agent": "SecAgent" } });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const html = await response.text();
      const tag = releaseTagFromPage(response.url, html);
      if (!tag) {
        lastError = new Error("GitHub Release \u9875\u9762\u7F3A\u5C11\u7248\u672C\u6807\u7B7E");
        continue;
      }
      const expandedUrl = `https://github.com/${repository}/releases/expanded_assets/${encodeURIComponent(tag)}?secagent_cache=${now()}`;
      for (const assetsUrl of marketplaceRequestUrls(expandedUrl)) {
        try {
          const assetsResponse = await fetcher(assetsUrl, { signal: AbortSignal.timeout(12e3), headers: { Accept: "text/html", "User-Agent": "SecAgent" } });
          if (!assetsResponse.ok) {
            lastError = new Error(`HTTP ${assetsResponse.status}`);
            continue;
          }
          const asset = releaseAssetFromExpandedPage(await assetsResponse.text());
          if (asset) return { tag_name: tag, assets: [asset] };
          lastError = new Error(`Release \u9875\u9762\u7F3A\u5C11 ${assetName} \u6216 SHA-256`);
        } catch (error) {
          lastError = error;
        }
      }
    } catch (error) {
      lastError = error;
    }
  }
  return void 0;
}
function parseWindowsCommandLine(commandLine) {
  if (!commandLine?.trim()) return [];
  const args = [];
  let current = "";
  let quoted = false;
  let slashCount = 0;
  const pushSlashes = (count) => {
    current += "\\".repeat(count);
  };
  for (let index = 0; index < commandLine.length; index++) {
    const char = commandLine[index];
    if (char === "\\") {
      slashCount++;
      continue;
    }
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
      if (current) {
        args.push(current);
        current = "";
      }
    } else current += char;
  }
  pushSlashes(slashCount);
  if (current) args.push(current);
  return args;
}
function compareVersions(left, right) {
  const parse = (value) => value.trim().replace(/^v/i, "").split(/[.+-]/).map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}
async function waitForInstalledPlugin(readVersion, expectedVersion, timeoutMs = 15e3, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const current = readVersion();
    if (current && compareVersions(current, expectedVersion) >= 0) return current;
    if (Date.now() >= deadline) return void 0;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
async function defaultVersionOf(executablePath, platform, commandRunner) {
  if (platform === "win32") {
    const script = `$item = Get-Item -LiteralPath ${quotePowerShell(executablePath)}; $item.VersionInfo.ProductVersion`;
    try {
      const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
      return result.stdout.trim() || void 0;
    } catch {
      return void 0;
    }
  }
  if (platform === "darwin") {
    const api = path.posix;
    const appPath = executablePath.match(/^(.*?\.app)\/Contents\/MacOS\//i)?.[1];
    if (!appPath) return void 0;
    try {
      const result = await commandRunner("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", api.join(appPath, "Contents", "Info.plist")]);
      return result.stdout.trim() || void 0;
    } catch {
      return void 0;
    }
  }
  return void 0;
}
async function downloadLatestCompanionPlugin(fetcher, now, onProgress, onRoute, spec) {
  onProgress?.("downloading", `\u6B63\u5728\u901A\u8FC7 ghproxy.sectl.cn \u4E0B\u8F7D\u6700\u65B0 ${spec.productName} \u63D2\u4EF6`);
  let release;
  let lastError;
  for (const directUrl of [spec.releaseApiUrl]) {
    const metadataCandidates = marketplaceRequestUrls(`${directUrl}?secagent_cache=${now()}`);
    for (let index = 0; index < metadataCandidates.length; index++) {
      const candidate = metadataCandidates[index];
      const startedAt = Date.now();
      try {
        const response = await fetcher(candidate, { signal: AbortSignal.timeout(12e3), headers: { Accept: "application/vnd.github+json", "User-Agent": "SecAgent" } });
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status}`);
          onRoute?.(describeDownloadAttempt("release-metadata", candidate, startedAt, { status: response.status, error: `HTTP ${response.status}` }, metadataCandidates.slice(index + 1)));
          continue;
        }
        const payload = await response.json();
        if (!payload || typeof payload.tag_name !== "string" || payload.draft === true || payload.prerelease === true || !Array.isArray(payload.assets)) {
          lastError = new Error("GitHub \u6700\u65B0 Release \u4FE1\u606F\u65E0\u6548");
          onRoute?.(describeDownloadAttempt("release-metadata", candidate, startedAt, { status: response.status, error: "GitHub \u6700\u65B0 Release \u4FE1\u606F\u65E0\u6548" }, metadataCandidates.slice(index + 1)));
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
  if (!release) throw new Error(`\u65E0\u6CD5\u8BFB\u53D6 ${spec.productName} \u6700\u65B0 Release\uFF1A${lastError instanceof Error ? lastError.message : String(lastError)}`);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item;
    return record.name === spec.assetName && typeof record.browser_download_url === "string";
  });
  if (!asset) throw new Error(`\u6700\u65B0 ${spec.productName} Release \u7F3A\u5C11 ${spec.assetName}`);
  const size = typeof asset.size === "number" ? asset.size : 0;
  if (size > spec.maxBytes) throw new Error(`${spec.productName} \u63D2\u4EF6\u5305\u8FC7\u5927\uFF0C\u5DF2\u505C\u6B62\u5B89\u88C5`);
  const digest = typeof asset.digest === "string" ? asset.digest.replace(/^sha256:/i, "") : "";
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error(`${spec.productName} Release \u7F3A\u5C11\u6709\u6548\u7684 SHA-256 \u6821\u9A8C\u503C`);
  const downloadUrl = asset.browser_download_url;
  const packageCandidates = marketplaceRequestUrls(downloadUrl);
  for (let index = 0; index < packageCandidates.length; index++) {
    const candidate = packageCandidates[index];
    const startedAt = Date.now();
    try {
      const response = await fetcher(candidate, { signal: AbortSignal.timeout(6e4), headers: { "User-Agent": "SecAgent" } });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, error: `HTTP ${response.status}` }, packageCandidates.slice(index + 1)));
        continue;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > spec.maxBytes) {
        lastError = new Error(`${spec.productName} \u63D2\u4EF6\u5305\u8FC7\u5927`);
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, error: `${spec.productName} \u63D2\u4EF6\u5305\u8FC7\u5927` }, packageCandidates.slice(index + 1)));
        continue;
      }
      onProgress?.("verifying", `\u6B63\u5728\u6821\u9A8C ${spec.productName} \u63D2\u4EF6 SHA-256`);
      const actual = crypto.createHash("sha256").update(bytes).digest("hex");
      if (actual.toLowerCase() !== digest.toLowerCase()) {
        lastError = new Error(`${spec.productName} \u63D2\u4EF6 SHA-256 \u6821\u9A8C\u5931\u8D25`);
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, sha256: actual, error: `SHA-256 \u6821\u9A8C\u5931\u8D25\uFF0C\u671F\u671B ${digest}` }, packageCandidates.slice(index + 1)));
        continue;
      }
      onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, sha256: actual }, []));
      return { bytes, version: typeof release.tag_name === "string" ? release.tag_name : "unknown", sha256: actual };
    } catch (error) {
      lastError = error;
      onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { error: error instanceof Error ? error.message : String(error) }, packageCandidates.slice(index + 1)));
    }
  }
  throw new Error(`\u4E0B\u8F7D ${spec.productName} \u63D2\u4EF6\u5931\u8D25\uFF1A${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
async function defaultRequestGracefulClose(pid, platform, commandRunner) {
  if (platform === "win32") {
    const script = `$process = Get-Process -Id ${pid} -ErrorAction Stop; [bool]$process.CloseMainWindow()`;
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return result.stdout.trim().toLowerCase() !== "false";
  }
  process.kill(pid, "SIGTERM");
  return true;
}
async function defaultForceTerminate(pid, platform, commandRunner) {
  if (platform === "win32") {
    const script = `Stop-Process -Id ${pid} -Force -ErrorAction Stop`;
    await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  }
  process.kill(pid, "SIGKILL");
}
async function defaultIsProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export {
  compareVersions,
  defaultCommandRunner,
  defaultExists,
  defaultForceTerminate,
  defaultIsProcessRunning,
  defaultReadFile,
  defaultRequestGracefulClose,
  defaultVersionOf,
  discoverRunningProcesses,
  discoverWindowsExternalPaths,
  downloadLatestCompanionPlugin,
  escapeRegExp,
  fetchReleasePageMetadata,
  hashId,
  normalizePath,
  parseJsonList,
  parseWindowsCommandLine,
  platformPath,
  quotePowerShell,
  releaseAssetFromExpandedPage,
  releaseTagFromPage,
  waitForInstalledPlugin
};
