import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePluginPanelStatus,
  normalizePluginSettings,
  pluginFieldDefault,
  pluginFieldKind,
  pluginPhaseLabel,
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

test("normalizePluginSettings 归一化服务面板并保留动作", () => {
  const result = normalizePluginSettings({
    groups: [{ id: "general", title: "常规", fields: [{ key: "a", type: "boolean" }] }],
    panels: [
      { id: "omni", title: "本地视觉服务", description: "一键安装", statusAction: "omni-status", pollMs: 1000 },
      { id: "ext", title: "浏览器扩展桥", statusAction: "ext-status" },
      { id: "bad", title: "", statusAction: "x" },
      { id: "omni", title: "重复", statusAction: "dup" }
    ]
  });
  assert.deepEqual(result.panels.map((panel) => panel.id), ["omni", "ext"]);
  assert.equal(result.panels[0].pollMs, 1000);
  assert.equal(result.panels[1].pollMs, 2000, "未声明轮询间隔时使用默认值");
});

test("normalizePluginPanelStatus 忽略非法字段并夹住进度", () => {
  const status = normalizePluginPanelStatus({
    phase: "installing",
    label: "安装中",
    message: "正在下载权重",
    progress: 145,
    facts: [{ label: "端口", value: 18789 }, { label: "", value: "x" }],
    actions: [
      { id: "omni-install", label: "一键安装", primary: true, disabled: true },
      { id: "bad", label: "" }
    ]
  });
  assert.equal(status.phase, "installing");
  assert.equal(status.progress, 100);
  assert.deepEqual(status.facts, [{ label: "端口", value: "18789" }]);
  assert.deepEqual(status.actions, [{ id: "omni-install", label: "一键安装", primary: true, disabled: true }]);
  assert.deepEqual(normalizePluginPanelStatus(null), {});
  assert.deepEqual(normalizePluginPanelStatus("nope"), {});
});

test("pluginPhaseLabel 覆盖常见服务阶段", () => {
  assert.equal(pluginPhaseLabel("running"), "运行中");
  assert.equal(pluginPhaseLabel("pending"), "等待允许");
  assert.equal(pluginPhaseLabel("custom-phase"), "custom-phase");
  assert.equal(pluginPhaseLabel(undefined), "未连接");
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
