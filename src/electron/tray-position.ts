/**
 * 托盘气泡定位（纯函数，测试覆盖）。
 *
 * 托盘图标通常贴在任务栏/菜单栏边缘：下方有空间就放在图标上方，
 * 否则（macOS 顶部菜单栏）落到下方。最后把坐标夹在工作区内，
 * 避免贴边时气泡跑出屏幕。
 */

interface TrayRect { x: number; y: number; width: number; height: number }
interface TrayPanelSize { width: number; height: number }

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function computeTrayPanelPosition(trayBounds: TrayRect, panel: TrayPanelSize, workArea: TrayRect, gap = 8): { x: number; y: number } {
  const centeredX = Math.round(trayBounds.x + trayBounds.width / 2 - panel.width / 2);
  const above = Math.round(trayBounds.y - panel.height - gap);
  const below = Math.round(trayBounds.y + trayBounds.height + gap);
  const x = clamp(centeredX, workArea.x + gap, workArea.x + workArea.width - panel.width - gap);
  const y = clamp(above >= workArea.y + gap ? above : below, workArea.y + gap, workArea.y + workArea.height - panel.height - gap);
  return { x, y };
}
