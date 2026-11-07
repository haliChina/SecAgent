import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_RESULT_BYTE_BUDGET, TOOL_RESULT_TRUNCATED_PREFIX, summarizeToolResult, toolResultParts, toolResultText } from "./tool-content.js";

test("normalizes an MCP image content block without losing the image", () => {
  const parts = toolResultParts([
    { type: "text", text: "截图" },
    { type: "image", data: "AQI=", mimeType: "image/png" }
  ]);
  assert.equal(parts.text, "截图");
  assert.equal(parts.images[0]?.mimeType, "image/png");
  assert.equal(toolResultText(parts), "截图");
});

test("oversized tool text is clipped with an explicit truncation notice", () => {
  const raw = "a".repeat(TOOL_RESULT_BYTE_BUDGET + 256);
  const text = toolResultText({ text: raw, images: [] });
  assert.ok(text.startsWith("a".repeat(TOOL_RESULT_BYTE_BUDGET)));
  assert.ok(text.includes(TOOL_RESULT_TRUNCATED_PREFIX));
  assert.ok(text.includes("不是完整结果"));
  assert.ok(!text.startsWith(raw));
});

test("multi-byte text is clipped on a character boundary and small results stay intact", () => {
  const clipped = toolResultText({ text: "中文结果", images: [] }, 4);
  assert.ok(clipped.startsWith("中"));
  assert.ok(clipped.includes(TOOL_RESULT_TRUNCATED_PREFIX));
  assert.equal(toolResultText({ text: "简短结果", images: [] }), "简短结果");
});

test("summarizes image results without persisting base64 data", () => {
  const summary = summarizeToolResult({ type: "image", data: "AQI=", mimeType: "image/png", name: "screen.png" }) as { images: Array<{ name?: string; bytes?: number; data?: string }> };
  assert.equal(summary.images[0]?.name, "screen.png");
  assert.equal(summary.images[0]?.bytes, 2);
  assert.equal(summary.images[0]?.data, undefined);
});
