import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePluginSettings,
  pluginFieldDefault,
  pluginFieldKind,
  pluginPathKind,
  pluginValueMatchesDefault,
  pluginValuesEqual,
  summarizePluginActionResult
} from "./plugin-settings.js";
import type { NormalizedPluginSettings, PluginSettingGroup, PluginSettingOption } from "./plugin-settings.js";

test("normalizePluginSettings 支持平铺 fields + groups，并过滤 hidden", () => {
  const groups: PluginSettingGroup[] = [{ id: "a", title: "分组 A", description: "说明" }, { id: "b", title: "分组 B" }];
  const result: NormalizedPluginSettings = normalizePluginSettings({
    groups,
    fields: [
      { key: "x", group: "a", type: "number", hidden: true },
      { key: "y", group: "a", type: "bool" },
      { key: "z", group: "b", type: "string" },
      { key: "orphan", type: "string" }
    ],
    actions: [{ id: "test", label: "测试连接" }]
  });
  assert.equal(result.sections.length, 3);
  assert.deepEqual(result.sections[0].fields.map((field) => field.key), ["y"], "hidden 字段不应渲染");
  assert.equal(result.sections[0].description, "说明");
  assert.equal(result.sections[2].title, "general", "未在 groups 中声明的分组回退为分组 id");
  assert.deepEqual(result.actions.map((action) => action.id), ["test"]);
});

test("normalizePluginSettings 支持分组内嵌 fields，并丢弃重复/非法 action", () => {
  const result = normalizePluginSettings({
    groups: [
      { id: "general", title: "常规", fields: [{ key: "a", type: "boolean" }, { key: "hidden", hidden: true }] },
      { id: "empty", title: "空分组", fields: [] }
    ],
    actions: [
      { id: "skins", label: "皮肤列表" },
      { id: "skins", label: "重复" },
      { id: "", label: "无 id" },
      { id: "reset", label: "恢复默认" }
    ]
  });
  assert.equal(result.sections.length, 1);
  assert.deepEqual(result.sections[0].fields.map((field) => field.key), ["a"]);
  assert.deepEqual(result.actions.map((action) => action.id), ["skins", "reset"]);
});

test("pluginFieldKind 归一 bool/secret/textarea/path 别名", () => {
  const options: PluginSettingOption[] = [{ value: "a", label: "A" }];
  assert.equal(pluginFieldKind({ key: "a", type: "bool" }), "boolean");
  assert.equal(pluginFieldKind({ key: "a", type: "toggle" }), "boolean");
  assert.equal(pluginFieldKind({ key: "a", type: "secret" }), "password");
  assert.equal(pluginFieldKind({ key: "a", type: "string", multiline: true }), "textarea");
  assert.equal(pluginFieldKind({ key: "a", type: "path" }), "path");
  assert.equal(pluginFieldKind({ key: "a", pathKind: "file" }), "path");
  assert.equal(pluginFieldKind({ key: "a", type: "select", options }), "select");
  assert.equal(pluginFieldKind({ key: "a", type: "select", options: [] }), "text", "空 options 退化为文本框");
  assert.equal(pluginPathKind({ key: "a", type: "path" }), "directory");
  assert.equal(pluginPathKind({ key: "a", pathKind: "file" }), "file");
});

test("pluginFieldDefault 保留数字字符串中间态，并能匹配默认值", () => {
  const number = { key: "size", type: "number", default: 160 };
  assert.equal(pluginFieldDefault(number), "160");
  assert.equal(pluginValueMatchesDefault(number, "160"), true);
  assert.equal(pluginValueMatchesDefault(number, 160), true);
  assert.equal(pluginValueMatchesDefault(number, "200"), false);
  const bool = { key: "on", type: "boolean", default: true };
  assert.equal(pluginFieldDefault(bool), true);
  assert.equal(pluginValueMatchesDefault(bool, false), false);
});

test("pluginValuesEqual 忽略键顺序", () => {
  assert.equal(pluginValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(pluginValuesEqual({ a: 1 }, { a: 2 }), false);
});

test("summarizePluginActionResult 优先 note，其次皮肤列表，最后压平对象", () => {
  assert.equal(summarizePluginActionResult({ ok: true, note: "已连接" }), "已连接");
  assert.equal(summarizePluginActionResult({ ok: true, skins: [{ id: "a", displayName: "小猫" }, { id: "b" }] }), "小猫、b");
  assert.equal(
    summarizePluginActionResult({ ok: true, companion: { ok: true, tools: 12 }, local: { running: false } }),
    "ok: true\ncompanion.ok: true\ncompanion.tools: 12\nlocal.running: false"
  );
  assert.equal(summarizePluginActionResult(null), "操作完成");
});
