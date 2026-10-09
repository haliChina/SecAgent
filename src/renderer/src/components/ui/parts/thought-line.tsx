/**
 * ThoughtLine (reactbits.dev thought-line) — 思考中 → 已思考 X 秒。
 *
 * P3 重写：样式随组件走（同目录 thought-line.css），不再依赖全局
 * styles.css；文件瘦身只保留实际依赖（零 import）。
 * 交互状态同时用文字/形状表达（done 方块 vs spinner）；动画尊重
 * prefers-reduced-motion。
 */
import "./thought-line.css";

export function ThoughtLine({ label, elapsedSeconds, done }: { label: string; elapsedSeconds?: number; done?: boolean }) {
  return (
    <div className={`thought-line ${done ? "done" : ""}`} role="status">
      <span className="thought-line-spinner" aria-hidden="true" />
      <span className="thought-line-label">
        {done ? `已思考${elapsedSeconds !== undefined ? ` ${Math.max(1, Math.round(elapsedSeconds))} 秒` : ""}` : label}
      </span>
    </div>
  );
}
