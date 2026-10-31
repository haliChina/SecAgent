/**
 * P3-5 主题三态——纯逻辑回归锁。
 *
 * resolveTheme 三态折算 + readCachedTheme 白名单回落。
 * （applyTheme/watchSystemTheme 是 DOM 副作用，由扫描器与 tsc 守护
 * 引用完整性；config 链路校验在 config.test.ts。）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveTheme, readCachedTheme, THEMES, type Theme } from "./theme.js";

test("resolveTheme：dark 直传、light 直传", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("light", false), "light");
});

test("resolveTheme：system 跟随 OS 偏好折算", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("THEMES 白名单：恰好三态", () => {
  assert.deepEqual([...THEMES], ["light", "dark", "system"]);
});

test("readCachedTheme：合法值透传，非法值回落 light", () => {
  assert.equal(readCachedTheme("light"), "light");
  assert.equal(readCachedTheme("dark"), "dark");
  assert.equal(readCachedTheme("system"), "system");
  assert.equal(readCachedTheme("blue"), "light");
  assert.equal(readCachedTheme("DARK"), "light");
  assert.equal(readCachedTheme(""), "light");
  assert.equal(readCachedTheme(null), "light");
  assert.equal(readCachedTheme("[object Object]"), "light");
});

test("类型完整性：Theme 联合覆盖三值", () => {
  const all: Theme[] = ["light", "dark", "system"];
  assert.equal(all.length, THEMES.length);
});
