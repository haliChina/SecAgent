/** R83 显示模式：桌面 / 班级大屏触控。
 *
 * 大屏不是“桌面版放大”：需要更大字号、更大触控目标、常显操作入口、
 * 禁用长按说话、避开软键盘。这里只做模式解析与 DOM 标记，
 * 具体尺寸在 styles.css 的 [data-display="big-touch"] 段。
 *
 * 注意：不能只靠 @media (hover:none) 判断触屏——Windows 交互平板
 * 常同时暴露鼠标，媒体查询仍可能是 hover:hover。首次收到 touch
 * pointerdown 时补 data-touch，作为更可靠的信号。
 */
export type DisplayMode = "desktop" | "big-touch";

const DISPLAY_MODE_KEY = "secagent.display.mode";

/** 纯函数：显式偏好优先；否则按屏幕宽度 + 触点能力给建议。 */
export function resolveDisplayMode(stored: string | null, screenWidth: number, maxTouchPoints: number): DisplayMode {
  if (stored === "big-touch" || stored === "desktop") return stored;
  return screenWidth >= 1600 && maxTouchPoints > 0 ? "big-touch" : "desktop";
}

export function readStoredDisplayMode(): string | null {
  try {
    return window.localStorage.getItem(DISPLAY_MODE_KEY);
  } catch {
    return null;
  }
}

export function cacheDisplayMode(mode: DisplayMode): void {
  try {
    window.localStorage.setItem(DISPLAY_MODE_KEY, mode);
  } catch { /* 隐私模式等场景忽略 */ }
}

export function applyDisplayMode(mode: DisplayMode): void {
  if (mode === "big-touch") document.documentElement.dataset.display = "big-touch";
  else delete document.documentElement.dataset.display;
}

/** 首次触摸后打标，供 CSS 显示触屏才需要的常显操作。 */
export function watchTouchInput(): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      document.documentElement.dataset.touch = "true";
      window.removeEventListener("pointerdown", onPointerDown, true);
    }
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  return () => window.removeEventListener("pointerdown", onPointerDown, true);
}