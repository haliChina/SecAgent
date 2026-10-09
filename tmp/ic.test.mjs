// src/iccce.test.ts
import assert from "node:assert/strict";
import crypto4 from "node:crypto";
import fs4 from "node:fs";
import os3 from "node:os";
import path4 from "node:path";
import test from "node:test";

// src/iccce.ts
import crypto3 from "node:crypto";
import fs3 from "node:fs";
import os2 from "node:os";
import path3 from "node:path";
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify3 } from "node:util";

// src/marketplace.ts
var DEFAULT_MARKETPLACE_PROXY_URL = "https://ghproxy.sectl.cn";
var RELEASE_CACHE_TTL_MS = 10 * 60 * 1e3;
function marketplaceRequestUrls(directUrl) {
  if (!/^https:\/\/(?:api\.github\.com|github\.com|raw\.githubusercontent\.com)\//i.test(directUrl)) return [directUrl];
  return [`${DEFAULT_MARKETPLACE_PROXY_URL}/${directUrl}`, directUrl];
}
function downloadRouteOfUrl(url) {
  return url.startsWith(DEFAULT_MARKETPLACE_PROXY_URL) ? "proxy" : "direct";
}
function describeDownloadAttempt(stage, url, startedAt, outcome, remainingCandidates) {
  const record = {
    stage,
    route: downloadRouteOfUrl(url),
    url,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...outcome.status !== void 0 ? { status: outcome.status } : {},
    ...outcome.bytes !== void 0 ? { bytes: outcome.bytes } : {},
    ...outcome.sha256 !== void 0 ? { sha256: outcome.sha256 } : {},
    ...outcome.error !== void 0 ? { error: outcome.error } : {}
  };
  const next = remainingCandidates[0];
  if (outcome.error !== void 0 && next) record.fallbackTo = downloadRouteOfUrl(next);
  return record;
}
function parseVersion(value) {
  const match = value.trim().replace(/^v/i, "").match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return void 0;
  return { core: match[1].split(".").map(Number), pre: match[2] ? match[2].split(".") : [] };
}
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return left === right ? 0 : left.localeCompare(right, void 0, { numeric: true });
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const difference = (a.core[i] || 0) - (b.core[i] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === void 0) return -1;
    if (b.pre[i] === void 0) return 1;
    if (a.pre[i] === b.pre[i]) continue;
    const aNumber = /^\d+$/.test(a.pre[i]);
    const bNumber = /^\d+$/.test(b.pre[i]);
    if (aNumber && bNumber) return Number(a.pre[i]) > Number(b.pre[i]) ? 1 : -1;
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    return a.pre[i].localeCompare(b.pre[i]);
  }
  return 0;
}

// src/companion-package.ts
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
var execFileAsync = promisify(execFile);
var windowsElevationPromise;
function writeLog(logger, stage, data = {}) {
  try {
    logger?.(stage, data);
  } catch {
  }
}
function pathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}
function encodePowerShell(command) {
  return Buffer.from(command, "utf16le").toString("base64");
}
function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
function compactProcessError(error) {
  if (!error || typeof error !== "object") return String(error);
  const record = error;
  const message = typeof record.message === "string" ? record.message : String(error);
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  const detail = stderr.replace(/<Objs[\s\S]*?<\/Objs>/gi, "").replace(/\s+/g, " ").trim();
  const safeMessage = message.startsWith("Command failed:") ? "PowerShell \u547D\u4EE4\u6267\u884C\u5931\u8D25" : message;
  const text = detail && !safeMessage.includes(detail) ? `${safeMessage}: ${detail}` : safeMessage;
  return text.slice(0, 2e3);
}
async function getWindowsProcessElevation(logger) {
  if (process.platform !== "win32") return false;
  if (!windowsElevationPromise) {
    const command = [
      "$identity = [Security.Principal.WindowsIdentity]::GetCurrent()",
      "$principal = New-Object Security.Principal.WindowsPrincipal($identity)",
      "$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
    ].join(";\n");
    windowsElevationPromise = execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NoLogo",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodePowerShell(command)
    ], { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).then((result) => {
      const match = result.stdout.trim().match(/(true|false)\s*$/i);
      if (!match) throw new Error("\u65E0\u6CD5\u89E3\u6790\u5F53\u524D\u8FDB\u7A0B\u6743\u9650\u72B6\u6001");
      const elevated = match[1].toLowerCase() === "true";
      writeLog(logger, "process.elevation.detected", { elevated });
      return elevated;
    }).catch((error) => {
      writeLog(logger, "process.elevation.failed", { error: compactProcessError(error) });
      return void 0;
    });
  }
  return windowsElevationPromise;
}
async function isWindowsProcessElevated(logger) {
  return await getWindowsProcessElevation(logger) === true;
}
function isPathInside(candidate, root, platform) {
  const api = pathApi(platform);
  const normalizedCandidate = api.normalize(candidate).replace(/[\\/]$/, "").toLowerCase();
  const normalizedRoot = api.normalize(root).replace(/[\\/]$/, "").toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${api.sep}`);
}
function likelyProtectedWindowsPath(filePath) {
  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.WINDIR,
    process.env.SystemRoot
  ].filter((value) => Boolean(value));
  return roots.some((root) => isPathInside(filePath, root, "win32"));
}
function manifestValue(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^\\s*${escaped}\\s*:\\s*["']?([^"'\\r\\n#]+)`, "im"))?.[1]?.trim();
}
function validateCompanionPackage(bytes, spec) {
  if (!spec.pluginId || /[\\/]/.test(spec.pluginId) || spec.pluginId === "." || spec.pluginId === "..")
    throw new Error("\u63D2\u4EF6 ID \u65E0\u6548");
  const zip = new AdmZip(bytes);
  const entries = zip.getEntries();
  if (!entries.length) throw new Error("\u63D2\u4EF6\u5305\u4E3A\u7A7A");
  for (const entry of entries) {
    const name = entry.entryName.replaceAll("\\", "/");
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").includes(".."))
      throw new Error(`\u63D2\u4EF6\u5305\u5305\u542B\u4E0D\u5B89\u5168\u8DEF\u5F84: ${entry.entryName}`);
  }
  const manifestEntry = zip.getEntry(spec.manifestFileName);
  if (!manifestEntry) throw new Error(`\u63D2\u4EF6\u5305\u7F3A\u5C11 ${spec.manifestFileName}`);
  const manifestText = manifestEntry.getData().toString("utf8");
  let id;
  let entranceAssembly;
  if (spec.manifestFileName.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(manifestText);
    const readString = (...keys) => keys.map((key) => parsed[key]).find((value) => typeof value === "string")?.trim();
    id = readString("Id", "id");
    entranceAssembly = readString("EntranceAssembly", "entranceAssembly", "entry");
  } else {
    id = manifestValue(manifestText, "id");
    entranceAssembly = manifestValue(manifestText, "entranceAssembly");
  }
  if (!id || id.toLowerCase() !== spec.pluginId.toLowerCase()) throw new Error(`\u63D2\u4EF6\u5305\u6E05\u5355 ID \u4E0D\u5339\u914D: ${id || "\u7F3A\u5931"}`);
  if (!entranceAssembly) throw new Error("\u63D2\u4EF6\u5305\u6E05\u5355\u7F3A\u5C11\u5165\u53E3\u7A0B\u5E8F\u96C6");
  const normalizedEntrance = entranceAssembly.replaceAll("\\", "/");
  if (!entries.some((entry) => entry.entryName.replaceAll("\\", "/") === normalizedEntrance))
    throw new Error(`\u63D2\u4EF6\u5305\u7F3A\u5C11\u5165\u53E3\u7A0B\u5E8F\u96C6: ${entranceAssembly}`);
  return zip;
}
function installDirectPackage(destinationPath, bytes, spec, platform, logger) {
  const api = pathApi(platform);
  const destination = api.resolve(destinationPath);
  const parent = api.dirname(destination);
  const staging = api.join(parent, `.${api.basename(destination)}.${crypto.randomUUID()}.installing`);
  const backup = api.join(parent, `.${api.basename(destination)}.${crypto.randomUUID()}.backup`);
  const zip = validateCompanionPackage(bytes, spec);
  let movedExisting = false;
  writeLog(logger, "package.install.direct.begin", { destination, pluginId: spec.pluginId, bytes: bytes.length });
  try {
    fs.mkdirSync(parent, { recursive: true });
    zip.extractAllTo(staging, true);
    const disabledPath = api.join(destination, ".disabled");
    const wasDisabled = fs.existsSync(disabledPath);
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      movedExisting = true;
    }
    fs.renameSync(staging, destination);
    if (wasDisabled) fs.writeFileSync(api.join(destination, ".disabled"), "", "utf8");
    if (movedExisting) fs.rmSync(backup, { recursive: true, force: true });
    writeLog(logger, "package.install.direct.success", { destination, pluginId: spec.pluginId });
    return destination;
  } catch (error) {
    try {
      if (fs.existsSync(destination) && movedExisting) fs.rmSync(destination, { recursive: true, force: true });
      if (movedExisting && fs.existsSync(backup)) fs.renameSync(backup, destination);
    } catch (restoreError) {
      writeLog(logger, "package.install.direct.restore.failed", { destination, error: restoreError instanceof Error ? restoreError.message : String(restoreError) });
    }
    writeLog(logger, "package.install.direct.failed", { destination, pluginId: spec.pluginId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (movedExisting && fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  }
}
var ENUMERATE_PROCESSES_PS = String.raw`
$matched = @()
foreach ($enumProcess in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
  $enumExePath = [string]$enumProcess.ExecutablePath
  $isMatch = $false
  if ($enumExePath) {
    foreach ($enumRoot in $roots) {
      if ($enumExePath.Equals($enumRoot, [System.StringComparison]::OrdinalIgnoreCase) -or $enumExePath.StartsWith($enumRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) { $isMatch = $true; break }
    }
  } else {
    $isMatch = $names -contains ([string]$enumProcess.Name)
  }
  if ($isMatch) {
    $matched += @{ pid = [int]$enumProcess.ProcessId; name = [string]$enumProcess.Name; executablePath = $enumExePath; commandLine = [string]$enumProcess.CommandLine }
  }
}
`;
var ELEVATED_WORKER_SCRIPT = String.raw`
param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'Stop'
$readyPath = Join-Path $Root 'ready'
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false

function Write-JsonFile([string]$Path, [object]$Value) {
  $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
  try {
    [System.IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Compress -Depth 8), $utf8)
    [System.IO.File]::Move($temporary, $Path)
  } finally {
    if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
  }
}

function Write-Result([string]$Id, [object]$Value) {
  Write-JsonFile (Join-Path $Root "result-$Id.json") $Value
}

New-Item -ItemType Directory -Force -Path $Root | Out-Null
[System.IO.File]::WriteAllText($readyPath, [DateTime]::UtcNow.ToString('o'), $utf8)

while ($true) {
  $requests = @(Get-ChildItem -LiteralPath $Root -Filter 'request-*.json' -File -ErrorAction SilentlyContinue | Sort-Object Name)
  foreach ($request in $requests) {
    $id = [System.IO.Path]::GetFileNameWithoutExtension($request.Name).Substring(8)
    $response = $null
    $shutdown = $false
    try {
      $body = Get-Content -LiteralPath $request.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
      switch ([string]$body.action) {
        'write' {
          $source = [string]$body.data.source
          $destination = [string]$body.data.destination
          $directory = [System.IO.Path]::GetDirectoryName($destination)
          if ([string]::IsNullOrWhiteSpace($directory)) { throw '目标目录无效' }
          [System.IO.Directory]::CreateDirectory($directory) | Out-Null
          $staged = [System.IO.Path]::Combine($directory, '.' + [System.IO.Path]::GetFileName($destination) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
          [System.IO.File]::Copy($source, $staged, $true)
          $installed = $false
          for ($attempt = 0; $attempt -lt 20; $attempt++) {
            try {
              if ([System.IO.File]::Exists($destination)) { [System.IO.File]::Delete($destination) }
              [System.IO.File]::Move($staged, $destination)
              $installed = $true
              break
            } catch {
              if ($attempt -eq 19) { break }
              Start-Sleep -Milliseconds (250 + ($attempt * 250))
            }
          }
          if ($installed) {
            $response = @{ ok = $true; actualPath = $destination }
          } else {
            $extension = [System.IO.Path]::GetExtension($destination)
            $fallback = [System.IO.Path]::Combine($directory, [System.IO.Path]::GetFileNameWithoutExtension($destination) + '.' + [guid]::NewGuid().ToString('N') + $extension)
            [System.IO.File]::Copy($source, $fallback, $false)
            $response = @{ ok = $true; actualPath = $fallback; fallback = $true }
          }
          if ([System.IO.File]::Exists($staged)) { [System.IO.File]::Delete($staged) }
        }
        'install-package' {
          Add-Type -AssemblyName System.IO.Compression.FileSystem
          $source = [string]$body.data.source
          $destination = [System.IO.Path]::GetFullPath([string]$body.data.destination)
          $manifestName = [string]$body.data.manifestFileName
          $directory = [System.IO.Path]::GetDirectoryName($destination)
          if ([string]::IsNullOrWhiteSpace($directory)) { throw '目标插件目录无效' }
          [System.IO.Directory]::CreateDirectory($directory) | Out-Null
          $staged = [System.IO.Path]::Combine($directory, '.' + [System.IO.Path]::GetFileName($destination) + '.' + [guid]::NewGuid().ToString('N') + '.installing')
          $backup = [System.IO.Path]::Combine($directory, '.' + [System.IO.Path]::GetFileName($destination) + '.' + [guid]::NewGuid().ToString('N') + '.backup')
          $movedExisting = $false
          try {
            [System.IO.Directory]::CreateDirectory($staged) | Out-Null
            [System.IO.Compression.ZipFile]::ExtractToDirectory($source, $staged)
            $manifestPath = [System.IO.Path]::Combine($staged, $manifestName)
            if (-not [System.IO.File]::Exists($manifestPath)) { throw "插件包缺少 $manifestName" }
            $disabledPath = [System.IO.Path]::Combine($destination, '.disabled')
            $wasDisabled = [System.IO.File]::Exists($disabledPath)
            if ([System.IO.Directory]::Exists($destination)) {
              [System.IO.Directory]::Move($destination, $backup)
              $movedExisting = $true
            } elseif ([System.IO.File]::Exists($destination)) {
              throw '插件目标路径不是目录'
            }
            [System.IO.Directory]::Move($staged, $destination)
            if ($wasDisabled) { [System.IO.File]::WriteAllText([System.IO.Path]::Combine($destination, '.disabled'), '') }
            if ($movedExisting -and [System.IO.Directory]::Exists($backup)) { [System.IO.Directory]::Delete($backup, $true) }
            $response = @{ ok = $true; actualPath = $destination }
          } catch {
            try {
              if ([System.IO.Directory]::Exists($destination) -and $movedExisting) { [System.IO.Directory]::Delete($destination, $true) }
              if ($movedExisting -and [System.IO.Directory]::Exists($backup)) { [System.IO.Directory]::Move($backup, $destination) }
            } catch { }
            throw
          } finally {
            if ([System.IO.Directory]::Exists($staged)) { [System.IO.Directory]::Delete($staged, $true) }
            if ($movedExisting -and [System.IO.Directory]::Exists($backup)) { [System.IO.Directory]::Delete($backup, $true) }
          }
        }
        'close' {
          $process = Get-Process -Id ([int]$body.data.pid) -ErrorAction Stop
          $response = @{ ok = $true; accepted = [bool]$process.CloseMainWindow() }
        }
        'terminate' {
          Stop-Process -Id ([int]$body.data.pid) -Force -ErrorAction Stop
          $response = @{ ok = $true }
        }
        'is-running' {
          $running = $true
          try { Get-Process -Id ([int]$body.data.pid) -ErrorAction Stop | Out-Null } catch { $running = $false }
          $response = @{ ok = $true; running = $running }
        }
        'enumerate' {
          $roots = @($body.data.roots | ForEach-Object { [string]$_ } | Where-Object { $_ })
          $names = @($body.data.names | ForEach-Object { [string]$_ } | Where-Object { $_ })
{{ENUMERATE_PROCESSES_PS}}
          $response = @{ ok = $true; processes = $matched }
        }
        'start' {
          $executablePath = [string]$body.data.executablePath
          $workingDirectory = [System.IO.Path]::GetDirectoryName($executablePath)
          $arguments = @($body.data.args | ForEach-Object { [string]$_ })
          $process = if ($arguments.Count -gt 0) {
            Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectory -ArgumentList $arguments -PassThru -ErrorAction Stop
          } else {
            Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectory -PassThru -ErrorAction Stop
          }
          # GUI applications may take several seconds to replace a launcher
          # process or acquire their single-instance mutex. Do not report a
          # startup failure after the old 250ms probe; wait for either the
          # original process or a same-path replacement to appear.
          $running = $false
          $deadline = [DateTime]::UtcNow.AddSeconds(12)
          while ([DateTime]::UtcNow -lt $deadline) {
            try {
              Get-Process -Id $process.Id -ErrorAction Stop | Out-Null
              $running = $true
              break
            } catch {
              try {
                $samePath = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and ([string]$_.ExecutablePath).Equals($executablePath, [System.StringComparison]::OrdinalIgnoreCase) })
                if ($samePath.Count -gt 0) { $running = $true; break }
              } catch { }
            }
            Start-Sleep -Milliseconds 250
          }
          $response = @{ ok = $true; pid = [int]$process.Id; running = $running }
        }
        'shutdown' {
          $response = @{ ok = $true }
          $shutdown = $true
        }
        default { throw "未知的提权操作: $($body.action)" }
      }
    } catch {
      $response = @{ ok = $false; error = $_.Exception.Message }
    }
    Write-Result $id $response
    Remove-Item -LiteralPath $request.FullName -Force -ErrorAction SilentlyContinue
    if ($shutdown) { exit 0 }
  }
  Start-Sleep -Milliseconds 80
}
`.replace("{{ENUMERATE_PROCESSES_PS}}", () => ENUMERATE_PROCESSES_PS);
function elevatedWorkerScriptFileContents() {
  return String.fromCharCode(65279) + ELEVATED_WORKER_SCRIPT;
}
var WORKER_ACTION_TIMEOUT_MS = {
  write: 12e4,
  "install-package": 12e4,
  start: 3e4,
  enumerate: 45e3,
  close: 15e3,
  terminate: 15e3,
  "is-running": 15e3,
  shutdown: 15e3
};
var WORKER_REQUEST_TIMEOUT_DEFAULT_MS = 3e4;
function workerStartCommand(scriptPath, root) {
  const scriptArgument = `-NoProfile -NoLogo -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}" -Root "${root}"`;
  return [
    "$ErrorActionPreference = 'Stop'",
    `$arguments = ${quotePowerShell(scriptArgument)}`,
    `$worker = Start-Process -FilePath ${quotePowerShell("powershell.exe")} -Verb RunAs -WindowStyle Hidden -ArgumentList $arguments -PassThru -ErrorAction Stop`,
    "$worker.Id"
  ].join(";\n");
}
var WindowsCompanionExecutor = class {
  logger;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-companion-elevated-"));
  scriptPath;
  workerStarted = false;
  workerClosed = false;
  /** Latched after one unanswered request: the worker loop is gone, so every
   *  later operation fails instantly instead of stalling for its full
   *  timeout. Cleared only by creating a new executor (one per batch). */
  workerBroken = false;
  workerBrokenReason;
  workerPid;
  constructor(logger) {
    this.logger = logger;
    this.scriptPath = path.join(this.root, "worker.ps1");
    fs.writeFileSync(this.scriptPath, elevatedWorkerScriptFileContents(), { encoding: "utf8", flag: "wx" });
  }
  log(stage, data = {}) {
    writeLog(this.logger, `elevated.${stage}`, data);
  }
  async ensureStarted() {
    if (this.workerClosed) throw new Error("\u63D0\u6743\u6267\u884C\u5668\u5DF2\u7ECF\u5173\u95ED");
    if (this.workerStarted) return;
    this.workerStarted = true;
    this.log("start.begin", { root: this.root });
    try {
      const result = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NoLogo",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShell(workerStartCommand(this.scriptPath, this.root))
      ], { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
      const pidMatch = result.stdout.match(/(\d+)\s*$/m);
      this.workerPid = pidMatch ? Number(pidMatch[1]) : void 0;
      this.log("start.success", { pid: this.workerPid, stdout: result.stdout.trim(), stderr: result.stderr.trim() });
    } catch (error) {
      const message = compactProcessError(error);
      this.log("start.failed", { error: message });
      throw new Error(`\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650\u6267\u884C\u8054\u52A8\u63D2\u4EF6\u5B89\u88C5\uFF1B\u5982\u679C\u53D6\u6D88 UAC\uFF0C\u8BF7\u91CD\u8BD5\uFF1A${message}`);
    }
    const deadline = Date.now() + 3e4;
    while (!fs.existsSync(path.join(this.root, "ready"))) {
      if (Date.now() >= deadline) {
        this.log("ready.timeout", { pid: this.workerPid });
        throw new Error("\u7BA1\u7406\u5458\u6743\u9650\u6267\u884C\u5668\u542F\u52A8\u8D85\u65F6\uFF0C\u8BF7\u786E\u8BA4\u5DF2\u63A5\u53D7 UAC \u5E76\u91CD\u8BD5");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.log("ready", { pid: this.workerPid });
  }
  async request(action, data = {}, logger) {
    if (this.workerBroken) {
      const error = new Error(`\u63D0\u6743\u6267\u884C\u5668\u5DF2\u5931\u6548\uFF08${this.workerBrokenReason}\uFF09\uFF0C\u5DF2\u8DF3\u8FC7 ${action}`);
      writeLog(logger, "elevated.operation.skipped", { action, reason: this.workerBrokenReason });
      throw error;
    }
    await this.ensureStarted();
    const id = crypto.randomUUID();
    const requestPath = path.join(this.root, `request-${id}.json`);
    const resultPath = path.join(this.root, `result-${id}.json`);
    writeLog(logger, "elevated.operation.begin", { action, id, data: action === "write" ? { destination: data.destination, bytes: data.bytes } : data });
    const temporary = `${requestPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ id, action, data }), { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, requestPath);
    try {
      const timeoutMs = WORKER_ACTION_TIMEOUT_MS[action] ?? WORKER_REQUEST_TIMEOUT_DEFAULT_MS;
      const deadline = Date.now() + timeoutMs;
      while (true) {
        if (fs.existsSync(resultPath)) {
          const response = JSON.parse(fs.readFileSync(resultPath, "utf8"));
          fs.rmSync(resultPath, { force: true });
          if (response.ok !== true) throw new Error(typeof response.error === "string" ? response.error : "\u7BA1\u7406\u5458\u6743\u9650\u64CD\u4F5C\u5931\u8D25");
          writeLog(logger, "elevated.operation.success", { action, id, response });
          return response;
        }
        if (Date.now() >= deadline) {
          this.workerBroken = true;
          this.workerBrokenReason = `\u64CD\u4F5C ${action} \u8D85\u65F6`;
          throw new Error(`\u7BA1\u7406\u5458\u6743\u9650\u64CD\u4F5C\u8D85\u65F6\uFF1A${action}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      const message = compactProcessError(error);
      writeLog(logger, "elevated.operation.failed", { action, id, error: message });
      throw new Error(message);
    } finally {
      fs.rmSync(requestPath, { force: true });
      fs.rmSync(temporary, { force: true });
    }
  }
  async writePackage(filePath, bytes, logger) {
    const source = path.join(this.root, `package-${crypto.randomUUID()}.bin`);
    fs.writeFileSync(source, bytes, { flag: "wx" });
    try {
      const response = await this.request("write", { source, destination: filePath, bytes: bytes.length }, logger);
      return typeof response.actualPath === "string" ? response.actualPath : filePath;
    } finally {
      fs.rmSync(source, { force: true });
    }
  }
  async installPackage(destinationPath, bytes, spec, logger) {
    const source = path.join(this.root, `package-${crypto.randomUUID()}.zip`);
    fs.writeFileSync(source, bytes, { flag: "wx" });
    try {
      const response = await this.request("install-package", { source, destination: destinationPath, manifestFileName: spec.manifestFileName, pluginId: spec.pluginId }, logger);
      return typeof response.actualPath === "string" ? response.actualPath : destinationPath;
    } finally {
      fs.rmSync(source, { force: true });
    }
  }
  async requestGracefulClose(pid, logger) {
    const response = await this.request("close", { pid }, logger);
    return response.accepted !== false;
  }
  async forceTerminate(pid, logger) {
    await this.request("terminate", { pid }, logger);
  }
  async isProcessRunning(pid, logger) {
    const response = await this.request("is-running", { pid }, logger);
    return response.running === true;
  }
  async enumerateProcesses(filter, logger) {
    const response = await this.request("enumerate", { names: filter.names, roots: filter.roots }, logger);
    const processes = Array.isArray(response.processes) ? response.processes : [];
    return processes.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item;
      if (typeof record.pid !== "number") return [];
      return [{
        pid: record.pid,
        ...typeof record.name === "string" && record.name ? { name: record.name } : {},
        ...typeof record.executablePath === "string" && record.executablePath ? { executablePath: record.executablePath } : {},
        ...typeof record.commandLine === "string" && record.commandLine ? { commandLine: record.commandLine } : {}
      }];
    });
  }
  async startProcess(executablePath, args, logger) {
    const response = await this.request("start", { executablePath, args }, logger);
    if (response.running === false) throw new Error("\u5BF9\u65B9\u8F6F\u4EF6\u542F\u52A8\u540E\u7ACB\u5373\u9000\u51FA\uFF0C\u8BF7\u68C0\u67E5\u8F6F\u4EF6\u672C\u4F53\u65E5\u5FD7");
  }
  async close() {
    if (this.workerClosed) return;
    if (this.workerStarted && fs.existsSync(path.join(this.root, "ready"))) {
      try {
        await this.request("shutdown");
      } catch (error) {
        this.log("stop.failed", { error: compactProcessError(error), pid: this.workerPid });
      }
    }
    this.workerClosed = true;
    this.log("stop", { pid: this.workerPid });
    fs.rmSync(this.root, { recursive: true, force: true });
  }
};
function parseHostProcessList(stdout) {
  if (!stdout.trim()) return [];
  try {
    const raw = JSON.parse(stdout);
    const items = Array.isArray(raw) ? raw : [raw];
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item;
      if (typeof record.pid !== "number") return [];
      return [{
        pid: record.pid,
        ...typeof record.name === "string" && record.name ? { name: record.name } : {},
        ...typeof record.executablePath === "string" && record.executablePath ? { executablePath: record.executablePath } : {},
        ...typeof record.commandLine === "string" && record.commandLine ? { commandLine: record.commandLine } : {}
      }];
    });
  } catch {
    return [];
  }
}
async function enumerateHostProcesses(filter, platform = process.platform, executor, commandRunner, logger) {
  if (platform !== "win32") return [];
  if (executor?.enumerateProcesses) {
    try {
      return await executor.enumerateProcesses(filter, logger);
    } catch (error) {
      writeLog(logger, "process.enumerate.elevated.failed", { ...filter, error: compactProcessError(error) });
    }
  }
  if (!commandRunner) return [];
  const script = [
    `$roots = @(${filter.roots.map(quotePowerShell).join(", ")})`,
    `$names = @(${filter.names.map(quotePowerShell).join(", ")})`,
    ENUMERATE_PROCESSES_PS,
    "$matched | ConvertTo-Json -Compress"
  ].join("\n");
  try {
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return parseHostProcessList(result.stdout);
  } catch (error) {
    writeLog(logger, "process.enumerate.direct.failed", { ...filter, error: compactProcessError(error) });
    return [];
  }
}
var HOST_WATCHDOG_MARKER = "--watchdog";
function delayHostClose(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForHostProcessExit(pid, isRunning, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isRunning(pid)) return true;
    await delayHostClose(pollMs);
  }
  return !await isRunning(pid);
}
async function closeHostProcesses(options) {
  const log = (stage, data = {}) => writeLog(options.logger, stage, data);
  const quietChecks = options.quietChecks ?? 2;
  const settlePollMs = options.settlePollMs ?? 750;
  const maxRounds = options.maxRounds ?? 4;
  const gracefulCloseTimeoutMs = options.gracefulCloseTimeoutMs ?? 2e3;
  const waitForExitTimeoutMs = options.waitForExitTimeoutMs ?? 1e4;
  const waitForExitPollMs = options.waitForExitPollMs ?? 250;
  const isWindows = (options.platform || process.platform) === "win32";
  const initialPids = options.initialPids.filter((pid) => Number.isInteger(pid) && pid > 0);
  const enumerate = async () => {
    if (!isWindows || !options.listProcesses) return [];
    try {
      return await options.listProcesses(options.filter);
    } catch (error) {
      log("process.enumerate.failed", { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  };
  const isWatchdog = (process2) => Boolean(process2.commandLine?.includes(HOST_WATCHDOG_MARKER));
  const closeOne = async (pid) => {
    options.onProgress?.(`\u6B63\u5728\u5173\u95ED ${options.hostLabel}\uFF08\u8FDB\u7A0B ${pid}\uFF09`);
    log("process.close.begin", { pid });
    let exited = false;
    try {
      const closeAccepted = await options.requestGracefulClose(pid) !== false;
      exited = closeAccepted && await waitForHostProcessExit(pid, options.isProcessRunning, gracefulCloseTimeoutMs, waitForExitPollMs);
      log("process.close.result", { pid, accepted: closeAccepted, exited, method: "graceful" });
    } catch (error) {
      log("process.close.failed", { pid, method: "graceful", error: error instanceof Error ? error.message : String(error) });
    }
    if (!exited) {
      options.onProgress?.(`${options.hostLabel} \u672A\u80FD\u4F18\u96C5\u9000\u51FA\uFF0C\u6B63\u5728\u5F3A\u5236\u7ED3\u675F\u8FDB\u7A0B ${pid}`);
      log("process.terminate.begin", { pid });
      try {
        await options.forceTerminate(pid);
        exited = await waitForHostProcessExit(pid, options.isProcessRunning, waitForExitTimeoutMs, waitForExitPollMs);
        log("process.terminate.result", { pid, exited });
      } catch (error) {
        log("process.terminate.failed", { pid, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return exited;
  };
  const enumerated = await enumerate();
  log("process.enumerate.result", { ...options.filter, initialPids, processes: enumerated });
  let known = enumerated;
  let failed = false;
  let quietCount = 0;
  let rounds = 0;
  const closedPids = /* @__PURE__ */ new Set();
  while (rounds < maxRounds) {
    const targets = [...known];
    for (const pid of initialPids) {
      if (targets.some((item) => item.pid === pid)) continue;
      try {
        if (await options.isProcessRunning(pid)) targets.push({ pid });
      } catch {
        targets.push({ pid });
      }
    }
    if (!targets.length) {
      quietCount += 1;
      if (quietCount >= quietChecks) break;
    } else {
      quietCount = 0;
      rounds += 1;
      targets.sort((left, right) => Number(isWatchdog(right)) - Number(isWatchdog(left)));
      log("process.close.round", { round: rounds, targets });
      for (const target of targets) {
        if (await closeOne(target.pid)) closedPids.add(target.pid);
        else {
          failed = true;
          break;
        }
      }
      if (failed) break;
    }
    await delayHostClose(settlePollMs);
    known = await enumerate();
    log("process.settle.check", { round: rounds, quietCount, processes: known });
  }
  const remaining = await enumerate();
  if (remaining.length) {
    failed = true;
    log("process.close.incomplete", { remaining, closedPids: [...closedPids] });
  }
  return { closedPids: [...closedPids], remaining, failed, rounds };
}
async function installCompanionPackage(destinationPath, bytes, spec, platform = process.platform, executor, logger) {
  validateCompanionPackage(bytes, spec);
  writeLog(logger, "package.install.begin", { destinationPath, pluginId: spec.pluginId, manifestFileName: spec.manifestFileName, bytes: bytes.length, platform });
  if (platform === "win32" && likelyProtectedWindowsPath(destinationPath)) {
    if (executor) return executor.installPackage(destinationPath, bytes, spec, logger);
    if (await isWindowsProcessElevated(logger)) return installDirectPackage(destinationPath, bytes, spec, platform, logger);
    const elevated = new WindowsCompanionExecutor(logger);
    try {
      return await elevated.installPackage(destinationPath, bytes, spec, logger);
    } finally {
      await elevated.close();
    }
  }
  try {
    return installDirectPackage(destinationPath, bytes, spec, platform, logger);
  } catch (error) {
    const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (platform === "win32" && ["EACCES", "EPERM"].includes(errorCode)) {
      if (executor) return executor.installPackage(destinationPath, bytes, spec, logger);
      if (await isWindowsProcessElevated(logger)) return installDirectPackage(destinationPath, bytes, spec, platform, logger);
      const elevated = new WindowsCompanionExecutor(logger);
      try {
        return await elevated.installPackage(destinationPath, bytes, spec, logger);
      } finally {
        await elevated.close();
      }
    }
    throw error;
  }
}
async function startCompanionProcessWithSameElevation(executablePath, args, platform = process.platform, logger) {
  const elevation = platform === "win32" ? await getWindowsProcessElevation(logger) : false;
  const elevated = elevation === true;
  writeLog(logger, "process.start.begin", { executablePath, args, platform, elevated: elevation === void 0 ? "unknown" : elevated });
  if (platform === "win32" && elevation === false) {
    const workingDirectory2 = path.win32.dirname(executablePath);
    const argumentList = args.map(quoteWindowsArgument).join(" ");
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "$shell = New-Object -ComObject Shell.Application",
      `$shell.ShellExecute(${quotePowerShell(executablePath)}, ${quotePowerShell(argumentList)}, ${quotePowerShell(workingDirectory2)}, 'open', 1)`
    ].join(";\n");
    try {
      await execFileAsync("powershell.exe", ["-NoProfile", "-NoLogo", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(command)], {
        encoding: "utf8",
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      });
      writeLog(logger, "process.start.success", { executablePath, args, workingDirectory: workingDirectory2, elevated: false, launchMode: "interactive-shell" });
      return;
    } catch (error) {
      const message = compactProcessError(error);
      writeLog(logger, "process.start.broker.failed", { executablePath, args, workingDirectory: workingDirectory2, error: message });
    }
  }
  const { spawn } = await import("node:child_process");
  const workingDirectory = platform === "win32" ? path.win32.dirname(executablePath) : path.dirname(executablePath);
  await new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      cwd: workingDirectory,
      detached: true,
      stdio: "ignore",
      windowsHide: platform === "win32"
    });
    child.once("error", (error) => {
      writeLog(logger, "process.start.failed", { executablePath, args, workingDirectory, elevated: elevation === void 0 ? "unknown" : elevated, error: error instanceof Error ? error.message : String(error) });
      reject(error);
    });
    child.once("spawn", () => {
      child.unref();
      writeLog(logger, "process.start.success", { executablePath, args, workingDirectory, elevated: elevation === void 0 ? "unknown" : elevated, launchMode: elevated ? "same-process-token" : "direct-fallback", ...child.pid ? { pid: child.pid } : {} });
      resolve();
    });
    child.once("exit", (code, signal) => {
      writeLog(logger, "process.exit", { executablePath, args, elevated: elevation === void 0 ? "unknown" : elevated, code, signal });
    });
  });
}
function quoteWindowsArgument(value) {
  if (!value.length) return '""';
  if (!/[\s"]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;
}
async function startCompanionProcess(executablePath, args, platform = process.platform, logger) {
  writeLog(logger, "process.start.begin", { executablePath, args, platform, elevated: platform === "win32" });
  if (platform !== "win32") {
    const { spawn } = await import("node:child_process");
    await new Promise((resolve, reject) => {
      const child = spawn(executablePath, args, { detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        writeLog(logger, "process.start.success", { executablePath, pid: child.pid });
        resolve();
      });
    });
    return;
  }
  const argumentList = args.length ? ` -ArgumentList @(${args.map(quotePowerShell).join(", ")})` : "";
  const workingDirectory = path.win32.dirname(executablePath);
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$process = Start-Process -FilePath ${quotePowerShell(executablePath)} -WorkingDirectory ${quotePowerShell(workingDirectory)}${argumentList} -Verb RunAs -PassThru`,
    "if ($null -eq $process) { throw '\u65E0\u6CD5\u542F\u52A8\u5BF9\u65B9\u8F6F\u4EF6' }"
  ].join(";\n");
  try {
    const result = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(command)], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    const pid = result.stdout.match(/(\d+)\s*$/m)?.[1];
    writeLog(logger, "process.start.success", { executablePath, args, workingDirectory, ...pid ? { pid: Number(pid) } : {}, stdout: result.stdout.trim(), stderr: result.stderr.trim() });
  } catch (error) {
    const message = compactProcessError(error);
    writeLog(logger, "process.start.failed", { executablePath, args, workingDirectory, error: message });
    throw new Error(`\u9700\u8981\u7BA1\u7406\u5458\u6743\u9650\u542F\u52A8\u5BF9\u65B9\u8F6F\u4EF6\uFF1B\u5982\u679C\u53D6\u6D88 UAC\uFF0C\u8BF7\u91CD\u8BD5\uFF1A${message}`);
  }
}

// src/companion-installer-shared.ts
import { execFile as execFile2 } from "node:child_process";
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
import { promisify as promisify2 } from "node:util";
var execFileAsync2 = promisify2(execFile2);
function platformPath(platform) {
  return platform === "win32" ? path2.win32 : path2.posix;
}
function normalizePath(value, platform) {
  const api = platformPath(platform);
  const normalized = api.normalize(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}
function hashId(executablePath, rootPath, platform) {
  return crypto2.createHash("sha256").update(`${normalizePath(executablePath, platform)}\0${normalizePath(rootPath, platform)}`).digest("hex").slice(0, 20);
}
function defaultExists(candidate) {
  try {
    return fs2.existsSync(candidate);
  } catch {
    return false;
  }
}
function defaultReadFile(filePath) {
  return fs2.readFileSync(filePath, "utf8");
}
function defaultCommandRunner(file, args) {
  return execFileAsync2(file, args, { encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 }).then((result) => ({ stdout: result.stdout, stderr: result.stderr }));
}
function quotePowerShell2(value) {
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
    path2.win32.join(env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path2.win32.join(env.ProgramData || "C:\\ProgramData", "Microsoft", "Windows", "Start Menu", "Programs"),
    path2.win32.join(env.USERPROFILE || "", "Desktop")
  ];
  const shortcutScript = String.raw`
$roots = @(${shortcutRoots.map(quotePowerShell2).join(",")})
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
          const asset = releaseAssetFromExpandedPage(await assetsResponse.text(), assetName);
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
function compareVersions2(left, right) {
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
    if (current && compareVersions2(current, expectedVersion) >= 0) return current;
    if (Date.now() >= deadline) return void 0;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
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

// src/iccce.ts
var ICCCE_PLUGIN_REPOSITORY = "SECTL/ICC-CE-SecAgent-Plugin";
var ICCCE_PLUGIN_ID = "inkcanvas.iccce.secagent";
var ICCCE_PLUGIN_ASSET_NAME = "inkcanvas.iccce.secagent.icpx";
var ICCCE_RELEASE_API_URL = `https://api.github.com/repos/${ICCCE_PLUGIN_REPOSITORY}/releases/latest`;
var ICCCE_RELEASE_PAGE_URL = `https://github.com/${ICCCE_PLUGIN_REPOSITORY}/releases/latest`;
var ICCCE_PLUGIN_HEALTH_URL = "http://127.0.0.1:18790/health";
var ICCCE_PLUGIN_VERSION_PATTERN = /["']?Version["']?\s*:\s*["']([^"']+)["']/i;
var WINDOWS_ICCCE_EXECUTABLES = ["InkCanvasForClass.exe", "Ink Canvas.exe", "InkCanvas.exe", "ICC-CE.exe"];
var MAX_ICCCE_PLUGIN_BYTES = 100 * 1024 * 1024;
var execFileAsync3 = promisify3(execFile3);
function defaultListDir(directory) {
  try {
    return fs3.readdirSync(directory);
  } catch {
    return [];
  }
}
async function discoverRunningProcesses(platform, commandRunner) {
  if (platform !== "win32") return [];
  const names = WINDOWS_ICCCE_EXECUTABLES.map((name) => `'${name}'`).join(",");
  const script = String.raw`
$names = @(${names})
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
      return [{ executablePath: record.executablePath, pid: record.pid, ...typeof record.commandLine === "string" ? { commandLine: record.commandLine } : {}, ...typeof record.version === "string" ? { version: record.version } : {} }];
    });
  } catch {
    return [];
  }
}
function executableCandidates(input, platform) {
  const api = platformPath(platform);
  const normalized = input.trim().replace(/,\d+$/, "").replace(/^"(.*)"$/, "$1");
  if (platform !== "win32") return [normalized];
  if (api.extname(normalized).toLowerCase() === ".exe") return [normalized];
  return WINDOWS_ICCCE_EXECUTABLES.map((name) => api.join(normalized, name));
}
function isKnownIccceExecutable(candidate, platform) {
  if (platform !== "win32") return true;
  const name = path3.win32.basename(candidate).toLowerCase();
  return WINDOWS_ICCCE_EXECUTABLES.some((executable) => executable.toLowerCase() === name);
}
function staticExecutablePaths(platform, home, env) {
  const api = platformPath(platform);
  if (platform !== "win32") return [];
  const local = env.LOCALAPPDATA || api.join(home, "AppData", "Local");
  const programFiles = env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const roots = [
    local,
    api.join(local, "Programs"),
    programFiles,
    programFilesX86,
    home,
    api.join(home, "Desktop"),
    api.join(home, "Downloads")
  ];
  const directories = ["", "InkCanvasForClass CE", "InkCanvasForClass", "ICC-CE", "Ink Canvas"];
  return roots.flatMap((root) => directories.flatMap((directory) => WINDOWS_ICCCE_EXECUTABLES.map((name) => api.join(root, directory, name))));
}
function inferPackageType(rootPath, platform, home, env) {
  if (platform !== "win32") return void 0;
  const api = path3.win32;
  const local = env.LOCALAPPDATA || api.join(home, "AppData", "Local");
  return normalizePath(rootPath, platform).startsWith(`${normalizePath(api.join(local, "InkCanvasForClass CE"), platform)}\\`) ? "installer" : "portable";
}
function resolveIccceLayout(executablePath, options = {}) {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const rootPath = api.resolve(api.dirname(executablePath));
  const packageType = inferPackageType(rootPath, platform, options.home || os2.homedir(), options.env || process.env);
  return {
    packageRoot: rootPath,
    pluginPackagesPath: api.join(rootPath, "PluginPackages"),
    pluginsPath: api.join(rootPath, "Plugins"),
    ...packageType ? { packageType } : {}
  };
}
function installedPluginVersion(layout, platform, exists, readFile) {
  const manifestPath = platformPath(platform).join(layout.pluginsPath, ICCCE_PLUGIN_ID, "manifest.json");
  if (!exists(manifestPath)) return void 0;
  try {
    const raw = readFile(manifestPath);
    const parsed = JSON.parse(raw);
    const id = typeof parsed.Id === "string" ? parsed.Id : typeof parsed.id === "string" ? parsed.id : ICCCE_PLUGIN_ID;
    if (id.toLowerCase() !== ICCCE_PLUGIN_ID.toLowerCase()) return void 0;
    const version = typeof parsed.Version === "string" ? parsed.Version : typeof parsed.version === "string" ? parsed.version : void 0;
    return version?.trim() || ICCCE_PLUGIN_VERSION_PATTERN.exec(raw)?.[1]?.trim();
  } catch {
    return void 0;
  }
}
async function probeIcccePluginDetailed(fetcher) {
  try {
    const response = await fetcher(ICCCE_PLUGIN_HEALTH_URL, { signal: AbortSignal.timeout(1500), headers: { Accept: "application/json" } });
    if (!response.ok) return { healthy: false, reason: `\u5065\u5EB7\u68C0\u67E5\u8FD4\u56DE HTTP ${response.status}`, status: response.status };
    const payload = await response.json();
    if (payload.apiVersion === 1 && payload.name === "iccce" && payload.status === "ok") return { healthy: true, reason: "ok", status: response.status };
    return { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u8FD4\u56DE\u5185\u5BB9\u4E0D\u5339\u914D", status: response.status };
  } catch {
    return { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u670D\u52A1\u672A\u54CD\u5E94" };
  }
}
async function probeIcccePlugin(fetcher) {
  return (await probeIcccePluginDetailed(fetcher)).healthy;
}
async function waitForIcccePluginHealth(fetcher, timeoutMs = 9e4, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u670D\u52A1\u672A\u54CD\u5E94" };
  while (true) {
    last = await probeIcccePluginDetailed(fetcher);
    if (last.healthy) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
async function defaultVersionOf(executablePath, platform, commandRunner) {
  if (platform !== "win32") return void 0;
  const script = `$item = Get-Item -LiteralPath ${quotePowerShell2(executablePath)}; $item.VersionInfo.ProductVersion`;
  try {
    const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return result.stdout.trim() || void 0;
  } catch {
    return void 0;
  }
}
async function discoverIccceInstallations(options = {}) {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const home = options.home || os2.homedir();
  const env = options.env || process.env;
  const exists = options.exists || defaultExists;
  const readFile = options.readFile || defaultReadFile;
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const running = options.runningProcesses || await discoverRunningProcesses(platform, commandRunner);
  const externalPaths = platform === "win32" && !options.executablePaths?.length && !options.runningProcesses ? await discoverWindowsExternalPaths(commandRunner, env, {
    displayNameFilter: "-match '(?i)(ICC\\s*[- ]?CE|Ink\\s*Canvas)'",
    targetPathPattern: "(?i)(InkCanvasForClass|Ink Canvas|ICC[- ]?CE)"
  }) : [];
  const inputPaths = [
    ...staticExecutablePaths(platform, home, env),
    ...options.executablePaths || [],
    ...externalPaths,
    ...running.map((item) => item.executablePath)
  ].flatMap((item) => executableCandidates(item, platform));
  const runningByPath = new Map(running.map((item) => [normalizePath(item.executablePath, platform), item]));
  const runningByName = new Map(running.filter((item) => !/[\\/]/.test(item.executablePath)).map((item) => [api.basename(item.executablePath).toLowerCase(), item]));
  const candidates = /* @__PURE__ */ new Map();
  const versionOf = options.versionOf || ((executablePath) => defaultVersionOf(executablePath, platform, commandRunner));
  for (const executablePath of [...new Set(inputPaths.map((item) => api.normalize(item)))].filter((item) => isKnownIccceExecutable(item, platform))) {
    if (!exists(executablePath)) continue;
    const processInfo = runningByPath.get(normalizePath(executablePath, platform)) || runningByName.get(api.basename(executablePath).toLowerCase());
    const version = processInfo?.version || await versionOf(executablePath);
    const layout = resolveIccceLayout(executablePath, { platform, home, env });
    const pluginHealthy = processInfo && options.fetcher ? await probeIcccePlugin(options.fetcher) : void 0;
    const disabledState = readIccePluginDisabledState(layout.packageRoot, platform, exists, readFile);
    const pluginDisabled = Boolean(disabledState.disabledByUser || disabledState.autoDisabled);
    const pluginDisableReason = disabledState.autoDisabled ? `ICC-CE \u5DF2\u81EA\u52A8\u7981\u7528\u6B64\u63D2\u4EF6\uFF08\u8FDE\u7EED\u52A0\u8F7D\u5931\u8D25${disabledState.lastErrorMessage ? `\uFF1A${disabledState.lastErrorMessage}` : ""}\uFF09` : disabledState.disabledByUser ? "ICC-CE \u7684\u63D2\u4EF6\u5217\u8868\u5DF2\u7981\u7528\u6B64\u63D2\u4EF6" : void 0;
    const candidate = {
      id: hashId(executablePath, layout.packageRoot, platform),
      executablePath,
      rootPath: layout.packageRoot,
      pluginPackagesPath: layout.pluginPackagesPath,
      pluginsPath: layout.pluginsPath,
      ...version ? { version } : {},
      ...installedPluginVersion(layout, platform, exists, readFile) ? { installedPluginVersion: installedPluginVersion(layout, platform, exists, readFile) } : {},
      ...pluginHealthy !== void 0 ? { pluginHealthy } : {},
      ...pluginDisabled ? { pluginDisabled, pluginDisableReason } : {},
      ...layout.packageType ? { packageType: layout.packageType } : {},
      isRunning: Boolean(processInfo),
      ...processInfo ? { pid: processInfo.pid, launchArgs: parseWindowsCommandLine(processInfo.commandLine).slice(1) } : { launchArgs: [] },
      source: processInfo ? "running-process" : options.executablePaths?.some((item) => normalizePath(item, platform) === normalizePath(executablePath, platform)) ? "manual-or-explicit" : "discovery",
      compatible: true,
      ...version ? {} : { reason: "\u65E0\u6CD5\u8BFB\u53D6 ICC-CE \u7248\u672C\uFF0C\u5C06\u6309\u5F53\u524D\u63D2\u4EF6\u517C\u5BB9\u6027\u7EE7\u7EED\u5B89\u88C5" },
      canonicalExecutablePath: normalizePath(executablePath, platform),
      canonicalRootPath: normalizePath(layout.packageRoot, platform)
    };
    const key = `${candidate.canonicalExecutablePath}\0${candidate.canonicalRootPath}`;
    const previous = candidates.get(key);
    if (!previous || !previous.isRunning && candidate.isRunning) candidates.set(key, candidate);
  }
  return [...candidates.values()].map(({ canonicalExecutablePath: _executable, canonicalRootPath: _root, ...candidate }) => candidate);
}
function readIccePluginDisabledState(rootPath, platform, exists, readFile) {
  const api = platformPath(platform);
  const state = {};
  try {
    const disabledPath = api.join(rootPath, "Configs", "disabled_plugins.json");
    if (exists(disabledPath)) {
      const parsed = JSON.parse(readFile(disabledPath));
      if (Array.isArray(parsed) && parsed.some((item) => typeof item === "string" && item.toLowerCase() === ICCCE_PLUGIN_ID)) state.disabledByUser = true;
    }
  } catch {
  }
  try {
    const recoveryPath = api.join(rootPath, "Configs", "plugin_error_recovery.json");
    if (exists(recoveryPath)) {
      const parsed = JSON.parse(readFile(recoveryPath));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const record = item;
          const pluginId = typeof record.PluginId === "string" ? record.PluginId : typeof record.pluginId === "string" ? record.pluginId : "";
          if (pluginId.toLowerCase() !== ICCCE_PLUGIN_ID) continue;
          if (record.AutoDisabled === true || record.autoDisabled === true) {
            state.autoDisabled = true;
            if (typeof record.LastErrorMessage === "string" && record.LastErrorMessage) state.lastErrorMessage = record.LastErrorMessage;
            if (typeof record.AutoDisabledAt === "string") state.autoDisabledAt = record.AutoDisabledAt;
          }
        }
      }
    }
  } catch {
  }
  return state;
}
function newestLogFileName(names) {
  const logs = names.filter((name) => /\.log$/i.test(name));
  return logs.length ? logs.sort((left, right) => right.localeCompare(left))[0] : void 0;
}
function tailLines(content, lines) {
  const split = content.trimEnd().split(/\r?\n/);
  return split.slice(Math.max(0, split.length - lines)).join("\n");
}
function readIcceHostDiagnostics(rootPath, platform, exists, readFile, listDir) {
  const api = platformPath(platform);
  const diagnostics = {};
  try {
    const recoveryPath = api.join(rootPath, "Configs", "plugin_error_recovery.json");
    if (exists(recoveryPath)) {
      const parsed = JSON.parse(readFile(recoveryPath));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const record = item;
          const pluginId = typeof record.PluginId === "string" ? record.PluginId : typeof record.pluginId === "string" ? record.pluginId : "";
          if (pluginId.toLowerCase() !== ICCCE_PLUGIN_ID) continue;
          diagnostics.recovery = {
            pluginId,
            ...typeof record.PluginName === "string" && record.PluginName ? { pluginName: record.PluginName } : {},
            failures: Array.isArray(record.FailureTimestamps) ? record.FailureTimestamps.length : 0,
            autoDisabled: record.AutoDisabled === true || record.autoDisabled === true,
            ...typeof record.AutoDisabledAt === "string" ? { autoDisabledAt: record.AutoDisabledAt } : {},
            ...typeof record.FirstFailureAt === "string" ? { firstFailureAt: record.FirstFailureAt } : {},
            ...typeof record.LastFailureAt === "string" ? { lastFailureAt: record.LastFailureAt } : {},
            ...typeof record.LastErrorMessage === "string" && record.LastErrorMessage ? { lastErrorMessage: record.LastErrorMessage } : {},
            ...typeof record.LastStackTrace === "string" && record.LastStackTrace ? { lastStackTrace: record.LastStackTrace } : {}
          };
          break;
        }
      }
    }
  } catch {
  }
  const readNewestLogTail = (logDir, maxLines) => {
    try {
      const newest = newestLogFileName(listDir(logDir));
      if (!newest) return void 0;
      const file = api.join(logDir, newest);
      if (!exists(file)) return void 0;
      return { file, tail: tailLines(readFile(file), maxLines) };
    } catch {
      return void 0;
    }
  };
  diagnostics.hostLog = readNewestLogTail(api.join(rootPath, "PluginLogs", "host"), 120);
  diagnostics.pluginLog = readNewestLogTail(api.join(rootPath, "PluginLogs", ICCCE_PLUGIN_ID), 60);
  return diagnostics;
}
var ICCCE_LOG_TIMESTAMP_PATTERN = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\]/;
function iccceLogLineTimeMs(line) {
  const match = ICCCE_LOG_TIMESTAMP_PATTERN.exec(line);
  if (!match) return void 0;
  const [, year, month, day, hour, minute, second] = match;
  const time = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
  return Number.isNaN(time) ? void 0 : time;
}
function summarizeIcceHostError(diagnostics, restartStartedAtMs) {
  const isError = (line) => /error|fail|失败|异常|incompatible|无法/i.test(line);
  const restartSecondMs = Math.floor(restartStartedAtMs / 1e3) * 1e3;
  const isFresh = (line) => {
    const time = iccceLogLineTimeMs(line);
    return time === void 0 || time >= restartSecondMs;
  };
  const freshLines = (tail) => tail ? tail.split("\n").filter(isFresh) : [];
  const pluginLines = freshLines(diagnostics.pluginLog?.tail);
  const hostLines = freshLines(diagnostics.hostLog?.tail);
  const candidates = [];
  for (const line of pluginLines.filter(isError).slice(0, 2)) candidates.push(`ICC-CE \u63D2\u4EF6\u65E5\u5FD7\uFF1A${line.trim()}`);
  if (diagnostics.recovery?.lastErrorMessage && !diagnostics.recovery.autoDisabled) candidates.push(`ICC-CE \u8BB0\u5F55\u7684\u52A0\u8F7D\u9519\u8BEF\uFF1A${diagnostics.recovery.lastErrorMessage}`);
  for (const line of hostLines.filter((line2) => isError(line2) && /secagent/i.test(line2)).slice(0, 2)) candidates.push(`ICC-CE \u5BBF\u4E3B\u65E5\u5FD7\uFF1A${line.trim()}`);
  if (!candidates.length && !pluginLines.length && !hostLines.length) candidates.push("ICC-CE \u91CD\u542F\u540E\u672A\u5199\u5165\u65B0\u7684\u63D2\u4EF6\u65E5\u5FD7\uFF0C\u53EF\u80FD\u4ECD\u5728\u542F\u52A8\u6216\u542F\u52A8\u53D7\u963B");
  return candidates.join("\uFF1B").slice(0, 400);
}
function iccceRootIsWritable(rootPath) {
  try {
    const probePath = path3.win32.join(rootPath, `.secagent-write-probe-${process.pid}-${Date.now()}`);
    fs3.writeFileSync(probePath, "");
    fs3.rmSync(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}
async function resetIccePluginErrorRecovery(rootPath, platform, executor, log, exists, readFile) {
  const api = platformPath(platform);
  const recoveryPath = api.join(rootPath, "Configs", "plugin_error_recovery.json");
  try {
    if (!exists(recoveryPath)) return;
    const parsed = JSON.parse(readFile(recoveryPath));
    if (!Array.isArray(parsed)) return;
    const isOurs = (item) => Boolean(item && typeof item === "object" && typeof item.PluginId === "string" && item.PluginId.toLowerCase() === ICCCE_PLUGIN_ID);
    const ours = parsed.find(isOurs);
    if (!ours) return;
    log("errorrecovery.reset", {
      path: recoveryPath,
      removedRecord: {
        failures: Array.isArray(ours.FailureTimestamps) ? ours.FailureTimestamps.length : 0,
        autoDisabled: ours.AutoDisabled === true,
        ...typeof ours.LastErrorMessage === "string" && ours.LastErrorMessage ? { lastErrorMessage: ours.LastErrorMessage } : {}
      }
    });
    if (!executor) {
      log("errorrecovery.reset.skipped", { reason: "\u65E0\u53EF\u7528\u7684\u7BA1\u7406\u5458\u6743\u9650\u6267\u884C\u5668\uFF0C\u65E0\u6CD5\u6E05\u7406\u5BBF\u4E3B\u7684\u63D2\u4EF6\u9519\u8BEF\u8BB0\u5F55" });
      return;
    }
    const remaining = parsed.filter((item) => !isOurs(item));
    await executor.writePackage(recoveryPath, Buffer.from(JSON.stringify(remaining, null, 2), "utf8"), (stage, data) => log(stage, data));
    log("errorrecovery.reset.success", { path: recoveryPath, remainingRecords: remaining.length });
  } catch (error) {
    log("errorrecovery.reset.failed", { path: recoveryPath, error: error instanceof Error ? error.message : String(error) });
  }
}
async function downloadLatestIcccePlugin(fetcher, now, onProgress, onRoute) {
  onProgress?.("downloading", "\u6B63\u5728\u901A\u8FC7 ghproxy.sectl.cn \u4E0B\u8F7D\u6700\u65B0 ICC-CE \u63D2\u4EF6");
  let release;
  let lastError;
  const metadataCandidates = marketplaceRequestUrls(`${ICCCE_RELEASE_API_URL}?secagent_cache=${now()}`);
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
  if (!release) release = await fetchReleasePageMetadata(fetcher, now, ICCCE_RELEASE_PAGE_URL, ICCCE_PLUGIN_REPOSITORY, ICCCE_PLUGIN_ASSET_NAME);
  if (!release) throw new Error(`\u65E0\u6CD5\u8BFB\u53D6 ICC-CE \u4FA7\u63D2\u4EF6\u6700\u65B0 Release\uFF1A${lastError instanceof Error ? lastError.message : String(lastError)}`);
  const asset = release.assets.find((item) => item.name === ICCCE_PLUGIN_ASSET_NAME && typeof item.browser_download_url === "string");
  if (!asset) throw new Error(`\u6700\u65B0 ICC-CE Release \u7F3A\u5C11 ${ICCCE_PLUGIN_ASSET_NAME}\uFF1B\u8BE5\u4ED3\u5E93\u9700\u8981\u5148\u53D1\u5E03\u7F16\u8BD1\u540E\u7684 .icpx \u63D2\u4EF6\u5305`);
  const digest = typeof asset.digest === "string" ? asset.digest.replace(/^sha256:/i, "") : "";
  if (!/^[a-f0-9]{64}$/i.test(digest)) throw new Error("ICC-CE Release \u7F3A\u5C11\u6709\u6548\u7684 SHA-256 \u6821\u9A8C\u503C");
  if (typeof asset.size === "number" && asset.size > MAX_ICCCE_PLUGIN_BYTES) throw new Error("ICC-CE \u63D2\u4EF6\u5305\u8FC7\u5927\uFF0C\u5DF2\u505C\u6B62\u5B89\u88C5");
  try {
    if (new URL(asset.browser_download_url).hostname.toLowerCase() !== "github.com") throw new Error("ICC-CE Release \u8D44\u4EA7\u5730\u5740\u65E0\u6548");
  } catch {
    throw new Error("ICC-CE Release \u8D44\u4EA7\u5730\u5740\u65E0\u6548");
  }
  const packageCandidates = marketplaceRequestUrls(asset.browser_download_url);
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
      if (bytes.length > MAX_ICCCE_PLUGIN_BYTES) {
        lastError = new Error("ICC-CE \u63D2\u4EF6\u5305\u8FC7\u5927");
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, error: "ICC-CE \u63D2\u4EF6\u5305\u8FC7\u5927" }, packageCandidates.slice(index + 1)));
        continue;
      }
      if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75) {
        lastError = new Error("ICC-CE \u63D2\u4EF6\u5305\u4E0D\u662F\u6709\u6548\u7684 .icpx \u538B\u7F29\u5305");
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, error: "ICC-CE \u63D2\u4EF6\u5305\u4E0D\u662F\u6709\u6548\u7684 .icpx \u538B\u7F29\u5305" }, packageCandidates.slice(index + 1)));
        continue;
      }
      onProgress?.("verifying", "\u6B63\u5728\u6821\u9A8C ICC-CE \u63D2\u4EF6 SHA-256");
      const actual = crypto3.createHash("sha256").update(bytes).digest("hex");
      if (actual.toLowerCase() !== digest.toLowerCase()) {
        lastError = new Error("ICC-CE \u63D2\u4EF6 SHA-256 \u6821\u9A8C\u5931\u8D25");
        onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, sha256: actual, error: `SHA-256 \u6821\u9A8C\u5931\u8D25\uFF0C\u671F\u671B ${digest}` }, packageCandidates.slice(index + 1)));
        continue;
      }
      onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { status: response.status, bytes: bytes.length, sha256: actual }, []));
      return { bytes, version: release.tag_name.replace(/^v/i, ""), sha256: actual };
    } catch (error) {
      lastError = error;
      onRoute?.(describeDownloadAttempt("plugin-package", candidate, startedAt, { error: error instanceof Error ? error.message : String(error) }, packageCandidates.slice(index + 1)));
    }
  }
  throw new Error(`\u4E0B\u8F7D ICC-CE \u63D2\u4EF6\u5931\u8D25\uFF1A${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
var IccceInstaller = class {
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
    const discovered = await discoverIccceInstallations({ ...this.options, fetcher: this.fetcher, commandRunner: this.commandRunner, platform: this.platform, executablePaths: [...this.options.executablePaths || [], ...[...this.candidates.values()].map((candidate) => candidate.executablePath)] });
    this.candidates = new Map(discovered.map((candidate) => [candidate.id, candidate]));
    return discovered;
  }
  async inspect(executablePath) {
    const discovered = await discoverIccceInstallations({ ...this.options, fetcher: this.fetcher, commandRunner: this.commandRunner, platform: this.platform, executablePaths: [executablePath] });
    const candidate = discovered[0];
    if (candidate) this.candidates.set(candidate.id, candidate);
    return candidate;
  }
  async install(targetIds, onProgress, executor) {
    const latestCandidates = await this.detect();
    const selected = latestCandidates.filter((candidate) => targetIds.includes(candidate.id));
    const missing = targetIds.filter((id) => !selected.some((candidate) => candidate.id === id)).map((targetId) => ({ targetId, ok: false, action: "failed", message: "\u627E\u4E0D\u5230 ICC-CE \u5B89\u88C5\u76EE\u6807\uFF0C\u8BF7\u91CD\u65B0\u68C0\u6D4B" }));
    if (!selected.length) return missing;
    const valid = selected.filter((candidate) => candidate.compatible);
    const results = selected.filter((candidate) => !candidate.compatible).map((candidate) => ({ targetId: candidate.id, ok: false, action: "skipped", message: candidate.reason || "ICC-CE \u7248\u672C\u4E0D\u517C\u5BB9" }));
    if (!valid.length) return [...results, ...missing];
    const report = (phase, message, percent) => {
      const phasePercent = percent ?? { downloading: 18, verifying: 38, installing: 62, closing: 72, restarting: 80 }[phase];
      onProgress?.({ phase, targetIds, percent: phasePercent, ...message ? { message } : {} });
    };
    const log = (stage, data = {}) => this.options.log?.(`companion.iccce.${stage}`, data);
    log("install.begin", { targetIds, candidates: selected.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, rootPath: candidate.rootPath, pluginPackagesPath: candidate.pluginPackagesPath, pluginsPath: candidate.pluginsPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, pluginHealthy: candidate.pluginHealthy, pluginDisabled: candidate.pluginDisabled, pluginDisableReason: candidate.pluginDisableReason, isRunning: candidate.isRunning, pid: candidate.pid })) });
    const packageData = await downloadLatestIcccePlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log("download.attempt", attempt));
    log("download.success", { version: packageData.version, bytes: packageData.bytes.length, sha256: packageData.sha256, repository: ICCCE_PLUGIN_REPOSITORY, asset: ICCCE_PLUGIN_ASSET_NAME });
    const groups = /* @__PURE__ */ new Map();
    for (const candidate of valid) {
      const key = normalizePath(candidate.rootPath, this.platform);
      groups.set(key, [...groups.get(key) || [], candidate]);
    }
    const restart = this.options.restartProcess || ((executablePath, args) => startCompanionProcessWithSameElevation(executablePath, args, this.platform, (stage, data) => log(stage, data)));
    const restartElevated = this.options.restartElevatedProcess || ((executablePath, args) => executor ? executor.startProcess(executablePath, args, (stage, data) => log(stage, data)) : startCompanionProcess(executablePath, args, this.platform, (stage, data) => log(stage, data)));
    const isRunning = this.options.isProcessRunning || ((pid) => executor ? executor.isProcessRunning(pid, (stage, data) => log(stage, data)) : defaultIsProcessRunning(pid));
    const requestClose = this.options.requestGracefulClose || ((pid) => executor ? executor.requestGracefulClose(pid, (stage, data) => log(stage, data)) : defaultRequestGracefulClose(pid, this.platform, this.commandRunner));
    const forceTerminate = this.options.forceTerminateProcess || ((pid) => executor ? executor.forceTerminate(pid, (stage, data) => log(stage, data)) : defaultForceTerminate(pid, this.platform, this.commandRunner));
    const gracefulCloseTimeoutMs = this.options.gracefulCloseTimeoutMs ?? 2e3;
    const exists = this.options.exists || defaultExists;
    const readFile = this.options.readFile || defaultReadFile;
    const listDir = this.options.listDir || defaultListDir;
    const installPackage = this.options.installPackage || ((destinationPath, bytes, spec) => installCompanionPackage(destinationPath, bytes, spec, this.platform, executor, (stage, data) => log(stage, data)));
    for (const group of groups.values()) {
      log("group.begin", { rootPath: group[0].rootPath, targets: group.map((candidate) => candidate.id), pluginPackagesPath: group[0].pluginPackagesPath, pluginsPath: group[0].pluginsPath, pluginDisabled: group.some((candidate) => candidate.pluginDisabled) });
      const alreadyInstalled = group.every((candidate) => candidate.installedPluginVersion && (!candidate.isRunning || candidate.pluginHealthy === true) && compareVersions(candidate.installedPluginVersion, packageData.version) >= 0);
      if (alreadyInstalled) {
        for (const candidate of group) results.push({ targetId: candidate.id, ok: true, action: "already-installed", message: `\u5DF2\u5B89\u88C5 ICC-CE \u63D2\u4EF6 v${packageData.version}`, version: packageData.version });
        continue;
      }
      const rootRequiresElevation = this.platform === "win32" && !(this.options.isDirectoryWritable?.(group[0].rootPath) ?? iccceRootIsWritable(group[0].rootPath));
      if (rootRequiresElevation) {
        log("process.restart.elevated", { rootPath: group[0].rootPath, viaExecutor: Boolean(executor) });
      }
      const relaunch = rootRequiresElevation ? restartElevated : restart;
      const pluginPath = platformPath(this.platform).join(group[0].pluginsPath, ICCCE_PLUGIN_ID);
      let preinstalled = false;
      try {
        report("installing", "\u6B63\u5728\u5199\u5165 ICC-CE \u63D2\u4EF6\u6587\u4EF6");
        const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: ICCCE_PLUGIN_ID, manifestFileName: "manifest.json" });
        preinstalled = true;
        log("package.preinstall.result", { requestedPath: pluginPath, actualPluginPath, hostRunning: group.some((candidate) => candidate.isRunning) });
      } catch (error) {
        log("package.preinstall.failed", { requestedPath: pluginPath, error: error instanceof Error ? error.message : String(error) });
      }
      const running = group.filter((candidate) => candidate.isRunning && candidate.pid !== void 0);
      const processFilter = {
        names: WINDOWS_ICCCE_EXECUTABLES,
        roots: [...new Set(group.map((candidate) => candidate.rootPath))]
      };
      const listProcesses = this.options.listProcesses ? (filter) => this.options.listProcesses(filter) : (filter) => enumerateHostProcesses(filter, this.platform, executor, this.commandRunner, (stage, data) => log(stage, data));
      const closeOutcome = await closeHostProcesses({
        hostLabel: "ICC-CE",
        initialPids: running.map((candidate) => candidate.pid),
        filter: processFilter,
        platform: this.platform,
        listProcesses,
        isProcessRunning: isRunning,
        requestGracefulClose: requestClose,
        forceTerminate,
        gracefulCloseTimeoutMs,
        waitForExitTimeoutMs: this.options.waitForExitTimeoutMs,
        waitForExitPollMs: this.options.waitForExitPollMs,
        // The watchdog polls its parent every 2s and relaunches on death;
        // require ~6s of quiet before writing/restarting.
        quietChecks: 4,
        settlePollMs: this.options.closeSettlePollMs ?? 1500,
        onProgress: (message) => report("closing", message),
        logger: (stage, data) => log(stage, data)
      });
      log("process.close.summary", { closedPids: closeOutcome.closedPids, remaining: closeOutcome.remaining, failed: closeOutcome.failed, rounds: closeOutcome.rounds });
      const closed = running.filter((candidate) => closeOutcome.closedPids.includes(candidate.pid));
      if (closeOutcome.failed) {
        for (const candidate of closed) await relaunch(candidate.executablePath, candidate.launchArgs).catch(() => void 0);
        for (const candidate of group) results.push({
          targetId: candidate.id,
          ok: false,
          action: "failed",
          message: closeOutcome.remaining.length ? `ICC-CE \u8FDB\u7A0B ${closeOutcome.remaining.map((item) => item.pid).join("\u3001")} \u65E0\u6CD5\u9000\u51FA\uFF08\u53EF\u80FD\u88AB\u770B\u95E8\u72D7\u53CD\u590D\u62C9\u8D77\uFF09\uFF0C\u8BF7\u624B\u52A8\u5173\u95ED\u540E\u91CD\u8BD5` : preinstalled ? "\u63D2\u4EF6\u6587\u4EF6\u5DF2\u5199\u5165\uFF0C\u4F46 ICC-CE \u65E0\u6CD5\u81EA\u52A8\u9000\u51FA\uFF1B\u8BF7\u624B\u52A8\u91CD\u542F ICC-CE \u540E\u91CD\u65B0\u68C0\u6D4B" : "ICC-CE \u65E0\u6CD5\u9000\u51FA\uFF0C\u5F3A\u5236\u7ED3\u675F\u4E5F\u5931\u8D25\uFF0C\u672A\u5B89\u88C5\u63D2\u4EF6\uFF1B\u8BF7\u624B\u52A8\u5173\u95ED\u540E\u91CD\u8BD5"
        });
        continue;
      }
      try {
        if (!preinstalled) {
          report("installing", "\u6B63\u5728\u89E3\u538B\u5B89\u88C5 ICC-CE \u63D2\u4EF6");
          const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: ICCCE_PLUGIN_ID, manifestFileName: "manifest.json" });
          log("package.install.result", { requestedPath: pluginPath, actualPluginPath });
        }
        const launchCandidate = closed[0] || group[0];
        await resetIccePluginErrorRecovery(group[0].rootPath, this.platform, executor, log, exists, readFile);
        const restarting = running.length > 0;
        report("restarting", restarting ? "\u6B63\u5728\u91CD\u65B0\u542F\u52A8 ICC-CE" : "\u6B63\u5728\u542F\u52A8 ICC-CE");
        log("process.restart.begin", { executablePath: launchCandidate.executablePath, args: launchCandidate.launchArgs, wasRunning: restarting });
        let launchFailed = false;
        const restartStartedAtMs = Date.now();
        try {
          await relaunch(launchCandidate.executablePath, launchCandidate.launchArgs);
          log("process.restart.success", { executablePath: launchCandidate.executablePath });
        } catch (error) {
          launchFailed = true;
          log("process.restart.failed", { executablePath: launchCandidate.executablePath, error: error instanceof Error ? error.message : String(error) });
        }
        if (!launchFailed) report("verifying", "\u6B63\u5728\u7B49\u5F85 ICC-CE \u63D2\u4EF6\u54CD\u5E94", 94);
        const installedLayout = {
          packageRoot: group[0].rootPath,
          pluginPackagesPath: group[0].pluginPackagesPath,
          pluginsPath: group[0].pluginsPath,
          ...group[0].packageType ? { packageType: group[0].packageType } : {}
        };
        const verifyTimeoutMs = this.options.waitForPluginTimeoutMs ?? 9e4;
        const writtenVersion = installedPluginVersion(installedLayout, this.platform, exists, readFile);
        const verifiedVersion = launchFailed ? void 0 : await waitForInstalledPlugin(
          () => installedPluginVersion(installedLayout, this.platform, exists, readFile),
          packageData.version,
          verifyTimeoutMs,
          this.options.waitForPluginPollMs
        );
        const health = launchFailed ? { healthy: false, reason: "\u5BF9\u65B9\u8F6F\u4EF6\u672A\u6210\u529F\u542F\u52A8" } : await waitForIcccePluginHealth(this.fetcher, verifyTimeoutMs, this.options.waitForPluginPollMs);
        const pluginHealthy = health.healthy;
        const verified = Boolean(verifiedVersion) && pluginHealthy;
        const detectedVersion = verified ? verifiedVersion : writtenVersion;
        try {
          const snapshot = await listProcesses(processFilter);
          log("process.post-restart.snapshot", { processes: snapshot });
        } catch {
        }
        const postDisabledState = readIccePluginDisabledState(group[0].rootPath, this.platform, exists, readFile);
        const postDisabled = Boolean(postDisabledState.disabledByUser || postDisabledState.autoDisabled);
        const postDisableHint = postDisabled ? `\uFF1B${postDisabledState.autoDisabled ? "ICC-CE \u5DF2\u81EA\u52A8\u7981\u7528\u6B64\u63D2\u4EF6\uFF0C\u8BF7\u5728 ICC-CE \u8BBE\u7F6E\u7684\u63D2\u4EF6\u9875\u91CD\u7F6E" : "ICC-CE \u7684\u63D2\u4EF6\u5217\u8868\u5DF2\u7981\u7528\u6B64\u63D2\u4EF6\uFF0C\u8BF7\u5728 ICC-CE \u8BBE\u7F6E\u4E2D\u542F\u7528"}\u540E\u91CD\u8BD5` : "";
        const hostDiagnostics = readIcceHostDiagnostics(group[0].rootPath, this.platform, exists, readFile, listDir);
        log("host.diagnostics", { recovery: hostDiagnostics.recovery, hostLog: hostDiagnostics.hostLog, pluginLog: hostDiagnostics.pluginLog });
        const hostErrorHint = verified || launchFailed ? "" : summarizeIcceHostError(hostDiagnostics, restartStartedAtMs);
        const hostErrorHintText = hostErrorHint ? `\uFF1B${hostErrorHint}` : "";
        log("verification.result", { expectedVersion: packageData.version, writtenVersion, verifiedVersion, detectedVersion, pluginHealthy, healthReason: health.reason, healthStatus: health.status, healthUrl: ICCCE_PLUGIN_HEALTH_URL, verified, launchFailed, pluginDisabled: postDisabled, pluginDisableReason: postDisabledState.lastErrorMessage, hostError: hostErrorHint || void 0 });
        for (const candidate of group) {
          results.push({
            targetId: candidate.id,
            ok: !launchFailed && verified,
            action: !launchFailed && verified ? "installed" : "failed",
            message: launchFailed ? `\u63D2\u4EF6\u5305\u5DF2\u5199\u5165\uFF0C\u4F46 ICC-CE \u81EA\u52A8${restarting ? "\u91CD\u542F" : "\u542F\u52A8"}\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u542F\u52A8` : verified ? restarting ? `\u5DF2\u5B89\u88C5 ICC-CE \u63D2\u4EF6 v${verifiedVersion}\uFF0CICC-CE \u5DF2\u81EA\u52A8\u91CD\u542F` : `\u5DF2\u5B89\u88C5 ICC-CE \u63D2\u4EF6 v${verifiedVersion}\uFF0CICC-CE \u5DF2\u81EA\u52A8\u542F\u52A8` : verifiedVersion ? `\u63D2\u4EF6\u6587\u4EF6\u5DF2\u5199\u5165\uFF0C\u4F46 ICC-CE \u5C1A\u672A\u52A0\u8F7D\u63D2\u4EF6\uFF08${health.reason}${postDisableHint}${hostErrorHintText}\uFF09\uFF0C\u8BF7\u91CD\u8BD5\u6216\u624B\u52A8\u91CD\u542F ICC-CE` : `\u63D2\u4EF6\u5DF2\u89E3\u538B\u5E76\u542F\u52A8\uFF0C\u4F46\u672A\u68C0\u6D4B\u5230 ICC-CE \u63D2\u4EF6\uFF08${health.reason}${postDisableHint}${hostErrorHintText}\uFF09\uFF0C\u8BF7\u67E5\u770B\u8BCA\u65AD\u65E5\u5FD7\u540E\u91CD\u8BD5`,
            ...verified && detectedVersion ? { version: detectedVersion } : {}
          });
        }
      } catch (error) {
        log("install.failed", { error: error instanceof Error ? error.message : String(error) });
        for (const candidate of closed) await relaunch(candidate.executablePath, candidate.launchArgs).catch(() => void 0);
        for (const candidate of group) results.push({ targetId: candidate.id, ok: false, action: "failed", message: `\u5B89\u88C5 ICC-CE \u63D2\u4EF6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return [...results, ...missing];
  }
};

// src/iccce.test.ts
function writeIccceManifest(root, version = "0.3.2") {
  const manifestPath = path4.win32.join(root, "Plugins", "inkcanvas.iccce.secagent", "manifest.json");
  fs4.mkdirSync(path4.win32.dirname(manifestPath), { recursive: true });
  fs4.writeFileSync(manifestPath, JSON.stringify({ Id: "inkcanvas.iccce.secagent", Version: version }));
}
function writeIcceHostLog(root, fileName, lines) {
  const logDir = path4.win32.join(root, "PluginLogs", "host");
  fs4.mkdirSync(logDir, { recursive: true });
  const content = lines.join("\n");
  fs4.writeFileSync(path4.win32.join(logDir, fileName), content);
  fs4.writeFileSync(`${logDir}/${fileName}`, content);
}
function iccceLogStamp(offsetMs = 0) {
  const time = new Date(Date.now() + offsetMs);
  const pad = (value) => String(value).padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}
test("resolves ICC-CE PluginPackages and detects the installed side plugin", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    const layout = resolveIccceLayout(exe, { platform: "win32", home: "C:\\Users\\teacher", env: { LOCALAPPDATA: "C:\\Users\\teacher\\AppData\\Local" } });
    fs4.mkdirSync(path4.win32.join(layout.pluginsPath, "inkcanvas.iccce.secagent"), { recursive: true });
    fs4.writeFileSync(exe, "test executable");
    fs4.writeFileSync(path4.win32.join(layout.pluginsPath, "inkcanvas.iccce.secagent", "manifest.json"), JSON.stringify({ Id: "inkcanvas.iccce.secagent", Version: "0.3.2" }));
    const found = await discoverIccceInstallations({
      platform: "win32",
      executablePaths: [exe],
      exists: (candidate) => fs4.existsSync(candidate),
      versionOf: () => "1.7.19.9"
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].pluginPackagesPath, path4.win32.join(root, "PluginPackages"));
    assert.equal(found[0].installedPluginVersion, "0.3.2");
    assert.equal(found[0].compatible, true);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("does not treat an ICC-CE uninstaller as an application target", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-uninstaller-"));
  try {
    const uninstaller = path4.win32.join(root, "unins000.exe");
    fs4.writeFileSync(uninstaller, "uninstaller");
    const found = await discoverIccceInstallations({
      platform: "win32",
      home: "C:\\Users\\teacher",
      env: { LOCALAPPDATA: "C:\\Users\\teacher\\AppData\\Local" },
      commandRunner: async () => ({ stdout: JSON.stringify([uninstaller]), stderr: "" }),
      exists: (candidate) => fs4.existsSync(candidate),
      versionOf: () => "1.8.0.2"
    });
    assert.deepEqual(found, []);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("downloads ICC-CE icpx through ghproxy, verifies it, and restarts the selected instance", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-install-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    fs4.writeFileSync(exe, "test executable");
    const bytes = Buffer.from("PK\\x03\\x04 valid icpx bytes");
    const digest = crypto4.createHash("sha256").update(bytes).digest("hex");
    const calls = [];
    const launches = [];
    const fetcher = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === "http://127.0.0.1:18790/health") return new Response(JSON.stringify({ apiVersion: 1, name: "iccce", status: "ok" }), { status: 200 });
      if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v0.3.2", draft: false, prerelease: false, assets: [{ name: ICCCE_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download/v0.3.2/ICC-CE.SecAgent.Plugin.icpx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
      return new Response(bytes, { status: 200 });
    };
    const installer = new IccceInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 123, commandLine: `"${exe}" --profile classroom`, version: "1.7.19.9" }],
      versionOf: () => "1.7.19.9",
      fetcher,
      exists: (candidate) => fs4.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        launches.push({ executablePath, args });
        writeIccceManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    const installedPath = path4.win32.join(root, "Plugins", ICCCE_PLUGIN_ID, "manifest.json");
    assert.equal(result.ok, true);
    assert.equal(result.version, "0.3.2");
    assert.match(result.message, /自动重启/);
    assert.equal(fs4.existsSync(installedPath), true);
    assert.deepEqual(launches, [{ executablePath: exe, args: ["--profile", "classroom"] }]);
    const marketplaceCalls = calls.filter((url) => url.includes("api.github.com") || url.includes("github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download"));
    assert.equal(marketplaceCalls[0].startsWith(`${DEFAULT_MARKETPLACE_PROXY_URL}/https://api.github.com/`), true);
    assert.equal(marketplaceCalls[1].startsWith(`${DEFAULT_MARKETPLACE_PROXY_URL}/https://github.com/`), true);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("terminates the ICC-CE watchdog first and outlives its relaunch before writing", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-watchdog-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    fs4.writeFileSync(exe, "test executable");
    const bytes = Buffer.from("PK\\x03\\x04 watchdog icpx bytes");
    const digest = crypto4.createHash("sha256").update(bytes).digest("hex");
    const closeOrder = [];
    const launches = [];
    let enumerateCalls = 0;
    const listProcesses = async (filter) => {
      enumerateCalls += 1;
      assert.equal(filter.names.includes("InkCanvasForClass.exe"), true);
      assert.deepEqual(filter.roots, [path4.win32.resolve(path4.win32.dirname(exe))]);
      if (enumerateCalls === 1) {
        return [
          { pid: 8, name: "InkCanvasForClass.exe", executablePath: exe, commandLine: `"${exe}" --profile classroom` },
          { pid: 10, name: "InkCanvasForClass.exe", executablePath: exe, commandLine: `"${exe}" --watchdog 8 "C:\\iccce-exit.flag"` }
        ];
      }
      return enumerateCalls === 2 ? [{ pid: 11, name: "InkCanvasForClass.exe", executablePath: exe, commandLine: `"${exe}" --profile classroom` }] : [];
    };
    const installer = new IccceInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 8, commandLine: `"${exe}" --profile classroom`, version: "1.7.19.9" }],
      versionOf: () => "1.7.19.9",
      fetcher: async (input) => {
        const url = String(input);
        if (url === "http://127.0.0.1:18790/health") return new Response(JSON.stringify({ apiVersion: 1, name: "iccce", status: "ok" }), { status: 200 });
        if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v0.3.2", draft: false, prerelease: false, assets: [{ name: ICCCE_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download/v0.3.2/ICC-CE.SecAgent.Plugin.icpx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
        return new Response(bytes, { status: 200 });
      },
      exists: (candidate) => fs4.existsSync(candidate),
      requestGracefulClose: async (pid) => {
        closeOrder.push(pid);
      },
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        launches.push({ executablePath, args });
        writeIccceManifest(root);
      },
      listProcesses,
      closeSettlePollMs: 1
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, true);
    assert.match(result.message, /自动重启/);
    assert.deepEqual(closeOrder, [10, 8, 11]);
    assert.deepEqual(launches, [{ executablePath: exe, args: ["--profile", "classroom"] }]);
    assert.equal(enumerateCalls >= 6, true);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("quotes ICC-CE's own plugin load error when the health check fails", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-diag-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    fs4.writeFileSync(exe, "test executable");
    const bytes = Buffer.from("PK\\x03\\x04 diagnostic icpx bytes");
    const digest = crypto4.createHash("sha256").update(bytes).digest("hex");
    fs4.mkdirSync(path4.win32.join(root, "Configs"), { recursive: true });
    fs4.writeFileSync(path4.win32.join(root, "Configs", "plugin_error_recovery.json"), JSON.stringify([
      {
        PluginId: "inkcanvas.iccce.secagent",
        PluginName: "SecAgent \u8054\u52A8",
        FirstFailureAt: "2026-08-29T04:10:00",
        LastFailureAt: "2026-08-29T04:12:00",
        FailureTimestamps: ["2026-08-29T04:10:00", "2026-08-29T04:12:00"],
        LastErrorMessage: "Could not load file or assembly 'InkCanvas.PluginSdk'.",
        LastStackTrace: "   at Ink_Canvas.Plugins.PluginManager.LoadPlugin(PluginInfo info)",
        AutoDisabled: false
      }
    ]));
    const writeHostLog = () => {
      writeIcceHostLog(root, `${iccceLogStamp().slice(0, 10)}.log`, [
        `[${iccceLogStamp()}] [INFO] [host] Loading plugin: SecAgent \u8054\u52A8`,
        `[${iccceLogStamp()}] [ERROR] [host] Failed to load plugin SecAgent \u8054\u52A8 | System.IO.FileNotFoundException: Could not load file or assembly 'InkCanvas.PluginSdk'.`,
        `[${iccceLogStamp()}] [INFO] [host] Plugin loading complete. Loaded 0 plugins`
      ]);
    };
    const stages = [];
    const installer = new IccceInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 4242, commandLine: `"${exe}"`, version: "1.8.0.2" }],
      versionOf: () => "1.8.0.2",
      fetcher: async (input) => {
        const url = String(input);
        if (url === "http://127.0.0.1:18790/health") return new Response("no listener", { status: 502 });
        if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v0.3.2", draft: false, prerelease: false, assets: [{ name: ICCCE_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download/v0.3.2/ICC-CE.SecAgent.Plugin.icpx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
        return new Response(bytes, { status: 200 });
      },
      exists: (candidate) => fs4.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async () => {
        writeIccceManifest(root);
        writeHostLog();
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1,
      waitForPluginTimeoutMs: 200,
      waitForPluginPollMs: 50,
      log: (stage, data2) => stages.push({ stage, data: data2 })
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, false);
    assert.match(result.message, /ICC-CE 记录的加载错误|ICC-CE 宿主日志/);
    assert.match(result.message, /ICC-CE 宿主日志：.*Failed to load plugin/);
    const diagnostics = stages.find((entry) => entry.stage === "companion.iccce.host.diagnostics");
    assert.ok(diagnostics, "host diagnostics were not logged");
    const data = diagnostics.data;
    assert.equal(data.recovery?.failures, 2);
    assert.equal(data.recovery?.lastErrorMessage, "Could not load file or assembly 'InkCanvas.PluginSdk'.");
    assert.match(data.hostLog?.file || "", /PluginLogs.*host.*\.log$/);
    assert.match(data.hostLog?.tail || "", /Failed to load plugin/);
    assert.equal(data.pluginLog, void 0);
    assert.equal(stages.some((entry) => entry.stage === "companion.iccce.errorrecovery.reset"), true);
    assert.equal(stages.some((entry) => entry.stage === "companion.iccce.errorrecovery.reset.skipped"), true);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("ignores stale host-log errors from a previous day when the health check fails", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-stalelog-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    fs4.writeFileSync(exe, "test executable");
    const bytes = Buffer.from("PK\\x03\\x04 stale log icpx bytes");
    const digest = crypto4.createHash("sha256").update(bytes).digest("hex");
    writeIcceHostLog(root, "2026-08-28.log", [
      "[2026-08-28 12:33:43.553] [INFO] [PluginManager] Plugin loaded: SecAgent \u8054\u52A8 v0.3.2 by SecAgent",
      "[2026-08-28 13:18:49.265] [ERROR] [PluginManager] Plugin ALC for inkcanvas.iccce.secagent is still alive after 10 GC passes; some host reference is pinning it (hot reload will fall back to restart).",
      "[2026-08-28 15:01:26.690] [ERROR] [PluginManager] Plugin ALC for inkcanvas.iccce.secagent is still alive after 10 GC passes; some host reference is pinning it (hot reload will fall back to restart)."
    ]);
    const installer = new IccceInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 4242, commandLine: `"${exe}"`, version: "1.8.0.2" }],
      versionOf: () => "1.8.0.2",
      fetcher: async (input) => {
        const url = String(input);
        if (url === "http://127.0.0.1:18790/health") return new Response("no listener", { status: 502 });
        if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v0.3.2", draft: false, prerelease: false, assets: [{ name: ICCCE_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download/v0.3.2/ICC-CE.SecAgent.Plugin.icpx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
        return new Response(bytes, { status: 200 });
      },
      exists: (candidate) => fs4.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async () => {
        writeIccceManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1,
      waitForPluginTimeoutMs: 200,
      waitForPluginPollMs: 50
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /ALC|still alive/);
    assert.match(result.message, /未写入新的插件日志/);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("clears only this plugin's stale error-recovery record before restarting ICC-CE", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-reset-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    fs4.writeFileSync(exe, "test executable");
    const bytes = Buffer.from("PK\\x03\\x04 reset icpx bytes");
    const digest = crypto4.createHash("sha256").update(bytes).digest("hex");
    fs4.mkdirSync(path4.win32.join(root, "Configs"), { recursive: true });
    fs4.writeFileSync(path4.win32.join(root, "Configs", "plugin_error_recovery.json"), JSON.stringify([
      { PluginId: "someone.else.plugin", PluginName: "Unrelated", FailureTimestamps: ["2026-08-29T03:00:00"], AutoDisabled: true },
      { PluginId: "inkcanvas.iccce.secagent", PluginName: "SecAgent \u8054\u52A8", FailureTimestamps: ["2026-08-29T04:00:00"], LastErrorMessage: "boom", AutoDisabled: true }
    ]));
    const writes = [];
    const executor = {
      writePackage: async (filePath, fileBytes) => {
        writes.push({ filePath, bytes: fileBytes });
        return filePath;
      },
      installPackage: async (destinationPath) => destinationPath,
      requestGracefulClose: async () => true,
      forceTerminate: async () => void 0,
      isProcessRunning: async () => false,
      startProcess: async () => void 0,
      close: async () => void 0
    };
    const installer = new IccceInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 77, commandLine: `"${exe}"`, version: "1.8.0.2" }],
      versionOf: () => "1.8.0.2",
      fetcher: async (input) => {
        const url = String(input);
        if (url === "http://127.0.0.1:18790/health") return new Response(JSON.stringify({ apiVersion: 1, name: "iccce", status: "ok" }), { status: 200 });
        if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v0.3.2", draft: false, prerelease: false, assets: [{ name: ICCCE_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download/v0.3.2/ICC-CE.SecAgent.Plugin.icpx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
        return new Response(bytes, { status: 200 });
      },
      exists: (candidate) => fs4.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async () => {
        writeIccceManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id], void 0, executor);
    assert.equal(result.ok, true);
    const recoveryWrites = writes.filter((write) => write.filePath.endsWith("plugin_error_recovery.json"));
    assert.equal(recoveryWrites.length, 1);
    const rewritten = JSON.parse(recoveryWrites[0].bytes.toString("utf8"));
    assert.deepEqual(rewritten.map((record) => record.PluginId), ["someone.else.plugin"]);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("relaunches ICC-CE through the elevated worker when its install root is not writable", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-elevated-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    fs4.writeFileSync(exe, "test executable");
    const bytes = Buffer.from("PK\\x03\\x04 elevated restart icpx bytes");
    const digest = crypto4.createHash("sha256").update(bytes).digest("hex");
    const elevatedLaunches = [];
    const plainLaunches = [];
    const stages = [];
    const executor = {
      writePackage: async (filePath, fileBytes) => {
        fs4.mkdirSync(path4.win32.dirname(filePath), { recursive: true });
        fs4.writeFileSync(filePath, fileBytes);
        return filePath;
      },
      installPackage: async (destinationPath) => destinationPath,
      requestGracefulClose: async () => true,
      forceTerminate: async () => void 0,
      isProcessRunning: async () => false,
      startProcess: async (executablePath, args) => {
        elevatedLaunches.push({ executablePath, args });
        writeIccceManifest(root);
      },
      close: async () => void 0
    };
    const installer = new IccceInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 9001, commandLine: `"${exe}" --profile classroom`, version: "1.8.0.2" }],
      versionOf: () => "1.8.0.2",
      isDirectoryWritable: () => false,
      fetcher: async (input) => {
        const url = String(input);
        if (url === "http://127.0.0.1:18790/health") return new Response(JSON.stringify({ apiVersion: 1, name: "iccce", status: "ok" }), { status: 200 });
        if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v0.3.2", draft: false, prerelease: false, assets: [{ name: ICCCE_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download/v0.3.2/ICC-CE.SecAgent.Plugin.icpx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
        return new Response(bytes, { status: 200 });
      },
      exists: (candidate) => fs4.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        plainLaunches.push({ executablePath, args });
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1,
      log: (stage, data) => stages.push({ stage, data })
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id], void 0, executor);
    assert.equal(result.ok, true);
    assert.deepEqual(elevatedLaunches, [{ executablePath: exe, args: ["--profile", "classroom"] }]);
    assert.deepEqual(plainLaunches, []);
    const elevatedStage = stages.find((entry) => entry.stage === "companion.iccce.process.restart.elevated");
    assert.ok(elevatedStage, "elevated restart decision was not logged");
    assert.equal(elevatedStage.data.viaExecutor, true);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("falls back to an explicit elevated relaunch when no elevated worker survived", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-elevated-fallback-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    fs4.writeFileSync(exe, "test executable");
    const bytes = Buffer.from("PK\\x03\\x04 elevated fallback icpx bytes");
    const digest = crypto4.createHash("sha256").update(bytes).digest("hex");
    const elevatedLaunches = [];
    const plainLaunches = [];
    const installer = new IccceInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 9002, commandLine: `"${exe}"`, version: "1.8.0.2" }],
      versionOf: () => "1.8.0.2",
      isDirectoryWritable: () => false,
      fetcher: async (input) => {
        const url = String(input);
        if (url === "http://127.0.0.1:18790/health") return new Response(JSON.stringify({ apiVersion: 1, name: "iccce", status: "ok" }), { status: 200 });
        if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v0.3.2", draft: false, prerelease: false, assets: [{ name: ICCCE_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download/v0.3.2/ICC-CE.SecAgent.Plugin.icpx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
        return new Response(bytes, { status: 200 });
      },
      exists: (candidate) => fs4.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        plainLaunches.push({ executablePath, args });
      },
      restartElevatedProcess: async (executablePath, args) => {
        elevatedLaunches.push({ executablePath, args });
        writeIccceManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id], void 0, void 0);
    assert.equal(result.ok, true);
    assert.deepEqual(elevatedLaunches, [{ executablePath: exe, args: [] }]);
    assert.deepEqual(plainLaunches, []);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
test("keeps the same-elevation relaunch when the install root is writable", async () => {
  const root = fs4.mkdtempSync(path4.join(os3.tmpdir(), "secagent-iccce-elevated-writable-"));
  try {
    const exe = path4.win32.join(root, "InkCanvasForClass.exe");
    fs4.writeFileSync(exe, "test executable");
    const bytes = Buffer.from("PK\\x03\\x04 writable root icpx bytes");
    const digest = crypto4.createHash("sha256").update(bytes).digest("hex");
    const elevatedLaunches = [];
    const plainLaunches = [];
    const installer = new IccceInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 9003, commandLine: `"${exe}"`, version: "1.8.0.2" }],
      versionOf: () => "1.8.0.2",
      isDirectoryWritable: () => true,
      fetcher: async (input) => {
        const url = String(input);
        if (url === "http://127.0.0.1:18790/health") return new Response(JSON.stringify({ apiVersion: 1, name: "iccce", status: "ok" }), { status: 200 });
        if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "v0.3.2", draft: false, prerelease: false, assets: [{ name: ICCCE_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ICC-CE-SecAgent-Plugin/releases/download/v0.3.2/ICC-CE.SecAgent.Plugin.icpx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
        return new Response(bytes, { status: 200 });
      },
      exists: (candidate) => fs4.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        plainLaunches.push({ executablePath, args });
        writeIccceManifest(root);
      },
      restartElevatedProcess: async (executablePath, args) => {
        elevatedLaunches.push({ executablePath, args });
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, true);
    assert.deepEqual(plainLaunches, [{ executablePath: exe, args: [] }]);
    assert.deepEqual(elevatedLaunches, []);
  } finally {
    fs4.rmSync(root, { recursive: true, force: true });
  }
});
