/** R86 性能模式：auto / smooth / quality。
 *
 * auto 只跟随“大屏触控模式”：大屏 OPS 默认流畅，桌面默认画质。
 * 现场可在 设置 → 账户与通用 → 性能模式 强制切档。
 */
export type PerformanceMode = "auto" | "smooth" | "quality";
type ResolvedPerformance = "smooth" | "quality";

export function normalizePerformanceMode(value: unknown): PerformanceMode {
  return value === "smooth" || value === "quality" ? value : "auto";
}

export function resolvePerformanceMode(mode: unknown, bigTouch: boolean): ResolvedPerformance {
  const normalized = normalizePerformanceMode(mode);
  if (normalized === "smooth") return "smooth";
  if (normalized === "quality") return "quality";
  return bigTouch ? "smooth" : "quality";
}

/** 写 <html data-performance>，CSS 与 R3F 都以此为准。 */
export function applyPerformanceMode(mode: unknown, bigTouch: boolean): ResolvedPerformance {
  const resolved = resolvePerformanceMode(mode, bigTouch);
  document.documentElement.dataset.performance = resolved;
  return resolved;
}