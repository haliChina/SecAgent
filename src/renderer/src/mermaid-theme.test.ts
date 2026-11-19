/**
 * Mermaid 主题回归锁：深色面板必须用 dark 主题，且边标签底色要把文字
 * 抬到 WCAG AA 4.5:1 以上（mermaid 自带的 #585858 只有 4.43:1）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MERMAID_DARK_EDGE_LABEL_BACKGROUND, MERMAID_DARK_TEXT, mermaidThemeFor, mermaidThemeVariables } from "./mermaid-theme.js";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
}

test("深色面板使用 dark 主题，浅色面板保持 default", () => {
  assert.equal(mermaidThemeFor(true), "dark");
  assert.equal(mermaidThemeFor(false), "default");
});

test("只有 dark 主题覆盖主题变量", () => {
  assert.deepEqual(mermaidThemeVariables("default"), {});
  assert.deepEqual(mermaidThemeVariables("dark"), { edgeLabelBackground: MERMAID_DARK_EDGE_LABEL_BACKGROUND });
});

test("dark 主题边标签文字对底色达到 AA 4.5:1", () => {
  // #585858 是 mermaid dark 的默认边标签底，实测 4.43:1 —— 低于 AA。
  assert.ok(contrast(MERMAID_DARK_TEXT, "#585858") < 4.5);
  assert.ok(contrast(MERMAID_DARK_TEXT, MERMAID_DARK_EDGE_LABEL_BACKGROUND) >= 4.5);
});

test("dark 主题正文对应用深色面板背景达到 AA", () => {
  // --bg-1 (#111720) 与 --bg-0 (#0B0F14) 是图表所在的实际面板色。
  assert.ok(contrast(MERMAID_DARK_TEXT, "#111720") >= 4.5);
  assert.ok(contrast(MERMAID_DARK_TEXT, "#0B0F14") >= 4.5);
});