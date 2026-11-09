/**
 * Mermaid 主题选择：图表画在应用消息面板上，深色面板必须用 dark 主题，
 * 否则 mermaid `default` 的 #333 文字落到 #111720 上只有 1.6:1。
 *
 * 单独成模块（不 import mermaid）便于纯逻辑回归测试。
 */
type MermaidThemeName = "default" | "dark";

/** mermaid dark 主题正文/标签文字色（themeVariables.mainContrastColor 派生）。 */
export const MERMAID_DARK_TEXT = "#cccccc";

/** mermaid dark 主题把边标签底算成 lighten(#404040, 25%) = #585858，与 #ccc 仅 4.43:1；
 *  这里压深到 #2f3336（同一文字色下约 7.5:1），其余变量沿用主题默认。 */
export const MERMAID_DARK_EDGE_LABEL_BACKGROUND = "#2f3336";

export function mermaidThemeFor(dark: boolean): MermaidThemeName {
  return dark ? "dark" : "default";
}

export function mermaidThemeVariables(theme: MermaidThemeName): Record<string, string> {
  return theme === "dark" ? { edgeLabelBackground: MERMAID_DARK_EDGE_LABEL_BACKGROUND } : {};
}