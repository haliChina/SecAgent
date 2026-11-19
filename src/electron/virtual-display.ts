/**
 * 虚拟显示器管理（R100，Agent 虚拟屏方案地基）。
 *
 * 检测层（无需权限）：pnputil 枚举显示类设备按描述识别已知虚拟屏。
 * 安装/卸载（需管理员）：pnputil 经 PowerShell -Verb RunAs 弹 UAC。
 * 卸载按 oem*.inf 反查清理（幂等容错——UU 自己都有幽灵设备问题）。
 * 驱动包：resources/vdd/（缺 inf 时提示下载，绝不静默下载可执行内容）。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { isVirtualDisplayDescription, parseEnumDevicesOutput, parseEnumDriversOutput, type EnumeratedDisplayDevice } from "./virtual-display-pure.js";

const run = promisify(execFile);

interface VirtualDisplayDeviceReport { /* 模块内结构：inactive 字段与实现共用，无外部导出需求 */
  instanceId: string;
  description: string;
  /** Started 正常 / Disabled 被禁用（可一键恢复） / Disconnected 断开（重启驱动）/ 其他。 */
  status: string;
}

export interface VirtualDisplayStatus {
  /** 存在已启动（Started）的虚拟屏。 */
  installed: boolean;
  /** 检测到但未启动的虚拟屏（被禁用/断开——设置页给恢复入口）。 */
  inactive: VirtualDisplayDeviceReport[];
  devices: string[];
  driverPackaged: boolean;
}

async function enumDisplayDevices(): Promise<EnumeratedDisplayDevice[]> {
  try {
    const { stdout } = await run("pnputil", ["/enum-devices", "/class", "Display"], { windowsHide: true, timeout: 15000 });
    return parseEnumDevicesOutput(stdout);
  } catch {
    return []; /* pnputil 不可用（旧 Windows）或超时——检测降级 */
  }
}

async function enumDrivers(): Promise<Array<{ publishedName: string; originalName: string }>> {
  try {
    const { stdout } = await run("pnputil", ["/enum-drivers"], { windowsHide: true, timeout: 15000 });
    return parseEnumDriversOutput(stdout);
  } catch {
    return [];
  }
}

/** 提权执行 pnputil（UAC 弹窗由用户确认）。 */
function elevatedPnputil(args: string[]): Promise<void> {
  const command = `Start-Process -Verb RunAs -Wait -FilePath pnputil -ArgumentList ${JSON.stringify(args.map((a) => `"${a}"`).join(","))}`;
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 120000 }, (error) => {
      if (error) reject(new Error(`提权执行失败（用户取消 UAC 或超时）：${error.message}`));
      else resolve();
    });
  });
}

function driverPackPath(): string {
  return path.join(process.resourcesPath || app.getAppPath(), "vdd");
}

/** 当前虚拟屏状态（设置页/doctor 用）。 */
export async function getVirtualDisplayStatus(): Promise<VirtualDisplayStatus> {
  const devices = await enumDisplayDevices();
  /* 先筛后射：筛的是整个设备对象（map 成字符串再取字段=TS2339 教训）。 */
  const virtual = devices.filter((device) => isVirtualDisplayDescription(device.description));
  const reports: VirtualDisplayDeviceReport[] = virtual.map((device) => ({ instanceId: device.instanceId, description: device.description, status: device.status }));
  const active = reports.filter((report) => report.status === "Started");
  const inactive = reports.filter((report) => report.status !== "Started");
  return {
    installed: active.length > 0,
    inactive,
    devices: active.map((report) => report.description),
    driverPackaged: fs.existsSync(path.join(driverPackPath(), "vdd.inf")),
  };
}

/** 安装虚拟屏驱动（UAC 提权 + pnputil /add-driver /install）。 */
export async function installVirtualDisplayDriver(): Promise<void> {
  const infPath = path.join(driverPackPath(), "vdd.inf");
  if (!fs.existsSync(infPath)) throw new Error(`驱动包缺失：${infPath}。请重新安装 SecAgent 或到设置页下载虚拟屏组件。`);
  await elevatedPnputil(["/add-driver", infPath, "/install"]);
}

/** 恢复未启动的虚拟屏设备：Disabled→/enable；Disconnected→/restart。
 * 两者都试（先 enable 后 restart），成功与否由下一次 status 判定。 */
export async function reviveVirtualDisplayDevices(): Promise<number> {
  const devices = (await enumDisplayDevices()).filter((device) => isVirtualDisplayDescription(device.description) && device.status !== "Started");
  let revived = 0;
  for (const device of devices) {
    if (device.status === "Disabled") {
      try { await elevatedPnputil(["/enable-device", `@${device.instanceId}`]); revived += 1; continue; } catch { /* 继续尝试 restart */ }
    }
    try { await elevatedPnputil(["/restart-device", `@${device.instanceId}`]); revived += 1; } catch { /* 尽力而为 */ }
  }
  return revived;
}

/** 卸载虚拟屏驱动：按 Original Name=vdd.inf 反查 oem inf 逐个删（尽力而为）。 */
export async function uninstallVirtualDisplayDriver(): Promise<number> {
  const drivers = await enumDrivers();
  const targets = drivers.filter((driver) => /vdd\.inf$/i.test(driver.originalName));
  let removed = 0;
  for (const target of targets) {
    try {
      await elevatedPnputil(["/delete-driver", target.publishedName, "/uninstall", "/force"]);
      removed += 1;
    } catch { /* 幽灵设备/已被清理——继续下一个 */ }
  }
  return removed;
}
