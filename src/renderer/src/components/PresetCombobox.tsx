/**
 * Provider preset picker — single native <select>.
 *
 * v2 rendered an <input list> and a <select> side by side, which looked like
 * two "自定义" fields in the provider dialog. The input was only decorative
 * (the select held the real value), so this keeps one full-width control.
 */
export function PresetCombobox({ value, presets, onSelect }: { value: string; presets: ProviderPreset[]; onSelect: (id: string) => void }) {
  const selected = presets.find((preset) => preset.id === value);
  return (
    <select
      className="preset-combobox preset-combobox-select"
      aria-label="提供商预设"
      value={selected ? selected.id : "custom"}
      onChange={(event) => onSelect(event.target.value)}
    >
      <option value="custom">自定义</option>
      {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select>
  );
}
