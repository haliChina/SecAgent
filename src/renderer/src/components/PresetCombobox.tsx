import { useId } from "react";

/**
 * Provider-preset picker v2 — native <input list> + <datalist>.
 *
 * v1's manually positioned popup missed option taps on classroom touch
 * panels (希沃) and closed on scroll. The native datalist keeps the search
 * behaviour (type to filter) while the OS renders the list: touch, pen and
 * keyboard all work with zero JavaScript. Choosing an entry fires onSelect
 * with the preset id; anything typed by hand stays free-form, and the field
 * falls back to "custom" via the trailing 自定义 entry.
 */
export function PresetCombobox({ value, presets, onSelect }: { value: string; presets: ProviderPreset[]; onSelect: (id: string) => void }) {
  const listId = useId();
  const selected = presets.find((preset) => preset.id === value);
  const display = selected?.name || (value === "custom" ? "自定义" : value || "");
  return (
    <span className="preset-combobox preset-combobox-native">
      <input
        className="preset-combobox-input"
        list={listId}
        placeholder="搜索提供商预设"
        defaultValue={display}
        key={value}
      />
      <datalist id={listId}>
        <option value="自定义">自定义</option>
        {presets.map((preset) => <option key={preset.id} value={preset.name}>{preset.id}</option>)}
      </datalist>
      <select
        className="preset-combobox-select"
        aria-label="提供商预设"
        value={selected ? selected.name : "自定义"}
        onChange={(event) => {
          const name = event.target.value;
          const match = presets.find((preset) => preset.name === name);
          onSelect(match ? match.id : "custom");
        }}
      >
        <option value="自定义">自定义</option>
        {presets.map((preset) => <option key={preset.id} value={preset.name}>{preset.name}</option>)}
      </select>
    </span>
  );
}
