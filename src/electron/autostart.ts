/**
 * 开机自启动（B2 自 main.ts 拆出，纯搬家）。
 *
 * 三平台策略：Linux 写 XDG autostart（AppImage 的 execPath 是临时
 * 挂载点，须用 APPIMAGE 环境变量指向持久文件）；Windows 提权走
 * 计划任务（/RL HIGHEST，避免应用内更新再触发 UAC），非提权创建
 * 失败时经 UAC PowerShell 重试一次，用户拒绝则回退 HKCU Run 键；
 * macOS 走 app.setLoginItemSettings。
 */
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { logMain } from "./main-log.js";

const execFileAsync = promisify(execFile);

export const AUTO_START_ARG = "--autostart";
export const AUTO_START_ARGS = [AUTO_START_ARG];

export function isAutostartLaunch(): boolean {
  return process.argv.includes(AUTO_START_ARG);
}

const LINUX_AUTOSTART_DESKTOP_FILE = "secagent-autostart.desktop";

function autostartExecutablePath(): string {
  // Inside an AppImage, process.execPath is the transient /tmp/.mount_* mount;
  // APPIMAGE points at the durable file the user actually launched.
  if (process.platform === "linux" && process.env.APPIMAGE) return process.env.APPIMAGE;
  return process.execPath;
}

function linuxAutostartFilePath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "autostart", LINUX_AUTOSTART_DESKTOP_FILE);
}

export function readAutostart(): boolean {
  try {
    if (process.platform === "linux") return fs.existsSync(linuxAutostartFilePath());
    // Elevated autostart is a scheduled task; the plain fallback is the
    // HKCU Run key (also what the installer writes on first install).
    if (windowsAutostartTaskExists()) return true;
    const loginItem = app.getLoginItemSettings({ path: autostartExecutablePath(), args: AUTO_START_ARGS });
    // executableWillLaunchAtLogin also recognizes entries created by older
    // installers that did not include the current argument list.
    return loginItem.openAtLogin || loginItem.executableWillLaunchAtLogin;
  } catch (error) {
    logMain("autostart.read.failed", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

const WINDOWS_AUTOSTART_TASK_NAME = "SecAgent Autostart";

function runSchtasks(args: string[]): { status: number; stdout: string } {
  const result = spawnSync("schtasks.exe", args, { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  return { status: result.status ?? -1, stdout: `${result.stdout || ""}` };
}

function windowsAutostartTaskExists(): boolean {
  // status 1 = task does not exist; anything else (or a throw) is treated as
  // "unknown" and reported as absent so settings show the fallback state.
  return runSchtasks(["/Query", "/TN", WINDOWS_AUTOSTART_TASK_NAME]).status === 0;
}

/** Sync elevation probe (registry read, no spawn). reg.exe exits 0 for
 *  admins (HKU\S-1-5-20 is admin-readable) and 1 for standard users. */
function getWindowsProcessElevationSync(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const probe = spawnSync("reg.exe", ["Query", "HKU\\S-1-5-20"], { windowsHide: true, timeout: 5_000 });
    return (probe.status ?? 1) === 0;
  } catch {
    return false;
  }
}

function removeAutostartTask(): void {
  runSchtasks(["/Delete", "/TN", WINDOWS_AUTOSTART_TASK_NAME, "/F"]);
}

/** Runs one schtasks command inside an elevated PowerShell (one UAC prompt).
 *  Returns false when the user declines the prompt or the command fails. */
async function runSchtasksElevated(args: string[]): Promise<boolean> {
  const quoted = args.map((a) => (a.includes(" ") || a.includes('"') ? `'${a.replaceAll("'", "''").replaceAll('"', '`"')}'` : a)).join(" ");
  const script = `Start-Process -FilePath schtasks.exe -ArgumentList '${quoted.replaceAll("'", "''")}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru | ForEach-Object { exit $_.ExitCode }`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
    return true;
  } catch (error) {
    logMain("autostart.elevated.failed", { error: error instanceof Error ? error.message : String(error), args: args[0] });
    return false;
  }
}

export function writeAutostart(enabled: boolean): void {
  if (process.platform === "linux") {
    // Write the XDG autostart entry directly: Electron's Linux login-item
    // helper records process.execPath, which is a transient path for AppImages.
    const entry = linuxAutostartFilePath();
    if (!enabled) { fs.rmSync(entry, { force: true }); return; }
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, `[Desktop Entry]\nType=Application\nName=SecAgent\nExec=${JSON.stringify(autostartExecutablePath())} ${AUTO_START_ARG}\nTerminal=false\n`, "utf8");
    return;
  }
  if (!enabled) {
    logMain("autostart.disable.begin", { taskExists: windowsAutostartTaskExists() });
    removeAutostartTask();
    // also clear the plain fallback / installer-written Run key
    app.setLoginItemSettings({ openAtLogin: false, path: autostartExecutablePath(), args: AUTO_START_ARGS });
    logMain("autostart.disable.done", { taskExists: windowsAutostartTaskExists() });
    return;
  }
  const autostartTaskArgs = ["/Create", "/TN", WINDOWS_AUTOSTART_TASK_NAME, "/TR", `"${autostartExecutablePath()} ${AUTO_START_ARG}"`, "/SC", "ONLOGON", "/RL", "HIGHEST", "/F"];
  logMain("autostart.enable.begin", { elevated: getWindowsProcessElevationSync(), exe: autostartExecutablePath() });
  const create = runSchtasks(autostartTaskArgs);
  if (create.status === 0 && windowsAutostartTaskExists()) {
    logMain("autostart.task.created.direct");
    // task in place; make sure no stale Run-key entry also starts the app
    app.setLoginItemSettings({ openAtLogin: false, path: autostartExecutablePath(), args: AUTO_START_ARGS });
    return;
  }
  logMain("autostart.task.create.failed", { status: create.status, stdout: create.stdout.slice(0, 300) });
  // Could not create the task directly (non-elevated): try once via UAC, and
  // fall back to a plain Run-key autostart when the user declines.
  void (async () => {
    const elevated = await runSchtasksElevated(autostartTaskArgs);
    if (elevated && windowsAutostartTaskExists()) {
      logMain("autostart.task.created.elevated");
      app.setLoginItemSettings({ openAtLogin: false, path: autostartExecutablePath(), args: AUTO_START_ARGS });
      return;
    }
    logMain("autostart.elevated.declined", { elevatedRan: elevated });
    app.setLoginItemSettings({ openAtLogin: true, path: autostartExecutablePath(), args: AUTO_START_ARGS });
    logMain("autostart.fallback.runkey");
  })();
}
