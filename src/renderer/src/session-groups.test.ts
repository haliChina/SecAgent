import test from "node:test";
import assert from "node:assert/strict";
import { formatSessionAge, groupSessionsByDate } from "./session-groups.js";
import { filterActiveSessions } from "./session-navigation.js";

const now = new Date(2026, 10, 9, 15, 30, 0); // 2026-11-09 15:30 本地时间
const meta = (id: string, updatedAt: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({ id, title: `会话 ${id}`, createdAt: updatedAt, updatedAt, ...extra });

test("会话分组：今天 / 昨天 / 近 7 天 / 更早，空组不输出", () => {
  const sessions = [
    meta("t1", new Date(2026, 10, 9, 14, 0).toISOString()),
    meta("t2", new Date(2026, 10, 9, 8, 0).toISOString()),
    meta("y1", new Date(2026, 10, 8, 23, 0).toISOString()),
    meta("w1", new Date(2026, 10, 5, 9, 0).toISOString()),
    meta("e1", new Date(2026, 9, 1, 9, 0).toISOString())
  ];
  const groups = groupSessionsByDate(sessions, now);
  assert.deepEqual(groups.map((group) => [group.key, group.items.map((item) => item.id)]), [
    ["today", ["t1", "t2"]],
    ["yesterday", ["y1"]],
    ["week", ["w1"]],
    ["earlier", ["e1"]]
  ]);
});

test("会话分组：无效日期归入更早，不抛错", () => {
  const groups = groupSessionsByDate([meta("bad", "not-a-date"), meta("t", now.toISOString())], now);
  assert.deepEqual(groups.map((group) => group.key), ["today", "earlier"]);
  assert.equal(groups[1]?.items[0]?.id, "bad");
});

test("相对时间：刚刚 / 分钟 / 今天时刻 / 昨天 / N 天前 / 日期", () => {
  assert.equal(formatSessionAge(new Date(2026, 10, 9, 15, 29, 20).toISOString(), now), "刚刚");
  assert.equal(formatSessionAge(new Date(2026, 10, 9, 15, 5, 0).toISOString(), now), "25 分钟前");
  assert.equal(formatSessionAge(new Date(2026, 10, 9, 11, 0, 0).toISOString(), now), "4 小时前");
  assert.equal(formatSessionAge(new Date(2026, 10, 9, 9, 5, 0).toISOString(), now), "09:05");
  assert.equal(formatSessionAge(new Date(2026, 10, 8, 20, 0, 0).toISOString(), now), "昨天");
  assert.equal(formatSessionAge(new Date(2026, 10, 6, 20, 0, 0).toISOString(), now), "3 天前");
  assert.equal(formatSessionAge(new Date(2026, 8, 1, 20, 0, 0).toISOString(), now), "9/1");
  assert.equal(formatSessionAge(new Date(2025, 8, 1, 20, 0, 0).toISOString(), now), "2025/9/1");
});

test("会话搜索：拼音全拼与首字母都能命中中文标题", () => {
  const sessions = [meta("a", now.toISOString(), { title: "课堂计划", preview: "周五阅读课" }), meta("b", now.toISOString(), { title: "React 笔记" })];
  assert.deepEqual(filterActiveSessions(sessions, "ketang").map((item) => item.id), ["a"]);
  assert.deepEqual(filterActiveSessions(sessions, "kt").map((item) => item.id), ["a"]);
  assert.deepEqual(filterActiveSessions(sessions, "ktjh").map((item) => item.id), ["a"]);
  assert.deepEqual(filterActiveSessions(sessions, "yuedu").map((item) => item.id), ["a"]);
  assert.deepEqual(filterActiveSessions(sessions, "react").map((item) => item.id), ["b"]);
  assert.deepEqual(filterActiveSessions(sessions, "zzz"), []);
});
