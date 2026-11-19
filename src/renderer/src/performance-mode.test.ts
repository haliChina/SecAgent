import test from "node:test";
import assert from "node:assert/strict";
import { normalizePerformanceMode, resolvePerformanceMode } from "./performance-mode.js";

test("性能模式：非法值回落 auto", () => {
  assert.equal(normalizePerformanceMode(undefined), "auto");
  assert.equal(normalizePerformanceMode("high"), "auto");
  assert.equal(normalizePerformanceMode("smooth"), "smooth");
});

test("性能模式：auto 跟随大屏，smooth/quality 强制", () => {
  assert.equal(resolvePerformanceMode("auto", true), "smooth");
  assert.equal(resolvePerformanceMode("auto", false), "quality");
  assert.equal(resolvePerformanceMode("quality", true), "quality");
  assert.equal(resolvePerformanceMode("smooth", false), "smooth");
});