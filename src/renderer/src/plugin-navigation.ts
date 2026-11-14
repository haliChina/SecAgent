/** 插件页复合控件共用索引导航；方向不匹配时保留浏览器原生行为。 */
export function pluginNavigationIndex(key: string, current: number, count: number, orientation: "horizontal" | "vertical"): number | null {
  if (count <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const previous = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  if (key !== next && key !== previous) return null;
  return (Math.max(0, current) + (key === next ? 1 : count - 1)) % count;
}
