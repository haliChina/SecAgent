/**
 * P3-6 交付物卡片——纯逻辑回归锁。
 *
 * 核心原则：路径只来自记录（result.path），不从 prose 解析；
 * 只统计 write/edit 且 result 为成功形态（含 path 的对象）的调用。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { collectFileChanges, splitPath } from "./deliverable.js";

test("write 记录：行数按 content 计 +，无 -", () => {
  const changes = collectFileChanges([
    { name: "write", arguments: { path: "a.txt", content: "line1\nline2\nline3" }, result: { path: "/w/a.txt", bytes: 24 } }
  ]);
  assert.deepEqual(changes, [{ path: "/w/a.txt", writes: 1, edits: 0, additions: 3, deletions: 0 }]);
});

test("edit 记录：newText 计 +，oldText 计 -", () => {
  const changes = collectFileChanges([
    { name: "edit", arguments: { path: "b.ts", oldText: "a\nb", newText: "x\ny\nz" }, result: { path: "/w/b.ts", replaced: 1 } }
  ]);
  assert.deepEqual(changes, [{ path: "/w/b.ts", writes: 0, edits: 1, additions: 3, deletions: 2 }]);
});

test("同路径多次改动聚合，保持首现顺序", () => {
  const changes = collectFileChanges([
    { name: "write", arguments: { path: "x.md", content: "one" }, result: { path: "/w/x.md", bytes: 3 } },
    { name: "write", arguments: { path: "y.md", content: "two" }, result: { path: "/w/y.md", bytes: 3 } },
    { name: "edit", arguments: { path: "x.md", oldText: "one", newText: "1\n2" }, result: { path: "/w/x.md", replaced: 1 } }
  ]);
  assert.deepEqual(changes.map((c) => c.path), ["/w/x.md", "/w/y.md"]);
  assert.deepEqual(changes[0], { path: "/w/x.md", writes: 1, edits: 1, additions: 3, deletions: 1 });
  assert.deepEqual(changes[1], { path: "/w/y.md", writes: 1, edits: 0, additions: 1, deletions: 0 });
});

test("失败或未返回的调用不计入（result 缺 path / 无 result）", () => {
  assert.deepEqual(collectFileChanges([
    { name: "write", arguments: { path: "z.txt", content: "x" }, result: { error: "boom" } },
    { name: "write", arguments: { path: "z.txt", content: "x" } },
    { name: "edit", arguments: { path: "z.txt", oldText: "a", newText: "b" }, result: { path: "" } }
  ]), []);
});

test("非文件工具（bash/look_at/MCP）不计入", () => {
  assert.deepEqual(collectFileChanges([
    { name: "bash", arguments: { command: "echo hi" }, result: { cwd: "/w", stdout: "hi", stderr: "" } },
    { name: "mcp.tools__run", arguments: {}, result: { path: "/w/fake.txt" } }
  ]), []);
});

test("CRLF 与多行计数；空 content 计 0 行", () => {
  const changes = collectFileChanges([
    { name: "write", arguments: { path: "c.log", content: "a\r\nb\nc" }, result: { path: "/w/c.log", bytes: 7 } },
    { name: "write", arguments: { path: "d.log", content: "" }, result: { path: "/w/d.log", bytes: 0 } }
  ]);
  assert.equal(changes[0].additions, 3);
  assert.equal(changes[1].additions, 0);
});

test("splitPath：unix / windows / 根 / 无目录", () => {
  assert.deepEqual(splitPath("/home/z/a.txt"), { name: "a.txt", dir: "/home/z" });
  assert.deepEqual(splitPath("C:\\Users\\z\\a.txt"), { name: "a.txt", dir: "C:/Users/z" });
  assert.deepEqual(splitPath("/a.txt"), { name: "a.txt", dir: "/" });
  assert.deepEqual(splitPath("README.md"), { name: "README.md", dir: null });
});
