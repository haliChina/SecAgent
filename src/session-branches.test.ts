import { test } from "node:test";
import assert from "node:assert/strict";
import { isMessageVisible, messageVersions, variantGroupId, variantSelection, type BranchMessage } from "./session-branches.js";

function msg(id: string, role: "user" | "assistant" = "assistant", extra: Partial<BranchMessage> = {}): BranchMessage {
  return { id, role, content: `内容 ${id}`, createdAt: "2026-11-14T10:00:00.000Z", ...extra };
}

test("variantGroupId：assistant 自身或 variantOf；user 不成组", () => {
  assert.equal(variantGroupId(msg("a1")), "a1");
  assert.equal(variantGroupId(msg("v1", "assistant", { variantOf: "a1" })), "a1");
  assert.equal(variantGroupId(msg("u1", "user")), null);
});

test("可见性：默认原始显示、变体隐藏；selectedVariant 决定当前版本", () => {
  const messages = [msg("u1", "user"), msg("a1"), msg("v1", "assistant", { variantOf: "a1" }), msg("v2", "assistant", { variantOf: "a1" })];
  const byId = new Map(messages.map((m) => [m.id, m]));
  // 默认：原始显示，变体全藏
  assert.equal(isMessageVisible(messages[1], byId), true);
  assert.equal(isMessageVisible(messages[2], byId), false);
  assert.equal(isMessageVisible(messages[3], byId), false);
  // 原始 selectedVariant=v2：原始藏、v2 显、v1 仍藏
  messages[1].selectedVariant = "v2";
  const byId2 = new Map(messages.map((m) => [m.id, m]));
  assert.equal(isMessageVisible(messages[1], byId2), false);
  assert.equal(isMessageVisible(messages[2], byId2), false);
  assert.equal(isMessageVisible(messages[3], byId2), true);
  // 切回原始
  messages[1].selectedVariant = "a1";
  assert.equal(isMessageVisible(messages[1], byId2), true);
  assert.equal(isMessageVisible(messages[2], byId2), false);
  assert.equal(isMessageVisible(messages[3], byId2), false);
});

test("可见性：原始消息丢失时变体保底显示（不静默丢内容）", () => {
  const messages = [msg("u1", "user"), msg("v1", "assistant", { variantOf: "a1" })];
  const byId = new Map(messages.map((m) => [m.id, m]));
  assert.equal(isMessageVisible(messages[1], byId), true, "孤儿变体应显示");
});

test("版本清单：时间序 + 当前选中下标", () => {
  const messages = [msg("u1", "user"), msg("a1"), msg("v1", "assistant", { variantOf: "a1" }), msg("v2", "assistant", { variantOf: "a1" })];
  /* 组当前显示 a1（无 selectedVariant）——无论问谁，下标都指向组当前态。 */
  let versions = messageVersions(messages, "v1");
  assert.deepEqual(versions, { ids: ["a1", "v1", "v2"], index: 0 });
  versions = messageVersions(messages, "a1");
  assert.deepEqual(versions, { ids: ["a1", "v1", "v2"], index: 0 });
  // 选中 v2 时问 a1 → 下标 2
  messages[1].selectedVariant = "v2";
  versions = messageVersions(messages, "a1");
  assert.deepEqual(versions, { ids: ["a1", "v1", "v2"], index: 2 });
});

test("单版本消息：versions 为单元素，switch 返回自选形状", () => {
  const messages = [msg("u1", "user"), msg("a1")];
  assert.deepEqual(messageVersions(messages, "a1"), { ids: ["a1"], index: 0 });
  // 选回原始自身 → selectedVariant 清空
  const sel = variantSelection("a1", "a1");
  assert.deepEqual(sel, { messageId: "a1", selectedVariant: undefined });
  // 选变体
  assert.deepEqual(variantSelection("a1", "v3"), { messageId: "a1", selectedVariant: "v3" });
});

test("user 消息不参与版本组（versions null）", () => {
  const messages = [msg("u1", "user")];
  assert.equal(messageVersions(messages, "u1"), null);
});
