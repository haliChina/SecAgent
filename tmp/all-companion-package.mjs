// src/companion-package.test.ts
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import os2 from "node:os";
import path2 from "node:path";
import test from "node:test";
import AdmZip2 from "adm-zip";

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

// src/companion-package.test.ts
function archiveBytes(manifestName, manifest) {
  const zip = new AdmZip2();
  zip.addFile(manifestName, Buffer.from(manifest, "utf8"));
  zip.addFile("Companion.Plugin.dll", Buffer.from("test dll", "utf8"));
  const archivePath = path2.join(os2.tmpdir(), `secagent-companion-package-${crypto2.randomUUID()}.zip`);
  try {
    zip.writeZip(archivePath);
    return fs2.readFileSync(archivePath);
  } finally {
    fs2.rmSync(archivePath, { force: true });
  }
}
test("installs a YAML companion package into the final plugin directory", async () => {
  const root = fs2.mkdtempSync(path2.join(os2.tmpdir(), "secagent-companion-direct-"));
  try {
    const destination = path2.join(root, "data", "Plugins", "classisland.secagent");
    const bytes = archiveBytes("manifest.yml", "id: classisland.secagent\nentranceAssembly: Companion.Plugin.dll\nversion: 1.0.0\n");
    const events = [];
    const actual = await installCompanionPackage(destination, bytes, { pluginId: "classisland.secagent", manifestFileName: "manifest.yml" }, process.platform, void 0, (stage) => events.push(stage));
    assert.equal(actual, destination);
    assert.equal(fs2.existsSync(path2.join(destination, "manifest.yml")), true);
    assert.equal(fs2.existsSync(path2.join(destination, "Companion.Plugin.dll")), true);
    assert.equal(events.includes("package.install.direct.success"), true);
  } finally {
    fs2.rmSync(root, { recursive: true, force: true });
  }
});
test("replaces an existing companion package and preserves its disabled marker", async () => {
  const root = fs2.mkdtempSync(path2.join(os2.tmpdir(), "secagent-companion-replace-"));
  try {
    const destination = path2.join(root, "Plugins", "inkcanvas.iccce.secagent");
    fs2.mkdirSync(destination, { recursive: true });
    fs2.writeFileSync(path2.join(destination, ".disabled"), "");
    fs2.writeFileSync(path2.join(destination, "old.dll"), "old");
    const bytes = archiveBytes("manifest.json", JSON.stringify({ Id: "inkcanvas.iccce.secagent", EntranceAssembly: "Companion.Plugin.dll", Version: "1.0.0" }));
    await installCompanionPackage(destination, bytes, { pluginId: "inkcanvas.iccce.secagent", manifestFileName: "manifest.json" }, process.platform);
    assert.equal(fs2.existsSync(path2.join(destination, ".disabled")), true);
    assert.equal(fs2.existsSync(path2.join(destination, "old.dll")), false);
    assert.equal(fs2.existsSync(path2.join(destination, "Companion.Plugin.dll")), true);
  } finally {
    fs2.rmSync(root, { recursive: true, force: true });
  }
});
test("rejects an invalid companion package before touching the destination", async () => {
  const root = fs2.mkdtempSync(path2.join(os2.tmpdir(), "secagent-companion-invalid-"));
  try {
    const destination = path2.join(root, "Plugins", "secrandom.secagent");
    fs2.mkdirSync(destination, { recursive: true });
    fs2.writeFileSync(path2.join(destination, "keep.txt"), "keep");
    const bytes = archiveBytes("manifest.yml", "id: another.plugin\nentranceAssembly: Companion.Plugin.dll\n");
    await assert.rejects(
      () => installCompanionPackage(destination, bytes, { pluginId: "secrandom.secagent", manifestFileName: "manifest.yml" }, process.platform),
      /ID 不匹配/
    );
    assert.equal(fs2.existsSync(path2.join(destination, "keep.txt")), true);
  } finally {
    fs2.rmSync(root, { recursive: true, force: true });
  }
});
test("elevated worker script never reassigns the case-insensitive $Root variable", () => {
  assert.equal(/\$root\s*(=|\+=|-=|\+\+|--)/i.test(ELEVATED_WORKER_SCRIPT), false, "script assigns $root (case-insensitive collision with the $Root parameter)");
  assert.equal(/foreach\s*\(\s*\$root\s+in\b/i.test(ELEVATED_WORKER_SCRIPT), false, "script loops over $root (case-insensitive collision with the $Root parameter)");
});
test("elevated worker script file starts with a UTF-8 BOM", () => {
  assert.equal(elevatedWorkerScriptFileContents().charCodeAt(0), 65279, "worker script file must start with a UTF-8 BOM");
});
test("elevated worker keeps answering after an enumerate request (real protocol run)", { skip: process.platform !== "win32" }, async (t) => {
  const protocolRoot = fs2.mkdtempSync(path2.join(os2.tmpdir(), "secagent-worker-protocol-"));
  const fakeInstallRoot = fs2.mkdtempSync(path2.join(os2.tmpdir(), "secagent-worker-install-"));
  const scriptPath = path2.join(protocolRoot, "worker.ps1");
  fs2.writeFileSync(scriptPath, elevatedWorkerScriptFileContents(), "utf8");
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-NoLogo",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Root",
    protocolRoot
  ], { stdio: ["ignore", "ignore", "ignore"] });
  t.after(() => {
    if (child.exitCode === null) child.kill();
    fs2.rmSync(protocolRoot, { recursive: true, force: true });
    fs2.rmSync(fakeInstallRoot, { recursive: true, force: true });
  });
  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };
  const sendRequest = async (id, body) => {
    fs2.writeFileSync(path2.join(protocolRoot, `request-${id}.json`), JSON.stringify({ id, ...body }), "utf8");
    if (!await waitFor(() => fs2.existsSync(path2.join(protocolRoot, `result-${id}.json`)), 2e4)) return void 0;
    const response = JSON.parse(fs2.readFileSync(path2.join(protocolRoot, `result-${id}.json`), "utf8"));
    fs2.rmSync(path2.join(protocolRoot, `result-${id}.json`), { force: true });
    return response;
  };
  assert.equal(await waitFor(() => fs2.existsSync(path2.join(protocolRoot, "ready")), 3e4), true, "worker never became ready");
  const enumerated = await sendRequest("aaaa0000-0000-0000-0000-000000000001", { action: "enumerate", data: { names: ["DefinitelyNotRunning.exe"], roots: [fakeInstallRoot] } });
  assert.equal(enumerated?.ok, true, "enumerate was not answered");
  assert.deepEqual(enumerated?.processes, []);
  assert.equal(fs2.readdirSync(fakeInstallRoot).length, 0, "enumerate leaked a result file into the roots directory");
  const probe = await sendRequest("aaaa0000-0000-0000-0000-000000000002", { action: "is-running", data: { pid: process.pid } });
  assert.equal(probe?.ok, true, "worker went silent after the enumerate request");
  assert.equal(probe?.running, true);
  fs2.writeFileSync(path2.join(protocolRoot, "request-shutdown.json"), JSON.stringify({ id: "shutdown", action: "shutdown", data: {} }), "utf8");
  assert.equal(await waitFor(() => child.exitCode !== null, 15e3), true, "worker ignored the shutdown request");
  assert.equal(child.exitCode, 0);
});
