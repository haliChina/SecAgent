// src/quoted-message.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/quoted-message.ts
var QUOTE_MARKER = "\u5F15\u7528\u5185\u5BB9\uFF1A\n";
function buildQuotedUserMessage(quote, body) {
  const quoted = quote.trim();
  const text = body.replace(/\u200b/g, "").trim();
  if (!quoted) return text;
  return text ? `${QUOTE_MARKER}${quoted}

${text}` : `${QUOTE_MARKER}${quoted}`;
}
function parseQuotedUserMessage(content) {
  if (!content.startsWith(QUOTE_MARKER)) return { body: content };
  const rest = content.slice(QUOTE_MARKER.length);
  const split = rest.indexOf("\n\n");
  if (split < 0) return { quote: rest, body: "" };
  return { quote: rest.slice(0, split), body: rest.slice(split + 2) };
}
function webSearchUrl(query) {
  return `https://cn.bing.com/search?q=${encodeURIComponent(query.trim())}`;
}

// src/quoted-message.test.ts
test("builds a quoted user message with the selection at the start", () => {
  const text = buildQuotedUserMessage("\u7B2C\u4E09\u8282\u662F\u7269\u7406", "\u6539\u6210\u82F1\u8BED");
  assert.equal(text.startsWith("\u5F15\u7528\u5185\u5BB9\uFF1A\n\u7B2C\u4E09\u8282\u662F\u7269\u7406\n\n"), true);
  assert.equal(text.endsWith("\u6539\u6210\u82F1\u8BED"), true);
});
test("round-trips quoted messages", () => {
  const original = buildQuotedUserMessage("\u9009\u4E2D\u7684\u53E5\u5B50\n\u7B2C\u4E8C\u884C", "\u8BF7\u89E3\u91CA");
  assert.deepEqual(parseQuotedUserMessage(original), { quote: "\u9009\u4E2D\u7684\u53E5\u5B50\n\u7B2C\u4E8C\u884C", body: "\u8BF7\u89E3\u91CA" });
});
test("leaves unquoted messages unchanged", () => {
  assert.deepEqual(parseQuotedUserMessage("\u666E\u901A\u63D0\u95EE"), { body: "\u666E\u901A\u63D0\u95EE" });
});
test("builds a Bing search URL", () => {
  assert.equal(webSearchUrl("\u725B\u987F\u7B2C\u4E00\u5B9A\u5F8B"), "https://cn.bing.com/search?q=%E7%89%9B%E9%A1%BF%E7%AC%AC%E4%B8%80%E5%AE%9A%E5%BE%8B");
});
