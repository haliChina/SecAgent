import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateConversationTokens,
  estimateMessageTokens,
  estimateTokens,
  formatTokenCount,
  resolvePromptBudget,
  trimConversationToBudget,
  type ContextMessage
} from "./context-budget.js";

const msg = (role: ContextMessage["role"], content: string, extra: Partial<ContextMessage> = {}): ContextMessage => ({ role, content, ...extra });

test("estimateTokens: empty is 0, CJK is denser than Latin", () => {
  assert.equal(estimateTokens(""), 0);
  const cjk = "中".repeat(100);
  const latin = "a".repeat(100);
  assert.equal(estimateTokens(cjk), 75, "0.75 tokens per CJK character");
  assert.equal(estimateTokens(latin), 25, "4 Latin characters per token");
  assert.ok(estimateTokens(cjk) > estimateTokens(latin) * 2);
});

test("estimateTokens: CJK estimate stays within ±15% of the measured tokenizer", () => {
  const chars = 262_144;
  const realTokens = Math.round(chars / 1.39);
  const ratio = estimateTokens("中".repeat(chars)) / realTokens;
  assert.ok(ratio > 0.85 && ratio < 1.15, `ratio ${ratio.toFixed(3)} outside the calibration band`);
});

test("estimateMessageTokens: tool arguments/results count, base64 media does not", () => {
  const base64 = `data:image/png;base64,${"A".repeat(2_000_000)}`;
  const message = msg("assistant", "完成", {
    toolCalls: [{ name: "screenshot", arguments: { path: "a.png" }, result: { image: base64 } }]
  });
  const withoutMedia = estimateMessageTokens(message);
  const plain = estimateMessageTokens(msg("assistant", "完成", {
    toolCalls: [{ name: "screenshot", arguments: { path: "a.png" }, result: { ok: true } }]
  }));
  assert.ok(withoutMedia < 1_000, `media payload inflated the estimate to ${withoutMedia}`);
  assert.ok(plain < 1_000);
  assert.equal(estimateConversationTokens([message]), withoutMedia);
});

test("resolvePromptBudget: 0 means unlimited; reply share is capped at 12.5%", () => {
  assert.equal(resolvePromptBudget(0, 16_384), undefined);
  assert.equal(resolvePromptBudget(-1, 16_384), undefined);
  /* 128k window reserves 12.5% = 16k, so a 16_384 request is capped to 16_000. */
  assert.deepEqual(resolvePromptBudget(128_000, 16_384), { promptTokens: 112_000, outputTokens: 16_000 });
  assert.deepEqual(resolvePromptBudget(8_000, 16_384), { promptTokens: 7_000, outputTokens: 1_000 });
  assert.deepEqual(resolvePromptBudget(128_000, 0), { promptTokens: 128_000 - 1_024, outputTokens: 1_024 });
});

test("trimConversationToBudget: keeps newest whole messages and skips an oversize middle message", () => {
  const messages = [
    msg("user", "first small turn"),
    msg("assistant", "y".repeat(30_000)),
    msg("user", "latest small turn")
  ];
  const { messages: out, dropped } = trimConversationToBudget(messages, 100);
  const contents = out.map((message) => message.content);
  assert.ok(contents.includes("first small turn"), "older small message survives");
  assert.ok(contents.includes("latest small turn"), "newest message survives");
  assert.equal(out.length, 2);
  assert.equal(dropped, 1);
});

test("trimConversationToBudget: drops leading assistant turns when a user turn fits", () => {
  const messages = [
    msg("user", "older question"),
    msg("assistant", "older answer"),
    msg("assistant", "newest assistant")
  ];
  const { messages: out } = trimConversationToBudget(messages, 10);
  assert.ok(out.length >= 1);
  assert.equal(out[out.length - 1].content, "newest assistant");

  const userFirst = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")];
  const trimmed = trimConversationToBudget(userFirst, 5);
  assert.equal(trimmed.messages[0].role, "user");
  assert.equal(trimmed.messages[trimmed.messages.length - 1].content, "c");
});

test("trimConversationToBudget: includes system prompt tokens in the budget", () => {
  const messages = [msg("system", "s".repeat(4_000)), msg("user", "recent")];
  const { messages: out } = trimConversationToBudget(messages, 1_000, 1_000);
  assert.deepEqual(out.map((message) => message.content), ["recent"]);
});

test("trimConversationToBudget: zero budget keeps the original list untouched", () => {
  const messages = [msg("user", "a"), msg("assistant", "b")];
  const { messages: out, dropped } = trimConversationToBudget(messages, 0);
  assert.deepEqual(out, messages);
  assert.equal(dropped, 0);
});

test("formatTokenCount: compact display", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(999), "999");
  assert.equal(formatTokenCount(1_000), "1k");
  assert.equal(formatTokenCount(12_345), "12.3k");
  assert.equal(formatTokenCount(123_456), "123k");
});
