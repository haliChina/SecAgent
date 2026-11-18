/**
 * 虚拟显示器管理的纯解析逻辑（R100）——与 electron 依赖分离，
 * node --test 可直接测试；virtual-display.ts 组合执行层引用。
 */

/** 已知虚拟屏的设备描述特征（小写包含匹配）。模块内私有。 */
const VIRTUAL_DISPLAY_PATTERNS = [
  "virtual display driver", // VirtualDrivers/Virtual-Display-Driver（推荐）
  "virtual display",
  "gameviewer", // 网易 UU 远程
  "parsec",
  "duetdisplay",
  "spacedesk",
  "idd sample driver", // 微软 IddCx 样例
];

export function isVirtualDisplayDescription(description: string): boolean {
  const lower = description.toLowerCase();
  return VIRTUAL_DISPLAY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** pnputil /enum-devices /class Display 输出 → 设备三元组（含状态）。
 * 状态取值：Started（工作）/ Disabled（被禁用——虚拟屏「消失」主因之一）/
 * Disconnected（驱动在、设备断开——重启或重装驱动可恢复）/ 其他。 */
export interface EnumeratedDisplayDevice { instanceId: string; description: string; status: string; }

export function parseEnumDevicesOutput(stdout: string): EnumeratedDisplayDevice[] {
  const devices: EnumeratedDisplayDevice[] = [];
  let instanceId = "";
  let description = "";
  let status = "";
  const flush = () => {
    if (instanceId && description) devices.push({ instanceId, description, status: status || "Unknown" });
    instanceId = "";
    description = "";
    status = "";
  };
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    const idMatch = /^Instance ID:\s+(.+)$/.exec(trimmed);
    if (idMatch) { flush(); instanceId = idMatch[1]; continue; }
    const descMatch = /^Device Description:\s+(.+)$/.exec(trimmed);
    if (descMatch) { description = descMatch[1]; continue; }
    const statusMatch = /^Status:\s+(.+)$/.exec(trimmed);
    if (statusMatch) { status = statusMatch[1]; continue; }
  }
  flush();
  return devices;
}

/** pnputil /enum-drivers 输出 → 第三方驱动清单（卸载按 oem inf 反查）。 */
export function parseEnumDriversOutput(stdout: string): Array<{ publishedName: string; originalName: string }> {
  const drivers: Array<{ publishedName: string; originalName: string }> = [];
  let current: { publishedName?: string; originalName?: string } = {};
  const flush = () => {
    if (current.publishedName) drivers.push({ publishedName: current.publishedName, originalName: current.originalName || "" });
    current = {};
  };
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    const published = /^Published Name:\s+(.+)$/.exec(trimmed);
    const original = /^Original Name:\s+(.+)$/.exec(trimmed);
    if (published) {
      flush();
      current.publishedName = published[1];
    }
    if (original) current.originalName = original[1];
  }
  flush();
  return drivers;
}
