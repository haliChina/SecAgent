import assert from "node:assert/strict";
import test from "node:test";
import { markdownToPlainText, splitForSpeech, TTS_CHUNK_MAX } from "./tts-text.js";

test("markdownToPlainText: keeps symbols that are part of the prose", () => {
  const plain = markdownToPlainText("用 GPT-4 计算 3-2=1，变量名 my_var 不要改。");
  assert.ok(plain.includes("GPT-4"), plain);
  assert.ok(plain.includes("3-2=1"), plain);
  assert.ok(plain.includes("my_var"), plain);
});

test("markdownToPlainText: strips headings, list markers, bold and links", () => {
  const plain = markdownToPlainText("# 标题\n- **重点**\n见 [文档](https://example.com/a)。");
  assert.ok(!plain.includes("#"), plain);
  assert.ok(!plain.includes("**"), plain);
  assert.ok(!plain.includes("-"), plain);
  assert.ok(plain.includes("重点"), plain);
  assert.ok(plain.includes("文档"), plain);
  assert.ok(!plain.includes("https://"), plain);
});

test("markdownToPlainText: drops code fences by default and reads them when asked", () => {
  const markdown = "前文\n```ts\nconst answer = 42;\n```\n后文";
  const skipped = markdownToPlainText(markdown);
  assert.ok(!skipped.includes("const answer"), skipped);
  assert.ok(skipped.includes("前文") && skipped.includes("后文"), skipped);
  const read = markdownToPlainText(markdown, { readCodeBlocks: true });
  assert.ok(read.includes("const answer = 42;"), read);
});

test("markdownToPlainText: removes structured blocks, formulas and citations", () => {
  const markdown = "<workspace-files>{\"files\":[\"a.png\"]}</workspace-files>\n公式 $$E=mc^2$$ 与 $x^2$ 如上。[1]";
  const plain = markdownToPlainText(markdown);
  assert.ok(!plain.includes("workspace-files"), plain);
  assert.ok(!plain.includes("a.png"), plain);
  assert.ok(!plain.includes("E=mc"), plain);
  assert.ok(!plain.includes("[1]"), plain);
  assert.ok(plain.includes("公式"), plain);
});

test("markdownToPlainText: turns table rows into readable sentences", () => {
  const markdown = "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |";
  const plain = markdownToPlainText(markdown);
  assert.ok(plain.includes("名称，数量"), plain);
  assert.ok(plain.includes("苹果，3"), plain);
  assert.ok(!plain.includes("---"), plain);
});

test("splitForSpeech: splits on sentence punctuation and keeps order", () => {
  const chunks = splitForSpeech("第一句话。第二句话！还有第三句？");
  assert.deepEqual(chunks, ["第一句话。", "第二句话！", "还有第三句？"]);
});

test("splitForSpeech: empty input yields no chunks", () => {
  assert.deepEqual(splitForSpeech("   \n  "), []);
});

test("splitForSpeech: long sentences are broken below the limit at soft boundaries", () => {
  const long = `${"甲".repeat(600)}，${"乙".repeat(600)}，${"丙".repeat(600)}。`;
  const chunks = splitForSpeech(long);
  assert.ok(chunks.length > 1, `expected multiple chunks, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= TTS_CHUNK_MAX, `chunk of ${chunk.length} exceeds limit`);
    assert.ok(chunk.length > 0);
  }
  assert.equal(chunks.join("").replace(/\s+/g, ""), long.replace(/\s+/g, ""));
});

test("splitForSpeech: hard-cuts a single unbroken run of characters", () => {
  const run = "字".repeat(TTS_CHUNK_MAX * 2 + 10);
  const chunks = splitForSpeech(run);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join(""), run);
  assert.ok(chunks.every((chunk) => chunk.length <= TTS_CHUNK_MAX));
});
