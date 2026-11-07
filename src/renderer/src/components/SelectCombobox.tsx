import { useId } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectOption { value: string; label: string; group?: string }

/**
 * Dropdown v3 — native <select> + shadcn 观感触发器。
 *
 * v2（真 <select>）保留：课堂触控面板（希沃一体机）上手工弹层的经典
 * 失败（点击不落点/滚轮即关/漂移）由原生控件根治，不动。
 * R59 只换"丑 ⌄ 字形"：右侧指示改为 lucide ChevronDown 图标（shadcn
 * Select 同款），并补触发器 hover/focus/选中态样式。
 */
export function SelectCombobox({ value, options, onChange, disabled, ariaLabel }: { value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean; ariaLabel?: string }) {
  const id = useId();
  const known = options.some((option) => option.value === value);

  // Collapse options into consecutive groups for <optgroup>.
  const groups: Array<{ label: string; items: SelectOption[] }> = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.label === (option.group || "")) last.items.push(option);
    else groups.push({ label: option.group || "", items: [option] });
  }
  const flat = groups.length === 1 && !groups[0].label;

  return (
    <span className="select-combobox select-combobox-native">
      <select
        id={id}
        className="select-combobox-select"
        value={known ? value : ""}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => {
          const next = event.target.value;
          if (next || next === "") onChange(next);
        }}
      >
        {!known && <option value="" disabled>{value || "—"}</option>}
        {flat
          ? groups[0].items.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)
          : groups.map((group) => (
            <optgroup key={group.label || "\u200b"} label={group.label || "其他"}>
              {group.items.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
          ))}
        {options.length === 0 && <option value="" disabled>暂无选项</option>}
      </select>
      <span className="select-combobox-chevron" aria-hidden="true"><ChevronDown size={15} strokeWidth={2} /></span>
    </span>
  );
}
