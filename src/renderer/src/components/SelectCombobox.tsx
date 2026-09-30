import { useId } from "react";

export interface SelectOption { value: string; label: string; group?: string }

/**
 * Dropdown v2 — a real <select> element.
 *
 * v1 rendered the popup manually (fixed panel + flip math + scroll-close
 * listeners). On the classroom touch panels (希沃一体机) that popup showed the
 * classic failures reported in the wild: taps opened the list but option taps
 * never landed, wheel/scroll events closed it instantly, and the panel
 * drifted from its anchor. The native <select> handles touch, keyboard, IME
 * and positioning on every platform with zero JavaScript; grouped entries map
 * to <optgroup> so models from different providers stay visually separated.
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
      <span className="select-combobox-chevron" aria-hidden="true">⌄</span>
    </span>
  );
}
