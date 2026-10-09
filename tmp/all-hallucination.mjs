// src/hallucination.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/hallucination.ts
var REPETITION_WINDOW = 24;
function normalizedLines(text) {
  return text.split(/\n+/).map((line) => line.trim().replace(/\s+/g, " ")).filter((line) => line.length >= 8);
}
function detectRepetitionLoop(text) {
  const lines = normalizedLines(text);
  if (lines.length < REPETITION_WINDOW) return void 0;
  const chunks = lines.map((line) => {
    const words = line.split(" ");
    return words.length <= 8 ? words.join(" ") : words.slice(0, 8).join(" ");
  });
  const counts = /* @__PURE__ */ new Map();
  for (const chunk of chunks) counts.set(chunk, (counts.get(chunk) || 0) + 1);
  let maxCount = 0;
  let topChunk = "";
  for (const [chunk, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      topChunk = chunk;
    }
  }
  if (maxCount >= REPETITION_WINDOW && maxCount / chunks.length >= 0.4) {
    return { id: "repetition_loop", detail: `\u56DE\u7B54\u7591\u4F3C\u9677\u5165\u5FAA\u73AF\u91CD\u590D\uFF08\u300C${topChunk.slice(0, 40)}\u2026\u300D\u51FA\u73B0 ${maxCount} \u6B21\uFF0C\u5360\u6B63\u6587 ${(100 * maxCount / chunks.length).toFixed(0)}%\uFF09\u3002` };
  }
  return void 0;
}
var SUCCESS_CLAIM_PATTERN = /(?:已(?:经)?(?:成功|完成|执行)|操作已(?:成功)?|successfully (?:completed|done)|done\.)/i;
var FAILURE_ACK_PATTERN = /(?:失败|未能|无法|没有成功|出错|error|failed)/i;
var TOOL_MENTION = /(?:工具|调用|secagent__|secscore|plugin)/i;
function detectSuccessClaimAfterFailure(evidence, text) {
  const failures = evidence.toolCalls.filter((call) => !call.ok);
  if (!failures.length) return void 0;
  const head = text.slice(0, 600);
  const claimsSuccess = SUCCESS_CLAIM_PATTERN.test(head) && !FAILURE_ACK_PATTERN.test(head);
  const mentionsTool = TOOL_MENTION.test(text) || /(?:操作|积分|写入|保存|修改|创建)/.test(head);
  if (claimsSuccess && mentionsTool) {
    const names = [...new Set(failures.map((call) => call.name))].slice(0, 3).join("\u3001");
    return { id: "claims_success_after_tool_failure", detail: `\u672C\u8F6E\u5DE5\u5177 ${names} \u5B9E\u9645\u6267\u884C\u5931\u8D25\uFF0C\u4F46\u56DE\u7B54\u5F00\u5934\u58F0\u79F0\u64CD\u4F5C\u5DF2\u6210\u529F\u3002\u8BF7\u6838\u5B9E\u540E\u518D\u91C7\u4FE1\u3002` };
  }
  return void 0;
}
var FABRICATED_REFERENCE = /(?:如上(?:方|图|文)所示|从(?:上述|以上)(?:结果|截图|表格)可见|(?:as shown|as mentioned) (?:above|in the table))/i;
function detectFabricatedReference(evidence, text) {
  if (evidence.toolCalls.length > 0) return void 0;
  const match = text.match(FABRICATED_REFERENCE);
  if (match) return { id: "fabricated_tool_reference", detail: `\u56DE\u7B54\u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u6750\u6599\uFF08\u300C${match[0]}\u300D\uFF09\uFF0C\u4F46\u672C\u8F6E\u6CA1\u6709\u4EFB\u4F55\u5DE5\u5177\u4EA7\u751F\u6570\u636E\u3002` };
  return void 0;
}
function detectHallucination(finalText, evidence) {
  const signals = [];
  const repetition = detectRepetitionLoop(finalText);
  if (repetition) signals.push(repetition);
  const successClaim = detectSuccessClaimAfterFailure(evidence, finalText);
  if (successClaim) signals.push(successClaim);
  const fabricated = detectFabricatedReference(evidence, finalText);
  if (fabricated) signals.push(fabricated);
  return { score: signals.length, signals };
}

// src/hallucination.test.ts
test("flags answers claiming success after failed tool calls", () => {
  const report = detectHallucination("\u64CD\u4F5C\u5DF2\u7ECF\u6210\u529F\u5B8C\u6210\uFF0C\u79EF\u5206\u5DF2\u52A0 5 \u5206\u3002", { toolCalls: [{ name: "secagent__secscore", ok: false }], runCompleted: true });
  assert.ok(report.signals.some((signal) => signal.id === "claims_success_after_tool_failure"));
});
test("does not flag honest failure reports", () => {
  const report = detectHallucination("\u5F88\u62B1\u6B49\uFF0C\u79EF\u5206\u6DFB\u52A0\u5931\u8D25\uFF1A\u6570\u636E\u5E93\u4E0D\u53EF\u7528\u3002", { toolCalls: [{ name: "secagent__secscore", ok: false }], runCompleted: true });
  assert.equal(report.signals.some((signal) => signal.id === "claims_success_after_tool_failure"), false);
});
test("flags repetition loops", () => {
  const line = "\u8FD9\u4E2A\u7B54\u6848\u5C31\u662F\u4E0D\u65AD\u91CD\u590D\u540C\u6837\u7684\u4E00\u53E5\u8BDD\u6CA1\u6709\u65B0\u4FE1\u606F";
  const text = Array(40).fill(line).join("\n");
  const report = detectHallucination(text, { toolCalls: [], runCompleted: true });
  assert.ok(report.signals.some((signal) => signal.id === "repetition_loop"));
});
test("flags fabricated references to never-produced evidence", () => {
  const report = detectHallucination("\u5982\u4E0A\u56FE\u6240\u793A\uFF0C\u6570\u636E\u5448\u4E0A\u5347\u8D8B\u52BF\u3002", { toolCalls: [], runCompleted: true });
  assert.ok(report.signals.some((signal) => signal.id === "fabricated_tool_reference"));
});
test("clean answers stay clean", () => {
  const report = detectHallucination("\u6839\u636E\u4F60\u63D0\u4F9B\u7684\u914D\u7F6E\u6587\u4EF6\uFF0C\u53D1\u73B0\u9ED8\u8BA4\u6A21\u578B\u672A\u8BBE\u7F6E\u3002\u5EFA\u8BAE\u5728\u8BBE\u7F6E\u9875\u9009\u62E9\u4E00\u4E2A\u9ED8\u8BA4\u6A21\u578B\u3002", { toolCalls: [{ name: "secagent__read_file", ok: true }], runCompleted: true });
  assert.equal(report.score, 0);
});
