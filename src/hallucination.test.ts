import assert from "node:assert/strict";
import test from "node:test";
import { detectHallucination } from "./hallucination.js";

test("flags answers claiming success after failed tool calls", () => {
  const report = detectHallucination("操作已经成功完成，积分已加 5 分。", { toolCalls: [{ name: "secagent__secscore", ok: false }], runCompleted: true });
  assert.ok(report.signals.some((signal) => signal.id === "claims_success_after_tool_failure"));
});

test("does not flag honest failure reports", () => {
  const report = detectHallucination("很抱歉，积分添加失败：数据库不可用。", { toolCalls: [{ name: "secagent__secscore", ok: false }], runCompleted: true });
  assert.equal(report.signals.some((signal) => signal.id === "claims_success_after_tool_failure"), false);
});

test("flags repetition loops", () => {
  const line = "这个答案就是不断重复同样的一句话没有新信息";
  const text = Array(40).fill(line).join("\n");
  const report = detectHallucination(text, { toolCalls: [], runCompleted: true });
  assert.ok(report.signals.some((signal) => signal.id === "repetition_loop"));
});

test("flags fabricated references to never-produced evidence", () => {
  const report = detectHallucination("如上图所示，数据呈上升趋势。", { toolCalls: [], runCompleted: true });
  assert.ok(report.signals.some((signal) => signal.id === "fabricated_tool_reference"));
});

test("clean answers stay clean", () => {
  const report = detectHallucination("根据你提供的配置文件，发现默认模型未设置。建议在设置页选择一个默认模型。", { toolCalls: [{ name: "secagent__read_file", ok: true }], runCompleted: true });
  assert.equal(report.score, 0);
});
