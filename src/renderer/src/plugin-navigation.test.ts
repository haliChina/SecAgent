import test from "node:test";
import assert from "node:assert/strict";
import { pluginNavigationIndex } from "./plugin-navigation.js";

test("插件页签左右循环且支持 Home/End", () => {
  assert.equal(pluginNavigationIndex("ArrowRight", 0, 3, "horizontal"), 1);
  assert.equal(pluginNavigationIndex("ArrowRight", 2, 3, "horizontal"), 0);
  assert.equal(pluginNavigationIndex("ArrowLeft", 0, 3, "horizontal"), 2);
  assert.equal(pluginNavigationIndex("Home", 2, 3, "horizontal"), 0);
  assert.equal(pluginNavigationIndex("End", 0, 3, "horizontal"), 2);
});
test("插件列表只接管纵向键，不拦截无关按键", () => {
  assert.equal(pluginNavigationIndex("ArrowDown", 0, 2, "vertical"), 1);
  assert.equal(pluginNavigationIndex("ArrowUp", 0, 2, "vertical"), 1);
  assert.equal(pluginNavigationIndex("ArrowRight", 0, 2, "vertical"), null);
  assert.equal(pluginNavigationIndex("ArrowDown", 0, 2, "horizontal"), null);
  for (const key of ["Tab", "Enter", " ", "Escape", "a"]) assert.equal(pluginNavigationIndex(key, 0, 2, "horizontal"), null);
});
test("插件空列表与单项列表不产生越界下标", () => {
  assert.equal(pluginNavigationIndex("End", 0, 0, "vertical"), null);
  assert.equal(pluginNavigationIndex("ArrowRight", 0, 1, "horizontal"), 0);
});
