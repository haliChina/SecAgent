import assert from "node:assert/strict";
import test from "node:test";
import { checkToolCall, normalizeToolGuardSettings } from "./tool-guard.js";
import {
  budgetStopMessage,
  DEFAULT_MODEL_BUDGET,
  normalizeModelBudgetSettings,
  pruneImageHistory,
  IMAGE_PRUNE_NOTE
} from "./model-budget.js";

// ---- 工具守卫：GUI 动作 ----

test("GUI typing an irreversible action requires confirmation", () => {
  for (const text of ["确认支付", "rm -rf /data", "删除全部记录", "格式化 C 盘", "发送验证码 1234"]) {
    const decision = checkToolCall({ tool: "computer-use__type", arguments: { text } }, normalizeToolGuardSettings(undefined));
    assert.equal(decision.action, "confirm", text);
  }
});

test("GUI typing ordinary text is not interrupted", () => {
  for (const text of ["你好世界", "hello@example.com", "192.168.1.1", "C:\\Users\\me\\notes.txt"]) {
    const decision = checkToolCall({ tool: "computer-use__type", arguments: { text } }, normalizeToolGuardSettings(undefined));
    assert.equal(decision.action, "allow", text);
  }
});

test("dangerous key chords are gated, ordinary ones are not", () => {
  const guard = normalizeToolGuardSettings(undefined);
  for (const keys of ["alt+f4", "ctrl+alt+delete", "win+l", "WIN+Q"]) {
    assert.equal(checkToolCall({ tool: "computer-use__key", arguments: { keys } }, guard).action, "confirm", keys);
  }
  for (const keys of ["ctrl+c", "alt+tab", "f5", "enter"]) {
    assert.equal(checkToolCall({ tool: "computer-use__key", arguments: { keys } }, guard).action, "allow", keys);
  }
});

test("GUI guard does not leak into unrelated tools that take a text argument", () => {
  const decision = checkToolCall({ tool: "send_message", arguments: { text: "确认支付" } }, normalizeToolGuardSettings(undefined));
  assert.equal(decision.action, "allow");
});

test("GUI signatures are stable and honour always-allow", () => {
  const first = checkToolCall({ tool: "computer-use__type", arguments: { text: "确认支付 100 元" } }, normalizeToolGuardSettings(undefined));
  const second = checkToolCall({ tool: "computer-use__type", arguments: { text: "确认支付  100 元" } }, normalizeToolGuardSettings(undefined));
  assert.equal(first.action, "confirm");
  if (first.action !== "confirm" || second.action !== "confirm") return;
  assert.equal(first.signature, second.signature);
  const approved = normalizeToolGuardSettings({ approved: [first.signature] });
  assert.equal(checkToolCall({ tool: "computer-use__type", arguments: { text: "确认支付 100 元" } }, approved).action, "allow");
  // Different risky text still asks.
  assert.equal(checkToolCall({ tool: "computer-use__type", arguments: { text: "删除文件" } }, approved).action, "confirm");
});

// ---- 模型预算 ----

test("budget defaults keep previous behaviour", () => {
  const settings = normalizeModelBudgetSettings(undefined);
  assert.equal(settings.maxToolTurns, 0);
  assert.equal(settings.keepRecentImages, DEFAULT_MODEL_BUDGET.keepRecentImages);
  assert.deepEqual(normalizeModelBudgetSettings({ maxToolTurns: -5 }), { maxToolTurns: 0, keepRecentImages: 2 });
  assert.equal(normalizeModelBudgetSettings({ maxToolTurns: 12 }).maxToolTurns, 12);
  assert.equal(normalizeModelBudgetSettings({ keepRecentImages: 999 }).keepRecentImages, 24);
});

const png = (tag: string) => `data:image/png;base64,${tag}`;

test("only the newest images survive, older ones become text markers", () => {
  const messages = [
    { role: "user", content: [{ type: "image_url", image_url: { url: png("A") } }] },
    { role: "user", content: [{ type: "image_url", image_url: { url: png("B") } }] },
    { role: "user", content: [{ type: "image_url", image_url: { url: png("C") } }] }
  ];
  const { messages: pruned, dropped } = pruneImageHistory(messages, 2);
  assert.equal(dropped, 1);
  assert.equal((pruned[0].content[0] as { type: string }).type, "text");
  assert.equal((pruned[0].content[0] as unknown as { text: string }).text, IMAGE_PRUNE_NOTE);
  assert.equal((pruned[2].content[0] as { type: string }).type, "image_url");
  assert.equal((pruned[1].content[0] as { type: string }).type, "image_url");
});

test("pruning never mutates the input array or its nodes", () => {
  const node = { role: "user", content: [{ type: "image_url", image_url: { url: png("A") } }] };
  const messages = [node];
  const { messages: pruned, dropped } = pruneImageHistory(messages, 0);
  assert.equal(dropped, 1);
  assert.equal(node.content[0].type, "image_url");
  assert.notEqual(pruned[0], node);
});

test("anthropic and gemini shapes are pruned too", () => {
  const anthropic = [
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "A" } }] },
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "B" } }] }
  ];
  const { messages: prunedAnthropic, dropped: droppedA } = pruneImageHistory(anthropic, 1);
  assert.equal(droppedA, 1);
  assert.equal((prunedAnthropic[0].content[0] as { type: string }).type, "text");
  assert.equal((prunedAnthropic[1].content[0] as { type: string }).type, "image");

  const gemini = [
    { role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "A" } }] },
    { role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "B" } }] }
  ];
  const { messages: prunedGemini, dropped: droppedG } = pruneImageHistory(gemini, 1);
  assert.equal(droppedG, 1);
  assert.ok("text" in (prunedGemini[0].parts[0] as Record<string, unknown>));
  assert.ok("inlineData" in (prunedGemini[1].parts[0] as Record<string, unknown>));
});

test("openai-responses input_image becomes input_text", () => {
  const input = [{ type: "function_call_output", output: [{ type: "input_image", image_url: png("A") }] }];
  const { messages: pruned, dropped } = pruneImageHistory(input, 0);
  assert.equal(dropped, 1);
  assert.equal((pruned[0].output[0] as { type: string }).type, "input_text");
});

test("keep >= images leaves the history untouched", () => {
  const messages = [{ role: "user", content: [{ type: "image_url", image_url: { url: png("A") } }] }];
  const { messages: pruned, dropped } = pruneImageHistory(messages, 5);
  assert.equal(dropped, 0);
  assert.equal(pruned[0], messages[0]);
});

test("budgetStopMessage includes the limit and any last text", () => {
  const message = budgetStopMessage(20, "已经打开了设置页面");
  assert.match(message, /20 轮/);
  assert.match(message, /已经打开了设置页面/);
  assert.equal(budgetStopMessage(8), "已停止自动调用工具：达到单轮工具调用上限（8 轮）。");
});