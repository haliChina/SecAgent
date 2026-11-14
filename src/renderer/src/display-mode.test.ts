import test from "node:test";
import assert from "node:assert/strict";
import { resolveDisplayMode } from "./display-mode.js";

test("显示模式：显式偏好优先于自动判断", () => {
  assert.equal(resolveDisplayMode("desktop", 3840, 10), "desktop");
  assert.equal(resolveDisplayMode("big-touch", 1280, 0), "big-touch");
});

test("显示模式：大屏 + 触点自动建议大屏模式", () => {
  assert.equal(resolveDisplayMode(null, 1920, 10), "big-touch");
  assert.equal(resolveDisplayMode(null, 1600, 1), "big-touch");
  assert.equal(resolveDisplayMode(null, 1599, 10), "desktop");
});

test("显示模式：无触点或小屏保持桌面", () => {
  assert.equal(resolveDisplayMode(null, 1920, 0), "desktop");
  assert.equal(resolveDisplayMode(undefined as unknown as string | null, 1280, 10), "desktop");
});