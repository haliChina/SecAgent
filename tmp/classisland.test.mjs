// src/classisland.test.ts
import assert from "node:assert/strict";
import crypto3 from "node:crypto";
import fs3 from "node:fs";
import os3 from "node:os";
import path4 from "node:path";
import test from "node:test";

// src/classisland.ts
import os2 from "node:os";
import path3 from "node:path";
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify3 } from "node:util";

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

// src/companion-installer-shared.ts
import { execFile as execFile2 } from "node:child_process";
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";
import { promisify as promisify2 } from "node:util";

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

// src/companion-installer-shared.ts
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
    const script = `$item = Get-Item -LiteralPath ${quotePowerShell2(executablePath)}; $item.VersionInfo.ProductVersion`;
    try {
      const result = await commandRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
      return result.stdout.trim() || void 0;
    } catch {
      return void 0;
    }
  }
  if (platform === "darwin") {
    const api = path2.posix;
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
      const actual = crypto2.createHash("sha256").update(bytes).digest("hex");
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

// src/classisland.ts
var CLASSISLAND_PLUGIN_REPOSITORY = "SECTL/ClassIsland-SecAgent-Plugin";
var CLASSISLAND_PLUGIN_ID = "classisland.secagent";
var CLASSISLAND_PLUGIN_ASSET_NAME = "ClassIsland.SecAgent.Plugin.cipx";
var MIN_CLASSISLAND_VERSION = "2.0.0.0";
var CLASSISLAND_RELEASE_API_URL = `https://api.github.com/repos/${CLASSISLAND_PLUGIN_REPOSITORY}/releases/latest`;
var CLASSISLAND_RELEASE_PAGE_URL = `https://github.com/${CLASSISLAND_PLUGIN_REPOSITORY}/releases/latest`;
var CLASSISLAND_PLUGIN_VERSION_PATTERN = /^version\s*:\s*["']?([^"'\r\n#]+)["']?/im;
var CLASSISLAND_PLUGIN_ID_PATTERN = /^id\s*:\s*["']?([^"'\r\n#]+)["']?/im;
var CLASSISLAND_PLUGIN_ENTRANCE_PATTERN = /^entranceAssembly\s*:\s*["']?([^"'\r\n#]+)["']?/im;
var WINDOWS_CLASSISLAND_EXE = "ClassIsland.exe";
var WINDOWS_CLASSISLAND_RUNTIME_EXE = "ClassIsland.Desktop.exe";
var MAX_CLASSISLAND_PLUGIN_BYTES = 100 * 1024 * 1024;
var CLASSISLAND_DOWNLOAD_SPEC = {
  productName: "ClassIsland",
  releaseApiUrl: CLASSISLAND_RELEASE_API_URL,
  releasePageUrl: CLASSISLAND_RELEASE_PAGE_URL,
  repository: CLASSISLAND_PLUGIN_REPOSITORY,
  assetName: CLASSISLAND_PLUGIN_ASSET_NAME,
  maxBytes: MAX_CLASSISLAND_PLUGIN_BYTES
};
var CLASSISLAND_HEALTH_URL = "http://127.0.0.1:18789/health";
var execFileAsync3 = promisify3(execFile3);
function canonicalClassIslandExecutable(executablePath, platform, exists) {
  if (platform !== "win32") return executablePath;
  const api = path3.win32;
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
function isClassIslandRuntimeProcess(processInfo) {
  return (processInfo.processName || path3.win32.basename(processInfo.executablePath)).toLowerCase() === WINDOWS_CLASSISLAND_RUNTIME_EXE.toLowerCase();
}
function potentialExecutablePaths(input, platform) {
  const api = platformPath(platform);
  const normalizedInput = input.trim().replace(/,\d+$/, "").replace(/^"(.*)"$/, "$1");
  if (api.extname(normalizedInput).toLowerCase() === (platform === "win32" ? ".exe" : "")) return [normalizedInput];
  if (platform === "darwin" && normalizedInput.endsWith(".app")) return [api.join(normalizedInput, "Contents", "MacOS", "ClassIsland")];
  return platform === "win32" ? [api.join(normalizedInput, WINDOWS_CLASSISLAND_EXE), api.join(normalizedInput, "ClassIsland", WINDOWS_CLASSISLAND_EXE)] : [api.join(normalizedInput, "ClassIsland")];
}
function staticExecutablePaths(platform, home, env) {
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
function readPackageType(executablePath, platform, env, readFile) {
  const api = platformPath(platform);
  const executableDirectory = api.dirname(executablePath);
  const overrideRoot = env.ClassIsland_PackageRoot?.trim();
  if (overrideRoot) {
    const typePath = api.join(overrideRoot, "PackageType");
    try {
      return { packageRoot: api.resolve(overrideRoot), packageType: readFile(typePath).trim() || void 0 };
    } catch {
      return { packageRoot: api.resolve(overrideRoot) };
    }
  }
  for (const [packageRoot, typePath] of [[executableDirectory, api.join(executableDirectory, "PackageType")], [api.dirname(executableDirectory), api.join(api.dirname(executableDirectory), "PackageType")]]) {
    try {
      const packageType = readFile(typePath).replace(/[\r\n]/g, "").trim();
      if (packageType) return { packageRoot: api.resolve(packageRoot), packageType };
    } catch {
    }
  }
  return { packageRoot: api.resolve(executableDirectory) };
}
function resolveClassIslandLayout(executablePath, options = {}) {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const home = options.home || os2.homedir();
  const env = options.env || process.env;
  const readFile = options.readFile || defaultReadFile;
  const marker = readPackageType(executablePath, platform, env, readFile);
  const portable = marker.packageType?.toLowerCase() === "folder";
  const appData = platform === "win32" ? env.APPDATA || api.join(home, "AppData", "Roaming") : platform === "darwin" ? api.join(home, "Library", "Application Support") : env.XDG_CONFIG_HOME || api.join(home, ".config");
  const dataRoot = portable ? api.join(marker.packageRoot, "data") : ["installer", "deb", "appimage", "pkg", "msix"].includes(marker.packageType?.toLowerCase() || "") || platform === "darwin" ? api.join(appData, "ClassIsland", "Data") : marker.packageRoot;
  return { packageRoot: marker.packageRoot, dataRoot, pluginPackagesPath: api.join(dataRoot, "Cache", "PluginPackages"), ...marker.packageType ? { packageType: marker.packageType } : {} };
}
function installedPluginVersion(dataRoot, platform, exists, readFile) {
  const api = platformPath(platform);
  const pluginPath = api.join(dataRoot, "Plugins", CLASSISLAND_PLUGIN_ID);
  const manifestPath = api.join(pluginPath, "manifest.yml");
  if (!exists(manifestPath)) return void 0;
  if (exists(api.join(pluginPath, ".disabled")) || exists(api.join(pluginPath, ".uninstall"))) return void 0;
  try {
    const manifest = readFile(manifestPath);
    if (CLASSISLAND_PLUGIN_ID_PATTERN.exec(manifest)?.[1]?.trim().toLowerCase() !== CLASSISLAND_PLUGIN_ID) return void 0;
    const entranceAssembly = CLASSISLAND_PLUGIN_ENTRANCE_PATTERN.exec(manifest)?.[1]?.trim();
    if (!entranceAssembly || entranceAssembly.includes("..") || entranceAssembly.includes("/") || entranceAssembly.includes("\\")) return void 0;
    if (!exists(api.join(pluginPath, entranceAssembly))) return void 0;
    return CLASSISLAND_PLUGIN_VERSION_PATTERN.exec(manifest)?.[1]?.trim();
  } catch {
    return void 0;
  }
}
async function probeClassIslandPluginDetailed(fetcher) {
  try {
    const response = await fetcher(CLASSISLAND_HEALTH_URL, { signal: AbortSignal.timeout(1500), headers: { Accept: "application/json" } });
    if (!response.ok) return { healthy: false, reason: `\u5065\u5EB7\u68C0\u67E5\u8FD4\u56DE HTTP ${response.status}`, status: response.status };
    const payload = await response.json();
    if (payload.apiVersion === 1 && payload.name === "classisland" && payload.status === "ok") return { healthy: true, reason: "ok", status: response.status };
    return { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u8FD4\u56DE\u5185\u5BB9\u4E0D\u5339\u914D", status: response.status };
  } catch {
    return { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u670D\u52A1\u672A\u54CD\u5E94" };
  }
}
async function probeClassIslandPlugin(fetcher) {
  return (await probeClassIslandPluginDetailed(fetcher)).healthy;
}
async function waitForClassIslandHealth(fetcher, timeoutMs = 45e3, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = { healthy: false, reason: "\u5065\u5EB7\u68C0\u67E5\u670D\u52A1\u672A\u54CD\u5E94" };
  while (true) {
    last = await probeClassIslandPluginDetailed(fetcher);
    if (last.healthy) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
function compareClassIslandVersions(left, right) {
  return compareVersions(left, right);
}
function isCompatibleClassIslandVersion(version) {
  return Boolean(version && compareClassIslandVersions(version, MIN_CLASSISLAND_VERSION) >= 0);
}
async function discoverClassIslandInstallations(options = {}) {
  const platform = options.platform || process.platform;
  const api = platformPath(platform);
  const home = options.home || os2.homedir();
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
    const previous = runningByPath.get(key);
    if (!previous || isClassIslandRuntimeProcess(item) && !isClassIslandRuntimeProcess(previous)) runningByPath.set(key, item);
  }
  const runningByName = /* @__PURE__ */ new Map();
  for (const item of running) {
    if (/[\\/]/.test(item.executablePath)) continue;
    const key = api.basename(item.executablePath).toLowerCase();
    const previous = runningByName.get(key);
    if (!previous || isClassIslandRuntimeProcess(item) && !isClassIslandRuntimeProcess(previous)) runningByName.set(key, item);
  }
  const versionOf = options.versionOf || ((executablePath) => defaultVersionOf(executablePath, platform, commandRunner));
  for (const executablePath of [...new Set(inputPaths.map((item) => api.normalize(item)))]) {
    if (!exists(executablePath)) continue;
    const processInfo = runningByPath.get(normalizePath(executablePath, platform)) || runningByName.get(api.basename(executablePath).toLowerCase());
    const version = processInfo?.version || await versionOf(executablePath);
    const layout = resolveClassIslandLayout(executablePath, { platform, home, env, readFile });
    const compatible = isCompatibleClassIslandVersion(version);
    const installedVersion = installedPluginVersion(layout.dataRoot, platform, exists, readFile);
    const pluginHealthy = processInfo && fetcher ? await probeClassIslandPlugin(fetcher) : void 0;
    const processIds = processInfo ? runningPidsByPath.get(normalizePath(executablePath, platform)) : void 0;
    const candidate = {
      id: hashId(executablePath, layout.dataRoot, platform),
      executablePath,
      rootPath: layout.packageRoot,
      dataRoot: layout.dataRoot,
      pluginPackagesPath: layout.pluginPackagesPath,
      ...version ? { version } : {},
      ...installedVersion ? { installedPluginVersion: installedVersion } : {},
      ...pluginHealthy !== void 0 ? { pluginHealthy } : {},
      ...layout.packageType ? { packageType: layout.packageType } : {},
      isRunning: Boolean(processInfo),
      ...processInfo ? { pid: processInfo.pid, launchArgs: parseWindowsCommandLine(processInfo.commandLine).slice(1) } : { launchArgs: [] },
      ...processIds?.length ? { processIds: [...processIds] } : {},
      source: processInfo ? "running-process" : options.executablePaths?.includes(executablePath) ? "manual-or-explicit" : "discovery",
      compatible,
      ...compatible ? {} : { reason: version ? `ClassIsland \u7248\u672C\u8FC7\u4F4E\uFF0C\u9700\u8981 ${MIN_CLASSISLAND_VERSION} \u53CA\u4EE5\u4E0A` : "\u65E0\u6CD5\u786E\u8BA4 ClassIsland \u7248\u672C\uFF0C\u8BF7\u9009\u62E9\u53EF\u8BC6\u522B\u7684 ClassIsland.exe" },
      canonicalExecutablePath: normalizePath(executablePath, platform),
      canonicalDataRoot: normalizePath(layout.dataRoot, platform)
    };
    const key = `${candidate.canonicalExecutablePath}\0${candidate.canonicalDataRoot}`;
    const previous = candidates.get(key);
    if (!previous || !previous.isRunning && candidate.isRunning) candidates.set(key, candidate);
  }
  return [...candidates.values()].map(({ canonicalExecutablePath: _executable, canonicalDataRoot: _data, ...candidate }) => candidate);
}
function isClassIslandPluginReady(candidate) {
  return Boolean(candidate.installedPluginVersion && (!candidate.isRunning || candidate.pluginHealthy === true));
}
function classIslandRestartArgs(args) {
  return args.filter((arg) => !/^--?waitmutex$/i.test(arg) && !/^-m$/i.test(arg));
}
var ClassIslandInstaller = class {
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
    const discovered = await discoverClassIslandInstallations({ ...this.options, fetcher: this.fetcher, commandRunner: this.commandRunner, platform: this.platform, executablePaths: [...this.options.executablePaths || [], ...[...this.candidates.values()].map((candidate) => candidate.executablePath)] });
    this.candidates = new Map(discovered.map((candidate) => [candidate.id, candidate]));
    return discovered;
  }
  async inspect(executablePath) {
    const discovered = await discoverClassIslandInstallations({ ...this.options, fetcher: this.fetcher, commandRunner: this.commandRunner, platform: this.platform, executablePaths: [executablePath] });
    const candidate = discovered[0];
    if (candidate) this.candidates.set(candidate.id, candidate);
    return candidate;
  }
  async install(targetIds, onProgress, executor) {
    const latestCandidates = await this.detect();
    const selected = latestCandidates.filter((candidate) => targetIds.includes(candidate.id));
    const missing = targetIds.filter((id) => !selected.some((candidate) => candidate.id === id)).map((targetId) => ({ targetId, ok: false, action: "failed", message: "\u627E\u4E0D\u5230 ClassIsland \u5B89\u88C5\u76EE\u6807\uFF0C\u8BF7\u91CD\u65B0\u68C0\u6D4B" }));
    if (!selected.length) return missing;
    const invalid = selected.filter((candidate) => !candidate.compatible);
    const valid = selected.filter((candidate) => candidate.compatible);
    const results = invalid.map((candidate) => ({ targetId: candidate.id, ok: false, action: "skipped", message: candidate.reason || "ClassIsland \u7248\u672C\u4E0D\u517C\u5BB9" }));
    if (!valid.length) return [...results, ...missing];
    const report = (phase, message, percent) => {
      const phasePercent = percent ?? { downloading: 18, verifying: 38, installing: 62, closing: 72, restarting: 80 }[phase];
      onProgress?.({ phase, targetIds, percent: phasePercent, ...message ? { message } : {} });
    };
    const log = (stage, data = {}) => this.options.log?.(`companion.classisland.${stage}`, data);
    log("install.begin", { targetIds, candidates: selected.map((candidate) => ({ id: candidate.id, executablePath: candidate.executablePath, dataRoot: candidate.dataRoot, pluginPackagesPath: candidate.pluginPackagesPath, version: candidate.version, installedPluginVersion: candidate.installedPluginVersion, pluginHealthy: candidate.pluginHealthy, isRunning: candidate.isRunning, pid: candidate.pid, processIds: candidate.processIds })) });
    const packageData = await downloadLatestCompanionPlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log("download.attempt", attempt), CLASSISLAND_DOWNLOAD_SPEC);
    log("download.success", { version: packageData.version, bytes: packageData.bytes.length, sha256: packageData.sha256, repository: CLASSISLAND_PLUGIN_REPOSITORY, asset: CLASSISLAND_PLUGIN_ASSET_NAME });
    const api = platformPath(this.platform);
    const restart = this.options.restartProcess || ((executablePath, args) => startCompanionProcessWithSameElevation(executablePath, args, this.platform, (stage, data) => log(stage, data)));
    const isRunning = this.options.isProcessRunning || ((pid) => executor ? executor.isProcessRunning(pid, (stage, data) => log(stage, data)) : defaultIsProcessRunning(pid));
    const requestClose = this.options.requestGracefulClose || ((pid) => executor ? executor.requestGracefulClose(pid, (stage, data) => log(stage, data)) : defaultRequestGracefulClose(pid, this.platform, this.commandRunner));
    const forceTerminate = this.options.forceTerminateProcess || ((pid) => executor ? executor.forceTerminate(pid, (stage, data) => log(stage, data)) : defaultForceTerminate(pid, this.platform, this.commandRunner));
    const gracefulCloseTimeoutMs = this.options.gracefulCloseTimeoutMs ?? 2e3;
    const restartArgsOf = (candidate) => classIslandRestartArgs(candidate.launchArgs);
    const exists = this.options.exists || defaultExists;
    const readFile = this.options.readFile || defaultReadFile;
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
      const key = normalizePath(candidate.dataRoot, this.platform);
      groups.set(key, [...groups.get(key) || [], candidate]);
    }
    for (const group of groups.values()) {
      log("group.begin", { dataRoot: group[0].dataRoot, targets: group.map((candidate) => candidate.id), pluginPackagesPath: group[0].pluginPackagesPath });
      const alreadyInstalled = group.every((candidate) => isClassIslandPluginReady(candidate) && compareClassIslandVersions(candidate.installedPluginVersion, packageData.version) >= 0);
      if (alreadyInstalled) {
        for (const candidate of group) results.push({ targetId: candidate.id, ok: true, action: "already-installed", message: `\u5DF2\u5B89\u88C5 ClassIsland \u63D2\u4EF6 v${packageData.version}`, version: packageData.version });
        continue;
      }
      const pluginPath = api.join(group[0].dataRoot, "Plugins", CLASSISLAND_PLUGIN_ID);
      let preinstalled = false;
      try {
        report("installing", "\u6B63\u5728\u5199\u5165 ClassIsland \u63D2\u4EF6\u6587\u4EF6");
        const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: CLASSISLAND_PLUGIN_ID, manifestFileName: "manifest.yml" });
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
        names: [WINDOWS_CLASSISLAND_EXE, WINDOWS_CLASSISLAND_RUNTIME_EXE],
        roots: [...new Set(group.map((candidate) => api.dirname(candidate.executablePath)))]
      };
      const listProcesses = this.options.listProcesses ? (filter) => this.options.listProcesses(filter) : (filter) => enumerateHostProcesses(filter, this.platform, executor, this.commandRunner, (stage, data) => log(stage, data));
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
        const restarted = /* @__PURE__ */ new Set();
        for (const { candidate } of closed) {
          if (restarted.has(candidate.id)) continue;
          restarted.add(candidate.id);
          await restart(candidate.executablePath, restartArgsOf(candidate)).catch(() => void 0);
        }
        for (const candidate of group) results.push({
          targetId: candidate.id,
          ok: false,
          action: "failed",
          message: closeOutcome.remaining.length ? `ClassIsland \u8FDB\u7A0B ${closeOutcome.remaining.map((item) => item.pid).join("\u3001")} \u65E0\u6CD5\u9000\u51FA\uFF08${closeOutcome.remaining.map((item) => item.name || item.executablePath || `pid ${item.pid}`).join("\u3001")}\uFF09\uFF0C\u8BF7\u624B\u52A8\u5173\u95ED\u540E\u91CD\u8BD5` : preinstalled ? "\u63D2\u4EF6\u6587\u4EF6\u5DF2\u5199\u5165\uFF0C\u4F46 ClassIsland \u65E0\u6CD5\u81EA\u52A8\u9000\u51FA\uFF1B\u8BF7\u624B\u52A8\u91CD\u542F ClassIsland \u540E\u91CD\u65B0\u68C0\u6D4B" : "ClassIsland \u65E0\u6CD5\u9000\u51FA\uFF0C\u5F3A\u5236\u7ED3\u675F\u4E5F\u5931\u8D25\uFF0C\u672A\u5B89\u88C5\u63D2\u4EF6\uFF1B\u8BF7\u624B\u52A8\u5173\u95ED\u540E\u91CD\u8BD5"
        });
        continue;
      }
      try {
        if (!preinstalled) {
          report("installing", "\u6B63\u5728\u89E3\u538B\u5B89\u88C5 ClassIsland \u63D2\u4EF6");
          const actualPluginPath = await installPackage(pluginPath, packageData.bytes, { pluginId: CLASSISLAND_PLUGIN_ID, manifestFileName: "manifest.yml" });
          log("package.install.result", { requestedPath: pluginPath, actualPluginPath });
        }
        const launchCandidate = closed[0]?.candidate || group[0];
        const restarting = running.length > 0;
        const launchArgs = restartArgsOf(launchCandidate);
        report("restarting", restarting ? "\u6B63\u5728\u91CD\u65B0\u542F\u52A8 ClassIsland" : "\u6B63\u5728\u542F\u52A8 ClassIsland");
        log("process.restart.begin", { executablePath: launchCandidate.executablePath, args: launchArgs, inheritedArgs: launchCandidate.launchArgs, wasRunning: restarting, closedPids: closed.map((item) => item.pid) });
        let launchFailed = false;
        try {
          await restart(launchCandidate.executablePath, launchArgs);
          log("process.restart.success", { executablePath: launchCandidate.executablePath, args: launchArgs });
        } catch (error) {
          launchFailed = true;
          log("process.restart.failed", { executablePath: launchCandidate.executablePath, error: error instanceof Error ? error.message : String(error) });
        }
        if (!launchFailed) report("verifying", "\u6B63\u5728\u7B49\u5F85 ClassIsland \u63D2\u4EF6\u54CD\u5E94", 94);
        const writtenVersion = installedPluginVersion(group[0].dataRoot, this.platform, exists, readFile);
        const verifiedVersion = launchFailed ? void 0 : await waitForInstalledPlugin(
          () => installedPluginVersion(group[0].dataRoot, this.platform, exists, readFile),
          packageData.version,
          this.options.waitForPluginTimeoutMs,
          this.options.waitForPluginPollMs
        );
        const health = launchFailed ? { healthy: false, reason: "\u5BF9\u65B9\u8F6F\u4EF6\u672A\u6210\u529F\u542F\u52A8" } : await waitForClassIslandHealth(this.fetcher, this.options.waitForPluginTimeoutMs, this.options.waitForPluginPollMs);
        const pluginHealthy = health.healthy;
        const verified = Boolean(verifiedVersion) && pluginHealthy;
        const detectedVersion = verified ? verifiedVersion : writtenVersion;
        try {
          const snapshot = await listProcesses(processFilter);
          log("process.post-restart.snapshot", { processes: snapshot });
        } catch {
        }
        log("verification.result", { expectedVersion: packageData.version, writtenVersion, verifiedVersion, detectedVersion, pluginHealthy, healthReason: health.reason, healthStatus: health.status, healthUrl: CLASSISLAND_HEALTH_URL, verified, launchFailed });
        for (const candidate of group) {
          results.push({
            targetId: candidate.id,
            ok: !launchFailed && verified,
            action: !launchFailed && verified ? "installed" : "failed",
            message: launchFailed ? `\u63D2\u4EF6\u5305\u5DF2\u5199\u5165\uFF0C\u4F46 ClassIsland \u81EA\u52A8${restarting ? "\u91CD\u542F" : "\u542F\u52A8"}\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u542F\u52A8` : verified ? restarting ? `\u5DF2\u5B89\u88C5 ClassIsland \u63D2\u4EF6 v${verifiedVersion}\uFF0CClassIsland \u5DF2\u81EA\u52A8\u91CD\u542F` : `\u5DF2\u5B89\u88C5 ClassIsland \u63D2\u4EF6 v${verifiedVersion}\uFF0CClassIsland \u5DF2\u81EA\u52A8\u542F\u52A8` : verifiedVersion ? `\u63D2\u4EF6\u6587\u4EF6\u5DF2\u5199\u5165\uFF0C\u4F46 ClassIsland \u5C1A\u672A\u52A0\u8F7D\u63D2\u4EF6\uFF08${health.reason}\uFF09\uFF0C\u8BF7\u91CD\u8BD5\u6216\u624B\u52A8\u91CD\u542F ClassIsland` : `\u63D2\u4EF6\u5DF2\u89E3\u538B\u5E76\u542F\u52A8\uFF0C\u4F46\u672A\u68C0\u6D4B\u5230 ClassIsland \u63D2\u4EF6\uFF08${health.reason}\uFF09\uFF0C\u8BF7\u67E5\u770B\u8BCA\u65AD\u65E5\u5FD7\u540E\u91CD\u8BD5`,
            ...verified && detectedVersion ? { version: detectedVersion } : {}
          });
        }
      } catch (error) {
        log("install.failed", { error: error instanceof Error ? error.message : String(error) });
        const restarted = /* @__PURE__ */ new Set();
        for (const { candidate } of closed) {
          if (restarted.has(candidate.id)) continue;
          restarted.add(candidate.id);
          await restart(candidate.executablePath, restartArgsOf(candidate)).catch(() => void 0);
        }
        for (const candidate of group) results.push({ targetId: candidate.id, ok: false, action: "failed", message: `\u5B89\u88C5 ClassIsland \u63D2\u4EF6\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}` });
      }
    }
    return [...results, ...missing];
  }
};

// src/classisland.test.ts
function writeClassIslandManifest(root, version = "0.1.0.1") {
  const manifestPath = path4.win32.join(root, "data", "Plugins", "classisland.secagent", "manifest.yml");
  fs3.mkdirSync(path4.win32.dirname(manifestPath), { recursive: true });
  fs3.writeFileSync(manifestPath, `id: classisland.secagent
entranceAssembly: ClassIsland.SecAgent.Plugin.dll
version: ${version}
`);
  fs3.writeFileSync(path4.win32.join(path4.win32.dirname(manifestPath), "ClassIsland.SecAgent.Plugin.dll"), "test assembly");
}
function removeInstalledPlugin(root) {
  const pluginPath = path4.win32.join(root, "data", "Plugins", "classisland.secagent");
  fs3.rmSync(path4.win32.join(pluginPath, "manifest.yml"), { force: true });
  fs3.rmSync(path4.win32.join(pluginPath, "ClassIsland.SecAgent.Plugin.dll"), { force: true });
  fs3.rmSync(pluginPath, { recursive: true, force: true });
}
function classIslandHealthResponse(input) {
  return String(input) === "http://127.0.0.1:18789/health" ? new Response(JSON.stringify({ apiVersion: 1, name: "classisland", status: "ok" }), { status: 200 }) : void 0;
}
test("ClassIsland versions enforce the 2.0.0.0 minimum", () => {
  assert.equal(compareClassIslandVersions("2.0.0.0", "2.0.0.0"), 0);
  assert.equal(compareClassIslandVersions("2.0.0.1", "2.0.0.0") > 0, true);
  assert.equal(compareClassIslandVersions("1.9.0.9", "2.0.0.0") < 0, true);
  assert.equal(isCompatibleClassIslandVersion("2.0.0.0"), true);
  assert.equal(isCompatibleClassIslandVersion("1.9.0.9"), false);
  assert.equal(isCompatibleClassIslandVersion(void 0), false);
});
test("resolves portable and installer ClassIsland data directories", () => {
  const home = "C:\\Users\\teacher";
  const env = { APPDATA: "C:\\Users\\teacher\\AppData\\Roaming" };
  const portableExe = "D:\\Apps\\ClassIsland\\ClassIsland.exe";
  const portable = resolveClassIslandLayout(portableExe, {
    platform: "win32",
    home,
    env,
    readFile: (filePath) => filePath.endsWith("\\PackageType") ? "folder\n" : ""
  });
  assert.equal(portable.dataRoot, "D:\\Apps\\ClassIsland\\data");
  assert.equal(portable.pluginPackagesPath, "D:\\Apps\\ClassIsland\\data\\Cache\\PluginPackages");
  const installedExe = "C:\\Program Files\\ClassIsland\\ClassIsland.exe";
  const installed = resolveClassIslandLayout(installedExe, {
    platform: "win32",
    home,
    env,
    readFile: (filePath) => filePath.endsWith("\\PackageType") ? "installer\n" : ""
  });
  assert.equal(installed.dataRoot, "C:\\Users\\teacher\\AppData\\Roaming\\ClassIsland\\Data");
});
test("discovers multiple ClassIsland versions and marks old versions incompatible", async () => {
  const paths = ["C:\\Portable\\ClassIsland.exe", "D:\\Old\\ClassIsland.exe", "C:\\Program Files\\ClassIsland\\ClassIsland.exe"];
  const versions = {
    [paths[0]]: "2.1.1.0",
    [paths[1]]: "1.9.0.0",
    [paths[2]]: "2.0.4.0"
  };
  const found = await discoverClassIslandInstallations({
    platform: "win32",
    home: "C:\\Users\\teacher",
    env: { APPDATA: "C:\\Users\\teacher\\AppData\\Roaming" },
    executablePaths: paths,
    runningProcesses: [{ executablePath: paths[0], pid: 12, commandLine: `"${paths[0]}" --quiet`, version: versions[paths[0]] }],
    exists: (candidate) => paths.includes(candidate),
    versionOf: (executablePath) => versions[executablePath],
    readFile: (filePath) => filePath.endsWith("\\PackageType") ? filePath.includes("Portable") ? "folder" : "installer" : ""
  });
  assert.equal(found.length, 3);
  assert.equal(found.find((item) => item.executablePath === paths[0])?.isRunning, true);
  assert.deepEqual(found.find((item) => item.executablePath === paths[0])?.launchArgs, ["--quiet"]);
  assert.equal(found.find((item) => item.executablePath === paths[1])?.compatible, false);
  assert.match(found.find((item) => item.executablePath === paths[1])?.reason || "", /2\.0\.0\.0/);
  assert.equal(found.find((item) => item.executablePath === paths[2])?.compatible, true);
});
test("maps the running ClassIsland.Desktop process back to its launcher and closes the real instance", async () => {
  const root = "C:\\Portable\\ClassIsland";
  const launcher = path4.win32.join(root, "ClassIsland.exe");
  const runtime = path4.win32.join(root, "app-2.1.1.1", "ClassIsland.Desktop.exe");
  const found = await discoverClassIslandInstallations({
    platform: "win32",
    home: "C:\\Users\\teacher",
    env: { APPDATA: "C:\\Users\\teacher\\AppData\\Roaming" },
    executablePaths: [launcher],
    runningProcesses: [{ executablePath: runtime, pid: 99, commandLine: `"${runtime}" --profile school`, version: "2.1.1.1", processName: "ClassIsland.Desktop.exe" }],
    exists: (candidate) => candidate === launcher || candidate === runtime,
    versionOf: () => "2.1.1.1",
    readFile: (filePath) => filePath.endsWith("\\PackageType") ? "folder" : ""
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].executablePath, launcher);
  assert.equal(found[0].isRunning, true);
  assert.equal(found[0].pid, 99);
  assert.deepEqual(found[0].launchArgs, ["--profile", "school"]);
  assert.equal(found[0].dataRoot, path4.win32.join(root, "data"));
});
test("keeps every running ClassIsland process for single-instance shutdown", async () => {
  const root = "C:\\Portable\\ClassIsland";
  const launcher = path4.win32.join(root, "ClassIsland.exe");
  const runtime = path4.win32.join(root, "app-2.1.1.1", "ClassIsland.Desktop.exe");
  const found = await discoverClassIslandInstallations({
    platform: "win32",
    home: "C:\\Users\\teacher",
    env: { APPDATA: "C:\\Users\\teacher\\AppData\\Roaming" },
    executablePaths: [launcher],
    runningProcesses: [
      { executablePath: launcher, pid: 98, commandLine: `"${launcher}"`, version: "2.1.1.1", processName: "ClassIsland.exe" },
      { executablePath: runtime, pid: 99, commandLine: `"${runtime}" --profile school`, version: "2.1.1.1", processName: "ClassIsland.Desktop.exe" }
    ],
    exists: (candidate) => candidate === launcher || candidate === runtime,
    versionOf: () => "2.1.1.1",
    readFile: (filePath) => filePath.endsWith("\\PackageType") ? "folder" : ""
  });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].processIds, [98, 99]);
  assert.equal(found[0].pid, 99);
});
test("scans Windows external locations when the installer has no explicit executable paths", async () => {
  const exe = "C:\\Program Files\\ClassIsland\\ClassIsland.exe";
  const commandRunner = async (_file, args) => ({
    stdout: args.join(" ").includes("WScript.Shell") ? "[]" : JSON.stringify([exe]),
    stderr: ""
  });
  const installer = new ClassIslandInstaller({
    platform: "win32",
    executablePaths: [],
    commandRunner,
    versionOf: () => "2.1.1.0",
    exists: (candidate) => candidate === exe,
    readFile: () => "installer"
  });
  const [target] = await installer.detect();
  assert.equal(target?.executablePath, exe);
  assert.equal(target?.source, "discovery");
});
test("does not report a ClassIsland package when its entrance assembly is missing", async () => {
  const exe = "C:\\Portable\\ClassIsland\\ClassIsland.exe";
  const manifestPath = "C:\\Portable\\ClassIsland\\data\\Plugins\\classisland.secagent\\manifest.yml";
  const found = await discoverClassIslandInstallations({
    platform: "win32",
    home: "C:\\Users\\teacher",
    env: { APPDATA: "C:\\Users\\teacher\\AppData\\Roaming" },
    executablePaths: [exe],
    runningProcesses: [],
    exists: (candidate) => candidate === exe || candidate === manifestPath,
    versionOf: () => "2.1.1.0",
    readFile: (filePath) => filePath.endsWith("\\PackageType") ? "folder" : "id: classisland.secagent\nentranceAssembly: ClassIsland.SecAgent.Plugin.dll\nversion: 0.1.0.1\n"
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].installedPluginVersion, void 0);
});
test("downloads through ghproxy first, verifies the asset, and installs to the selected portable instance", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    const packageType = path4.win32.join(root, "PackageType");
    fs3.mkdirSync(root, { recursive: true });
    fs3.writeFileSync(exe, "test executable");
    fs3.writeFileSync(packageType, "folder\n");
    const bytes = Buffer.from("valid cipx bytes");
    const digest = crypto3.createHash("sha256").update(bytes).digest("hex");
    const calls = [];
    const fetcher = async (input) => {
      const url = String(input);
      calls.push(url);
      const health = classIslandHealthResponse(input);
      if (health) return health;
      if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "0.1.0.1", draft: false, prerelease: false, assets: [{ name: CLASSISLAND_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ClassIsland-SecAgent-Plugin/releases/download/0.1.0.1/ClassIsland.SecAgent.Plugin.cipx", size: bytes.length, digest: `sha256:${digest}` }] }), { status: 200 });
      return new Response(bytes, { status: 200 });
    };
    const installer = new ClassIslandInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [],
      versionOf: () => "2.1.1.0",
      fetcher,
      exists: (candidate) => fs3.existsSync(candidate),
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async () => {
        writeClassIslandManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1,
      now: () => 123
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    const installedPath = path4.win32.join(root, "data", "Plugins", "classisland.secagent", "manifest.yml");
    assert.equal(result.ok, true);
    assert.equal(fs3.existsSync(installedPath), true);
    assert.equal(calls[0].startsWith(`${DEFAULT_MARKETPLACE_PROXY_URL}/https://api.github.com/`), true);
    assert.equal(calls[1].startsWith(`${DEFAULT_MARKETPLACE_PROXY_URL}/https://github.com/`), true);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
test("falls back from the proxy to direct GitHub for both release metadata and the asset", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-fallback-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    fs3.mkdirSync(root, { recursive: true });
    fs3.writeFileSync(exe, "test executable");
    fs3.writeFileSync(path4.win32.join(root, "PackageType"), "folder\n");
    const bytes = Buffer.from("fallback cipx bytes");
    const digest = crypto3.createHash("sha256").update(bytes).digest("hex");
    const calls = [];
    const fetcher = async (input) => {
      const url = String(input);
      calls.push(url);
      const health = classIslandHealthResponse(input);
      if (health) return health;
      if (url.startsWith(`${DEFAULT_MARKETPLACE_PROXY_URL}/`)) return new Response("proxy unavailable", { status: 503 });
      if (url.includes("api.github.com")) return new Response(JSON.stringify({ tag_name: "0.1.0.1", assets: [{ name: CLASSISLAND_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/SECTL/ClassIsland-SecAgent-Plugin/releases/download/0.1.0.1/ClassIsland.SecAgent.Plugin.cipx", digest: `sha256:${digest}`, size: bytes.length }] }), { status: 200 });
      return new Response(bytes, { status: 200 });
    };
    const installer = new ClassIslandInstaller({ platform: "win32", executablePaths: [exe], runningProcesses: [], versionOf: () => "2.1.1.0", fetcher, exists: (candidate) => fs3.existsSync(candidate), installPackage: async (destinationPath) => destinationPath, restartProcess: async () => {
      writeClassIslandManifest(root);
    }, listProcesses: async () => [], closeSettlePollMs: 1 });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 5);
    assert.equal(calls[0].startsWith(`${DEFAULT_MARKETPLACE_PROXY_URL}/https://api.github.com/`), true);
    assert.equal(calls[1].startsWith("https://api.github.com/"), true);
    assert.equal(calls[2].startsWith(`${DEFAULT_MARKETPLACE_PROXY_URL}/https://github.com/`), true);
    assert.equal(calls[3].startsWith("https://github.com/"), true);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
test("uses the GitHub release page digest when the REST API is rate limited", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-page-fallback-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    fs3.mkdirSync(root, { recursive: true });
    fs3.writeFileSync(exe, "test executable");
    fs3.writeFileSync(path4.win32.join(root, "PackageType"), "folder\n");
    const bytes = Buffer.from("release page cipx bytes");
    const digest = crypto3.createHash("sha256").update(bytes).digest("hex");
    const calls = [];
    const fetcher = async (input) => {
      const url = String(input);
      calls.push(url);
      const health = classIslandHealthResponse(input);
      if (health) return health;
      if (url.includes("api.github.com")) return new Response(JSON.stringify({ message: "rate limit exceeded" }), { status: 403 });
      if (url.includes("releases/latest")) return new Response('<a href="/SECTL/ClassIsland-SecAgent-Plugin/releases/tag/0.1.0.1">latest</a>', { status: 200 });
      if (url.includes("expanded_assets")) return new Response(`<li><a href="/SECTL/ClassIsland-SecAgent-Plugin/releases/download/0.1.0.1/${CLASSISLAND_PLUGIN_ASSET_NAME}"><span>${CLASSISLAND_PLUGIN_ASSET_NAME}</span></a><span>sha256:${digest}</span></li>`, { status: 200 });
      return new Response(bytes, { status: 200 });
    };
    const installer = new ClassIslandInstaller({ platform: "win32", executablePaths: [exe], runningProcesses: [], versionOf: () => "2.1.1.0", fetcher, exists: (candidate) => fs3.existsSync(candidate), installPackage: async (destinationPath) => destinationPath, restartProcess: async () => {
      writeClassIslandManifest(root);
    }, listProcesses: async () => [], closeSettlePollMs: 1 });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, true);
    assert.equal(calls.some((url) => url.includes("releases/expanded_assets/0.1.0.1")), true);
    assert.equal(fs3.existsSync(path4.win32.join(root, "data", "Plugins", "classisland.secagent", "manifest.yml")), true);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
test("does not write a package when ClassIsland is too old or the digest is invalid", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    fs3.writeFileSync(exe, "test executable");
    const oldInstaller = new ClassIslandInstaller({ platform: "win32", executablePaths: [exe], runningProcesses: [], versionOf: () => "1.9.0.0", exists: (candidate) => fs3.existsSync(candidate) });
    const [oldTarget] = await oldInstaller.detect();
    const [oldResult] = await oldInstaller.install([oldTarget.id]);
    assert.equal(oldResult.action, "skipped");
    assert.equal(fs3.existsSync(path4.win32.join(root, "data", "Cache", "PluginPackages", CLASSISLAND_PLUGIN_ASSET_NAME)), false);
    const bytes = Buffer.from("invalid digest");
    const invalidInstaller = new ClassIslandInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [],
      versionOf: () => "2.1.1.0",
      exists: (candidate) => fs3.existsSync(candidate),
      fetcher: async (input) => String(input).includes("api.github.com") ? new Response(JSON.stringify({ tag_name: "0.1.0.1", assets: [{ name: CLASSISLAND_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/example/plugin.cipx", digest: `sha256:${"0".repeat(64)}`, size: bytes.length }] }), { status: 200 }) : new Response(bytes, { status: 200 })
    });
    const [target] = await invalidInstaller.detect();
    await assert.rejects(() => invalidInstaller.install([target.id]), /SHA-256/);
    assert.equal(fs3.existsSync(path4.win32.join(root, "Cache", "PluginPackages", CLASSISLAND_PLUGIN_ASSET_NAME)), false);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
test("restarts a running ClassIsland and starts an idle instance after installing", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-start-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    fs3.mkdirSync(root, { recursive: true });
    fs3.writeFileSync(exe, "test executable");
    fs3.writeFileSync(path4.win32.join(root, "PackageType"), "folder\n");
    const bytes = Buffer.from("startable cipx bytes");
    const digest = crypto3.createHash("sha256").update(bytes).digest("hex");
    const launches = [];
    const fetcher = async (input) => {
      const health = classIslandHealthResponse(input);
      if (health) return health;
      return String(input).includes("api.github.com") ? new Response(JSON.stringify({ tag_name: "0.1.0.1", assets: [{ name: CLASSISLAND_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/example/plugin.cipx", digest: `sha256:${digest}`, size: bytes.length }] }), { status: 200 }) : new Response(bytes, { status: 200 });
    };
    const runningInstaller = new ClassIslandInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 321, commandLine: `"${exe}" --profile school`, version: "2.1.1.0" }],
      versionOf: () => "2.1.1.0",
      fetcher,
      exists: (candidate) => fs3.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        launches.push({ executablePath, args });
        writeClassIslandManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1
    });
    const [runningTarget] = await runningInstaller.detect();
    const [runningResult] = await runningInstaller.install([runningTarget.id]);
    assert.equal(runningResult.ok, true);
    assert.match(runningResult.message, /自动重启/);
    assert.deepEqual(launches, [{ executablePath: exe, args: ["--profile", "school"] }]);
    removeInstalledPlugin(root);
    launches.length = 0;
    const idleInstaller = new ClassIslandInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [],
      versionOf: () => "2.1.1.0",
      fetcher,
      exists: (candidate) => fs3.existsSync(candidate),
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        launches.push({ executablePath, args });
        writeClassIslandManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1
    });
    const [idleTarget] = await idleInstaller.detect();
    const [idleResult] = await idleInstaller.install([idleTarget.id]);
    assert.equal(idleResult.ok, true);
    assert.match(idleResult.message, /自动启动/);
    assert.deepEqual(launches, [{ executablePath: exe, args: [] }]);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
test("force-terminates ClassIsland when graceful close fails", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-force-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    fs3.writeFileSync(exe, "test executable");
    fs3.writeFileSync(path4.win32.join(root, "PackageType"), "folder\n");
    let running = true;
    let forceKilled = false;
    const bytes = Buffer.from("force kill cipx bytes");
    const digest = crypto3.createHash("sha256").update(bytes).digest("hex");
    const installer = new ClassIslandInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 123, version: "2.1.1.0" }],
      exists: (candidate) => fs3.existsSync(candidate),
      requestGracefulClose: async () => false,
      forceTerminateProcess: async () => {
        forceKilled = true;
        running = false;
      },
      isProcessRunning: async () => running,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async () => {
        writeClassIslandManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1,
      fetcher: async (input) => {
        const health = classIslandHealthResponse(input);
        if (health) return health;
        return String(input).includes("api.github.com") ? new Response(JSON.stringify({ tag_name: "0.1.0.1", assets: [{ name: CLASSISLAND_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/example/plugin.cipx", digest: `sha256:${digest}`, size: bytes.length }] }), { status: 200 }) : new Response(bytes, { status: 200 });
      }
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(forceKilled, true);
    assert.equal(result.ok, true);
    assert.equal(fs3.existsSync(path4.win32.join(root, "data", "Plugins", "classisland.secagent", "manifest.yml")), true);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
test("restarts ClassIsland without inheriting the --waitMutex argument", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-mutex-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    fs3.writeFileSync(exe, "test executable");
    fs3.writeFileSync(path4.win32.join(root, "PackageType"), "folder\n");
    const bytes = Buffer.from("mutex cipx bytes");
    const digest = crypto3.createHash("sha256").update(bytes).digest("hex");
    const launches = [];
    const installer = new ClassIslandInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 44, commandLine: `"${exe}" --waitMutex --profile demo`, version: "2.1.1.0" }],
      versionOf: () => "2.1.1.0",
      exists: (candidate) => fs3.existsSync(candidate),
      requestGracefulClose: async () => void 0,
      isProcessRunning: async () => false,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        launches.push({ executablePath, args });
        writeClassIslandManifest(root);
      },
      listProcesses: async () => [],
      closeSettlePollMs: 1,
      fetcher: async (input) => {
        const health = classIslandHealthResponse(input);
        if (health) return health;
        return String(input).includes("api.github.com") ? new Response(JSON.stringify({ tag_name: "0.1.0.1", assets: [{ name: CLASSISLAND_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/example/plugin.cipx", digest: `sha256:${digest}`, size: bytes.length }] }), { status: 200 }) : new Response(bytes, { status: 200 });
      }
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, true);
    assert.deepEqual(launches, [{ executablePath: exe, args: ["--profile", "demo"] }]);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
test("closes a ClassIsland.Desktop.exe instance that detection could not see", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-orphan-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    fs3.writeFileSync(exe, "test executable");
    fs3.writeFileSync(path4.win32.join(root, "PackageType"), "folder\n");
    const bytes = Buffer.from("orphan cipx bytes");
    const digest = crypto3.createHash("sha256").update(bytes).digest("hex");
    const launches = [];
    const closedPids = [];
    let enumerateCalls = 0;
    const listProcesses = async () => {
      enumerateCalls += 1;
      return enumerateCalls === 1 ? [{ pid: 555, name: "ClassIsland.Desktop.exe", commandLine: `"${root}\\app-2.1.1.1-0\\ClassIsland.Desktop.exe"` }] : [];
    };
    const installer = new ClassIslandInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 321, commandLine: `"${exe}"`, version: "2.1.1.0" }],
      versionOf: () => "2.1.1.0",
      exists: (candidate) => fs3.existsSync(candidate),
      requestGracefulClose: async (pid) => {
        closedPids.push(pid);
      },
      isProcessRunning: async (pid) => pid === 321 && closedPids.length === 0,
      installPackage: async (destinationPath) => destinationPath,
      restartProcess: async (executablePath, args) => {
        launches.push({ executablePath, args });
        writeClassIslandManifest(root);
      },
      listProcesses,
      closeSettlePollMs: 1,
      fetcher: async (input) => {
        const health = classIslandHealthResponse(input);
        if (health) return health;
        return String(input).includes("api.github.com") ? new Response(JSON.stringify({ tag_name: "0.1.0.1", assets: [{ name: CLASSISLAND_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/example/plugin.cipx", digest: `sha256:${digest}`, size: bytes.length }] }), { status: 200 }) : new Response(bytes, { status: 200 });
      }
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, true);
    assert.deepEqual([...closedPids].sort(), [321, 555]);
    assert.deepEqual(launches, [{ executablePath: exe, args: [] }]);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
test("does not write when a running ClassIsland cannot be force-terminated", async () => {
  const root = fs3.mkdtempSync(path4.join(os3.tmpdir(), "secagent-classisland-"));
  try {
    const exe = path4.win32.join(root, "ClassIsland.exe");
    fs3.writeFileSync(exe, "test executable");
    const installer = new ClassIslandInstaller({
      platform: "win32",
      executablePaths: [exe],
      runningProcesses: [{ executablePath: exe, pid: 123, version: "2.1.1.0" }],
      exists: (candidate) => fs3.existsSync(candidate),
      requestGracefulClose: async () => {
        throw new Error("still running");
      },
      forceTerminateProcess: async () => {
        throw new Error("access denied");
      },
      isProcessRunning: async () => true,
      listProcesses: async () => [],
      closeSettlePollMs: 1,
      fetcher: async (input) => String(input).includes("api.github.com") ? new Response(JSON.stringify({ tag_name: "0.1.0.1", assets: [{ name: CLASSISLAND_PLUGIN_ASSET_NAME, browser_download_url: "https://github.com/example/plugin.cipx", digest: `sha256:${crypto3.createHash("sha256").update("x").digest("hex")}`, size: 1 }] }), { status: 200 }) : new Response("x", { status: 200 })
    });
    const [target] = await installer.detect();
    const [result] = await installer.install([target.id]);
    assert.equal(result.ok, false);
    assert.match(result.message, /强制结束也失败/);
    assert.equal(fs3.existsSync(path4.win32.join(root, "data", "Cache", "PluginPackages", CLASSISLAND_PLUGIN_ASSET_NAME)), false);
  } finally {
    fs3.rmSync(root, { recursive: true, force: true });
  }
});
