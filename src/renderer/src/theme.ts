/**
 * 主题三态（UI P3-5）：light / dark / system（跟随系统）。
 *
 * 职责拆分：
 * - resolveTheme：纯函数（测试覆盖）——system 时按 prefersDark 折算
 * - applyTheme / readCachedTheme / cacheTheme：DOM 副作用 + localStorage 缓存
 *   （缓存的唯一目的：index.html 内联防闪烁脚本在首帧前同步应用，
 *   之后 main.tsx 会用 settings 真值校正——缓存错也只是闪一下，不持久）
 * - watchSystemTheme：system 模式下跟随 OS 切换实时换肤
 *
 * 双窗共用：主窗/设置窗加载同一 index.html（windows.ts ?settings=1），
 * 同源 localStorage 一份缓存两窗共享；设置保存后主窗靠
 * onSettingsChanged 重读 settings 即时换肤。
 */

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "secagent-theme";

/** 三态折算成生效主题（纯函数）。 */
export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === "dark") return "dark";
  if (theme === "system") return prefersDark ? "dark" : "light";
  return "light";
}

/** 白名单读取：非法值（含旧版/损坏数据）一律回落 light。 */
export function readCachedTheme(value: string | null): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "light";
}

export function cacheTheme(theme: Theme): void {
  try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* 隐私模式等场景忽略 */ }
}

export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme, window.matchMedia("(prefers-color-scheme: dark)").matches);
  // light 是默认态：删除属性即回 :root 基线，避免属性残留
  if (resolved === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

/** system 模式下监听 OS 切换；返回清理函数。 */
export function watchSystemTheme(theme: Theme, onChange: () => void): () => void {
  if (theme !== "system") return () => undefined;
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
