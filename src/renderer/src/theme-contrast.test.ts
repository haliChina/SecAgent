/**
 * 语义色/令牌回归锁（源码级）：主按钮文字与状态色必须走令牌，且令牌对
 * 彼此的背景达到 WCAG AA。防止再次把 #4ADE80 / #F87171 直接写进浅色面板，
 * 或让深色主色 #3B82F6 继续配白字（3.68:1）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const styles = fs.readFileSync(path.resolve(import.meta.dirname, "../../../src/renderer/src/styles.css"), "utf8").replace(/\r\n/g, "\n");

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
}

/* 令牌分散在多个 :root 块（基础色块 + 语义色块），需逐块查找。 */
const rootRules = [...styles.matchAll(/(:root(?:\[data-theme="dark"\])?)\s*\{([^}]*)\}/g)]
  .map((match) => ({ selector: match[1], body: match[2] }));

function token(name: string, dark: boolean): string {
  for (const rule of rootRules) {
    if (rule.selector.includes('data-theme="dark"') !== dark) continue;
    const hit = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(rule.body);
    if (hit) return hit[1];
  }
  assert.fail(`token --${name} missing (dark=${dark})`);
}

test("主按钮文字令牌在浅色与深色主色上都达到 AA 4.5:1", () => {
  assert.ok(contrast(token("on-accent", false), token("accent", false)) >= 4.5);
  assert.ok(contrast(token("on-accent", true), token("accent", true)) >= 4.5);
});

test("危险/成功文字令牌在各自面板背景上达到 AA", () => {
  for (const dark of [false, true]) {
    const panel = token("bg-1", dark);
    assert.ok(contrast(token("danger", dark), panel) >= 4.5, `danger on bg-1 (dark=${dark})`);
    assert.ok(contrast(token("success", dark), panel) >= 4.5, `success on bg-1 (dark=${dark})`);
  }
});

test("状态文字不再写死深色主题专用色值", () => {
  // 这两色只在深色面板可读，浅色底上分别是 1.38:1 与 2.5:1。
  assert.doesNotMatch(styles, /color:\s*#4ADE80/i);
  assert.doesNotMatch(styles, /color:\s*#F87171/i);
});