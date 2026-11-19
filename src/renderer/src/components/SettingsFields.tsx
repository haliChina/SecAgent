/**
 * 设置窗口表单字段助手（B4 自 SettingsApp.tsx 拆出）。
 *
 * WakeHotkeyField：唤醒快捷键捕获输入（受控组件，捕获态本地）。
 * updateReleaseLabel / formatUpdateBytes：更新卡片展示格式化。
 * 逻辑逐字搬运，行为零变化。
 */
import { useState } from "react";
import { DEFAULT_WAKE_HOTKEY, displayWakeHotkey, wakeHotkeyFromKeyboardEvent } from "../../../wake-hotkey.js";

export function WakeHotkeyField({ value, platform, onChange }: { value: string; platform: NodeJS.Platform; onChange: (value: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  return <div className="wake-hotkey-field">
    <label>全局快捷键<input readOnly value={capturing ? "请按下快捷键..." : displayWakeHotkey(value, platform)} onFocus={() => setCapturing(true)} onBlur={() => setCapturing(false)} onKeyDown={(event) => { event.preventDefault(); const hotkey = wakeHotkeyFromKeyboardEvent(event.nativeEvent); if (hotkey) { onChange(hotkey); setCapturing(false); } }} /></label>
    <button type="button" className="secondary-button" onClick={() => onChange(DEFAULT_WAKE_HOTKEY)}>恢复默认</button>
  </div>;
}

export function updateReleaseLabel(release: UpdateRelease | undefined, channel: UpdateChannel): string {
  if (release?.releaseType === "alpha") return "内测版";
  if (release?.releaseType === "beta") return "测试版";
  return channel === "preview" ? "预览版" : "稳定版";
}

export function formatUpdateBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
