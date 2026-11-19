import { test } from "node:test";
import assert from "node:assert/strict";
import { closeUnbalancedMarkdown } from "./streaming-markdown.js";

test("粗体/斜体未闭合补全", () => {
  assert.equal(closeUnbalancedMarkdown("这是**加粗中"), "这是**加粗中**");
  assert.equal(closeUnbalancedMarkdown("这是*斜体中"), "这是*斜体中*");
  assert.equal(closeUnbalancedMarkdown("__粗__体中"), "__粗__体中"); /* 已闭合不动 */
});

test("行内代码优先：反引号未闭合只补反引号", () => {
  assert.equal(closeUnbalancedMarkdown("代码 `const x 中"), "代码 `const x 中`");
  /* 反引号未闭合时内部的 * 不被补全（可能是即将出现的代码内容）。 */
  assert.equal(closeUnbalancedMarkdown("看 `a*b"), "看 `a*b`");
});

test("代码段外的标记正常补全", () => {
  assert.equal(closeUnbalancedMarkdown("`code` 然后**粗"), "`code` 然后**粗**");
});

test("未闭合链接截断到语法前", () => {
  assert.equal(closeUnbalancedMarkdown("见 [文档](https://exam"), "见 [文档]");
  assert.equal(closeUnbalancedMarkdown("完整 [链接](https://a.com) 后**粗"), "完整 [链接](https://a.com) 后**粗**");
});

test("围栏代码块未闭合补闭合行", () => {
  assert.equal(closeUnbalancedMarkdown("```js\nconsole.log(1)"), "```js\nconsole.log(1)\n```");
  /* 闭合的围栏不动。 */
  assert.equal(closeUnbalancedMarkdown("```\ncode\n```"), "```\ncode\n```");
});

test("转义星号不计入（\\* 不是标记）", () => {
  assert.equal(closeUnbalancedMarkdown("转义\\*星号 然后**粗"), "转义\\*星号 然后**粗**");
});

test("完整文本零改动", () => {
  const done = "完整 **粗体** 与 `代码` 和 [链接](https://a.com) 一切正常。";
  assert.equal(closeUnbalancedMarkdown(done), done);
});
