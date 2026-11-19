/**
 * Mermaid 主题选择：图表画在应用消息面板上，深色面板使用 dark 主题，
 * 避免沿用 default 的浅色节点。裸 #333 文字对 #111720 的对比度很低，
 * 但节点/边标签可能自带底色，运行时对比度必须按实际合成背景测量。
 *
 * 单独成模块（不 import mermaid）便于纯逻辑回归测试。
 */
type MermaidThemeName = "default" | "dark";

/** mermaid dark 主题正文/标签文字色（themeVariables.mainContrastColor 派生）。 */
export const MERMAID_DARK_TEXT = "#cccccc";

/** mermaid dark 的边标签底为 #585858，与 #ccc 按不透明色对计算约 4.43:1；
 *  压深到 #2f3336（约 7.9:1）留出余量；foreignObject 的透明背景另做浏览器验证。 */
export const MERMAID_DARK_EDGE_LABEL_BACKGROUND = "#2f3336";

export function mermaidThemeFor(dark: boolean): MermaidThemeName {
  return dark ? "dark" : "default";
}

export function mermaidThemeVariables(theme: MermaidThemeName): Record<string, string> {
  return theme === "dark" ? { edgeLabelBackground: MERMAID_DARK_EDGE_LABEL_BACKGROUND } : {};
}