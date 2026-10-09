/**
 * DaySeparator (assistant-ui.com day-separator) — 消息流日期分隔。
 *
 * P3 重写：样式随组件走（同目录 day-separator.css），不再依赖全局
 * styles.css；文件瘦身只保留实际依赖（零 import）。
 * role="separator" + aria-label：日期是消息流的时间地标，读屏用户切换
 * 消息时需要这层上下文，不能从无障碍树里拿掉（R8 a11y）。
 * id 供 ScrollProgress 的节锚点定位（rareui 节列表按 document.getElementById 找）。
 */
import "./day-separator.css";

// 日期文案：本地化长月 + 日（如 "10月9日"）。
export function daySeparatorLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

// 本地日历日的稳定 id（ScrollProgress 节锚点 + DaySeparator 挂载用）。
// 不用 ISO 前缀：UTC 截断在 UTC+8 的 0-8 点会把相邻本地日折叠成同一天。
export function daySeparatorId(iso: string): string {
  const date = new Date(iso);
  return `day-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function DaySeparator({ label, id }: { label: string; id?: string }) {
  return (
    <div id={id} className="day-separator" role="separator" aria-label={label}>
      <span className="day-separator-line" aria-hidden="true" />
      <span className="day-separator-label">{label}</span>
      <span className="day-separator-line" aria-hidden="true" />
    </div>
  );
}
