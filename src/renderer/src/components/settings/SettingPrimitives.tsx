/**
 * R78 设置页行式组件（新建，限设置窗使用）。
 *
 * 视觉真源在 styles.css 的「R78 设置页右侧重做」块（.set-* 前缀）；本文件只负责
 * 结构与语义，不写任何行内样式。旧分区的 .toggle-row 由同一套 CSS 归一，
 * 因此新页与既有分区观感一致。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** 一组设置项：可选的小标题 + 圆角分组卡片。 */
export function SettingsGroup({ label, children }: { label?: string; children: ReactNode }) {
  return <div className="set-group-wrap">
    {label ? <h3 className="set-group-label">{label}</h3> : null}
    <div className="set-group">{children}</div>
  </div>;
}

/** 可点击的跳转行：标题 + 说明 + 右侧当前值/箭头。 */
export function SettingsLinkRow({ title, desc, value, onSelect, disabled }: {
  title: string;
  desc?: string;
  value?: string;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return <button type="button" className="set-row" onClick={onSelect} disabled={disabled}>
    <span className="set-row-main">
      <span className="set-row-title">{title}</span>
      {desc ? <span className="set-row-desc">{desc}</span> : null}
    </span>
    <span className="set-row-right">
      {value ? <span className="set-row-value">{value}</span> : null}
      <ChevronRight className="set-row-chevron" size={16} aria-hidden />
    </span>
  </button>;
}

/** 开关行：整行即点击热区（≥52px），右侧 iOS 风格开关。 */
export function SettingsSwitchRow({ title, desc, checked, onChange, disabled }: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return <label className="set-row">
    <span className="set-row-main">
      <span className="set-row-title">{title}</span>
      {desc ? <span className="set-row-desc">{desc}</span> : null}
    </span>
    <input
      type="checkbox"
      className="set-switch"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  </label>;
}

/** 纯展示行（无跳转、无控件；不响应 hover，避免看起来可点击）。 */
export function SettingsInfoRow({ title, desc, value }: { title: string; desc?: string; value?: string }) {
  return <div className="set-row set-row-static">
    <span className="set-row-main">
      <span className="set-row-title">{title}</span>
      {desc ? <span className="set-row-desc">{desc}</span> : null}
    </span>
    {value ? <span className="set-row-right"><span className="set-row-value">{value}</span></span> : null}
  </div>;
}

/** 用户信息卡片：圆形首字母头像 + 身份 + 右侧纵向数据。 */
export function SettingsUserCard({ name, role, stats }: {
  name: string;
  role: string;
  stats: Array<{ value: string; label: string }>;
}) {
  return <div className="set-user">
    <span className="set-user-avatar" aria-hidden>{name.trim().slice(0, 1) || "S"}</span>
    <div className="set-user-main">
      <strong className="set-user-name">{name}</strong>
      <span className="set-user-role">{role}</span>
    </div>
    <div className="set-user-stats">
      {stats.map((stat) => <div className="set-user-stat" key={stat.label}>
        <strong>{stat.value}</strong>
        <span>{stat.label}</span>
      </div>)}
    </div>
  </div>;
}

/** 二次确认弹窗：复用 settings-modal 外壳（项目无独立 Dialog 组件，此为既有弹层范式）。 */
export function SettingsConfirmDialog({ open, title, message, confirmLabel = "确认", danger, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    };
    document.addEventListener("keydown", onKeydown, true);
    return () => document.removeEventListener("keydown", onKeydown, true);
  }, [open, onCancel]);
  if (!open) return null;
  return <div
    className="settings-modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
  >
    <div className="settings-modal set-confirm">
      <div className="card-heading"><strong>{title}</strong></div>
      <p className="set-confirm-text">{message}</p>
      <div className="modal-actions">
        <button type="button" className="secondary-button" ref={cancelRef} onClick={onCancel}>取消</button>
        <button type="button" className={danger ? "primary-button set-danger-button" : "primary-button"} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}
