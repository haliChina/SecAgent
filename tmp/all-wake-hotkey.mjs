// src/wake-hotkey.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/wake-hotkey.ts
var MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Super"];
var MODIFIERS = new Set(MODIFIER_ORDER);
var KEY_ALIASES = {
  CONTROL: "Ctrl",
  CTRL: "Ctrl",
  OPTION: "Alt",
  ALT: "Alt",
  SHIFT: "Shift",
  CMD: "Super",
  COMMAND: "Super",
  META: "Super",
  SUPER: "Super"
};
var DEFAULT_WAKE_HOTKEY = "Ctrl+Alt+A";
function normalizeKey(value) {
  const key = value.trim();
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  const functionKey = key.match(/^F([1-9]|1[0-9]|2[0-4])$/i);
  if (functionKey) return `F${functionKey[1]}`;
  const named = ["Space", "Tab", "Enter", "Escape", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Up", "Down", "Left", "Right"];
  const match = named.find((item) => item.toLowerCase() === key.toLowerCase());
  if (match) return match;
  throw new Error("\u5FEB\u6377\u952E\u5FC5\u987B\u5305\u542B\u4E00\u4E2A\u5B57\u6BCD\u3001\u6570\u5B57\u3001\u529F\u80FD\u952E\u6216\u65B9\u5411\u952E");
}
function normalizeWakeHotkey(value) {
  if (typeof value !== "string") throw new Error("\u968F\u65F6\u5524\u9192\u5FEB\u6377\u952E\u65E0\u6548");
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) throw new Error("\u968F\u65F6\u5524\u9192\u5FEB\u6377\u952E\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u4FEE\u9970\u952E\u548C\u4E00\u4E2A\u6309\u952E");
  const key = normalizeKey(parts.at(-1) || "");
  const modifiers = [...new Set(parts.slice(0, -1).map((part) => KEY_ALIASES[part.toUpperCase()] || part))];
  if (!modifiers.length || modifiers.some((modifier) => !MODIFIERS.has(modifier))) throw new Error("\u968F\u65F6\u5524\u9192\u5FEB\u6377\u952E\u5305\u542B\u4E0D\u652F\u6301\u7684\u4FEE\u9970\u952E");
  return `${MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier)).join("+")}+${key}`;
}
function displayWakeHotkey(value, platform) {
  const normalized = normalizeWakeHotkey(value);
  if (platform !== "darwin") return normalized.replaceAll("+", " ");
  return normalized.replace("Alt", "Option").replace("Super", "Command").replaceAll("+", " ");
}
function wakeHotkeyFromKeyboardEvent(event) {
  const modifiers = [event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.metaKey ? "Super" : ""].filter(Boolean);
  if (!modifiers.length || ["Control", "Alt", "Shift", "Meta", "OS", "Option", "Command"].includes(event.key)) return null;
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : event.key;
  try {
    return normalizeWakeHotkey([...modifiers, key].join("+"));
  } catch {
    return null;
  }
}

// src/wake-hotkey.test.ts
test("normalizes the default wake shortcut", () => {
  assert.equal(normalizeWakeHotkey(DEFAULT_WAKE_HOTKEY), "Ctrl+Alt+A");
  assert.equal(displayWakeHotkey(DEFAULT_WAKE_HOTKEY, "win32"), "Ctrl Alt A");
  assert.equal(displayWakeHotkey(DEFAULT_WAKE_HOTKEY, "darwin"), "Ctrl Option A");
});
test("rejects shortcuts without modifiers or a final key", () => {
  assert.throws(() => normalizeWakeHotkey("A"));
  assert.throws(() => normalizeWakeHotkey("Ctrl+Unknown"));
});
test("captures keyboard events using physical key codes", () => {
  assert.equal(wakeHotkeyFromKeyboardEvent({ key: "\xE5", code: "KeyA", ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }), "Ctrl+Alt+A");
});
