import test from "node:test";
import assert from "node:assert/strict";
import { filterActiveSessions, reusableEmptySession } from "./session-navigation.js";

const meta = (id: string, title: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({ id, title, createdAt: "2026-01-01", updatedAt: "2026-01-02", ...extra });
const sessions = [meta("a", "课堂计划", { preview: "周五的阅读课" }), meta("b", "React 笔记", { preview: "键盘焦点" }), meta("c", "新会话", { archived: true }), meta("d", "新会话")];

test("会话筛选：空查询只显示未归档，保留原排序", () => {
  assert.deepEqual(filterActiveSessions(sessions, "  ").map((item) => item.id), ["a", "b", "d"]);
});
test("会话筛选：匹配标题和消息摘要，忽略大小写", () => {
  assert.deepEqual(filterActiveSessions(sessions, " REACT ").map((item) => item.id), ["b"]);
  assert.deepEqual(filterActiveSessions(sessions, "阅读").map((item) => item.id), ["a"]);
});
test("会话筛选：多个词必须全部匹配，归档不参与结果", () => {
  assert.deepEqual(filterActiveSessions(sessions, "react 焦点").map((item) => item.id), ["b"]);
  assert.deepEqual(filterActiveSessions(sessions, "react 阅读"), []);
  assert.deepEqual(filterActiveSessions(sessions, "新会话").map((item) => item.id), ["d"]);
});
test("会话筛选：符号按字面查询，不改变输入数据", () => {
  const original = structuredClone(sessions);
  assert.deepEqual(filterActiveSessions(sessions, "["), []);
  assert.deepEqual(sessions, original);
});
test("新建会话不复用已归档的空会话", () => {
  assert.equal(reusableEmptySession(sessions)?.id, "d");
  assert.equal(reusableEmptySession(sessions.filter((item) => item.id !== "d")), undefined);
});
test("新建会话不复用有内容或已重命名的会话", () => {
  assert.equal(reusableEmptySession([meta("a", "新会话", { preview: "已有内容" }), meta("b", "备忘录")]), undefined);
  assert.equal(reusableEmptySession([]), undefined);
});
