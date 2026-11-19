import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { callPiTool, shortRevision, piTools } from "./pi-tools.js";

const mkdtemp = async () => fs.mkdtemp(path.join(os.tmpdir(), "pi-tools-"));

test("read 返回带行号前缀的正文与 revision", async () => {
  const dir = await mkdtemp();
  await fs.writeFile(path.join(dir, "a.ts"), "first\nsecond\nthird\n", "utf8");
  const result = (await callPiTool(dir, "read", { path: "a.ts" })) as Record<string, unknown>;
  assert.equal(result.content, "1|first\n2|second\n3|third\n4|"); /* 末尾换行产生空尾行，与 totalLines 计数一致 */
  assert.equal(result.totalLines, 4);
  assert.equal(result.revision, shortRevision("first\nsecond\nthird\n"));
  assert.equal(typeof result.revision, "string");
  assert.equal(result.revision.length, 16);
});

test("read 分页行号跟随 offset 续增", async () => {
  const dir = await mkdtemp();
  await fs.writeFile(path.join(dir, "b.txt"), Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n"), "utf8");
  const page1 = (await callPiTool(dir, "read", { path: "b.txt", limit: 4 })) as Record<string, unknown>;
  assert.equal(page1.content, "1|line1\n2|line2\n3|line3\n4|line4");
  assert.equal(page1.truncated, true);
  assert.equal(page1.nextOffset, 5);
  const page2 = (await callPiTool(dir, "read", { path: "b.txt", offset: 5, limit: 4 })) as Record<string, unknown>;
  assert.equal(page2.content, "5|line5\n6|line6\n7|line7\n8|line8");
  /* revision 是整文件内容散列，与分页无关 */
  assert.equal(page1.revision, page2.revision);
});

test("edit 传 revision 校验：内容未变可编辑并返回新 revision", async () => {
  const dir = await mkdtemp();
  const file = path.join(dir, "c.txt");
  await fs.writeFile(file, "alpha\nbeta\n", "utf8");
  const read = (await callPiTool(dir, "read", { path: "c.txt" })) as Record<string, unknown>;
  const edited = (await callPiTool(dir, "edit", { path: "c.txt", oldText: "beta", newText: "gamma", revision: read.revision })) as Record<string, unknown>;
  assert.equal(edited.replaced, 1);
  assert.equal(edited.revision, shortRevision("alpha\ngamma\n"));
  assert.equal(await fs.readFile(file, "utf8"), "alpha\ngamma\n");
});

test("edit 陈旧 revision 拒绝修改", async () => {
  const dir = await mkdtemp();
  const file = path.join(dir, "d.txt");
  await fs.writeFile(file, "one\ntwo\n", "utf8");
  const stale = shortRevision("something-else\n");
  await assert.rejects(
    callPiTool(dir, "edit", { path: "d.txt", oldText: "two", newText: "TWO", revision: stale }),
    /不一致|请重新 read/,
  );
  /* 被拒后文件保持原状 */
  assert.equal(await fs.readFile(file, "utf8"), "one\ntwo\n");
});

test("read 后文件被外部改动，旧 revision edit 被拦", async () => {
  const dir = await mkdtemp();
  const file = path.join(dir, "e.txt");
  await fs.writeFile(file, "v1\n", "utf8");
  const read = (await callPiTool(dir, "read", { path: "e.txt" })) as Record<string, unknown>;
  await fs.writeFile(file, "v2-changed-by-others\n", "utf8");
  await assert.rejects(
    callPiTool(dir, "edit", { path: "e.txt", oldText: "v1", newText: "v1x", revision: read.revision }),
    /请重新 read/,
  );
});

test("edit 不传 revision 保持旧行为（向后兼容）", async () => {
  const dir = await mkdtemp();
  const file = path.join(dir, "f.txt");
  await fs.writeFile(file, "hello world\n", "utf8");
  const edited = (await callPiTool(dir, "edit", { path: "f.txt", oldText: "world", newText: "SecAgent" })) as Record<string, unknown>;
  assert.equal(edited.replaced, 1);
  assert.equal(typeof edited.revision, "string");
});

test("write 返回新内容 revision", async () => {
  const dir = await mkdtemp();
  const content = "written\nlines\n";
  const result = (await callPiTool(dir, "write", { path: "sub/g.txt", content })) as Record<string, unknown>;
  assert.equal(result.revision, shortRevision(content));
});

test("read_files 批量：一次返回全部、失败项隔离", async () => {
  const dir = await mkdtemp();
  await fs.writeFile(path.join(dir, "x.ts"), "aaa\nbbb\n", "utf8");
  await fs.writeFile(path.join(dir, "y.ts"), "ccc\nddd\n", "utf8");
  const result = (await callPiTool(dir, "read_files", { files: [
    { path: "x.ts" },
    { path: "y.ts", limit: 1 },
    { path: "missing.ts" },
  ] })) as { files: Array<Record<string, unknown>> };
  assert.equal(result.files.length, 3);
  const [x, y, missing] = result.files;
  assert.equal(x.content, "1|aaa\n2|bbb\n3|");
  assert.equal(x.revision, shortRevision("aaa\nbbb\n"));
  assert.equal(y.content, "1|ccc");
  assert.equal(y.truncated, true);
  assert.equal(y.nextOffset, 2);
  assert.ok(String(missing.error).length > 0);
  /* 失败不影响其他文件的成功结果 */
  assert.equal(x.error, undefined);
});

test("read_files 上限与空参校验", async () => {
  const dir = await mkdtemp();
  await assert.rejects(callPiTool(dir, "read_files", { files: [] }), /非空/);
  await assert.rejects(callPiTool(dir, "read_files", { files: Array.from({ length: 11 }, () => ({ path: "a" })) }), /最多 10/);
});

test("工具表 schema：read_files 与 edit.revision 就位", () => {
  const readFiles = piTools.find((t) => t.key === "read_files");
  assert.ok(readFiles, "read_files 应在工具表");
  const edit = piTools.find((t) => t.key === "edit");
  const props = (edit?.inputSchema as { properties: Record<string, unknown> }).properties;
  assert.ok(props.revision, "edit 应声明 revision 参数");
});
