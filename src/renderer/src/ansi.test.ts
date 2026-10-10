/**
 * P3-7 不可信输出处理——回归锁测试。
 *
 * - stripAnsi：CSI/OSC/DCS/Fe 各类序列剥净、正文零误伤
 * - stripAnsiDeep：嵌套对象深清理
 * - defaultUrlTransform（显式接入 MarkdownContent）：协议白名单
 *   行为上锁——javascript:/data: 必须被丢弃，防止未来升级改行为
 */
import test from "node:test";
import assert from "node:assert/strict";
import { stripAnsi, stripAnsiDeep } from "./ansi.js";
import { defaultUrlTransform } from "react-markdown";

test("stripAnsi 剥离 SGR 颜色序列", () => {
  assert.equal(stripAnsi("\u001b[31mError:\u001b[39m boom"), "Error: boom");
  assert.equal(stripAnsi("\u001b[1;32mOK\u001b[0m"), "OK");
});

test("stripAnsi 剥离光标/擦除序列（进度条常用）", () => {
  assert.equal(stripAnsi("\u001b[2K\u001b[1Gdone"), "done");
  assert.equal(stripAnsi("\u001b[?25l\u001b[?25h"), "");
});

test("stripAnsi 剥离 OSC 标题（BEL 终止）", () => {
  assert.equal(stripAnsi("\u001b]0;my title\u0007visible"), "visible");
});

test("stripAnsi 剥离 OSC 超链接（ST 终止），链接文字保留", () => {
  assert.equal(stripAnsi("\u001b]8;;http://example.com\u001b\\link text\u001b]8;;\u001b\\"), "link text");
});

test("stripAnsi 剥离字符集选择等 Fe 转义", () => {
  assert.equal(stripAnsi("\u001b(Btext"), "text");
});

test("stripAnsi 不误伤正常文本", () => {
  assert.equal(stripAnsi("hello 世界 [not-ansi] 100%"), "hello 世界 [not-ansi] 100%");
  assert.equal(stripAnsi("价格 31m 元"), "价格 31m 元");
});

test("stripAnsiDeep 深遍历清理嵌套结构", () => {
  const input = { stdout: "\u001b[32mok\u001b[0m", nested: { err: "\u001b[1mE\u001b[m" }, list: ["\u001b[2Jx"], count: 3, empty: null };
  const cleaned = stripAnsiDeep(input);
  assert.deepEqual(cleaned, { stdout: "ok", nested: { err: "E" }, list: ["x"], count: 3, empty: null });
  // 原对象不被改写
  assert.equal(input.stdout, "\u001b[32mok\u001b[0m");
});

test("MarkdownContent URL 协议白名单：javascript:/data: 丢弃，安全协议保留", () => {
  assert.equal(defaultUrlTransform("javascript:alert(1)"), "");
  assert.equal(defaultUrlTransform("JaVaScRiPt:alert(1)"), "");
  assert.equal(defaultUrlTransform("data:text/html,<script>"), "");
  assert.equal(defaultUrlTransform("vbscript:msgbox"), "");
  assert.equal(defaultUrlTransform("https://example.com/a?b=1#c"), "https://example.com/a?b=1#c");
  assert.equal(defaultUrlTransform("http://example.com"), "http://example.com");
  assert.equal(defaultUrlTransform("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(defaultUrlTransform("#anchor"), "#anchor");
  assert.equal(defaultUrlTransform("/relative/path"), "/relative/path");
});
