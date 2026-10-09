// src/tool-content.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/tool-content.ts
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function imageFromBlock(value) {
  if (!isRecord(value) || value.type !== "image" || typeof value.data !== "string" || typeof value.mimeType !== "string" || !value.mimeType.startsWith("image/")) return void 0;
  const dataUrl = value.data.match(/^data:[^;,]+;base64,(.*)$/s);
  return { type: "image", data: dataUrl?.[1] || value.data, mimeType: value.mimeType, ...typeof value.name === "string" ? { name: value.name } : {}, ...typeof value.path === "string" ? { path: value.path } : {} };
}
function textFromValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function toolResultParts(value) {
  const image = imageFromBlock(value);
  if (image) return { text: "", images: [image] };
  if (Array.isArray(value) && value.every((item) => isRecord(item) && (item.type === "text" || item.type === "image" || item.type === "resource"))) {
    const parts = value.map(toolResultParts);
    return { text: parts.map((item) => item.text).filter(Boolean).join("\n"), images: parts.flatMap((item) => item.images) };
  }
  if (isRecord(value) && Array.isArray(value.content)) {
    const parts = toolResultParts(value.content);
    if (value.structuredContent !== void 0) parts.text = [parts.text, textFromValue(value.structuredContent)].filter(Boolean).join("\n");
    return parts;
  }
  if (isRecord(value) && value.type === "text" && typeof value.text === "string") return { text: value.text, images: [] };
  if (isRecord(value) && value.type === "resource" && isRecord(value.resource)) {
    const resource = value.resource;
    if (typeof resource.blob === "string" && typeof resource.mimeType === "string" && resource.mimeType.startsWith("image/")) return { text: "", images: [{ type: "image", data: resource.blob, mimeType: resource.mimeType }] };
  }
  return { text: textFromValue(value), images: [] };
}
function toolResultText(parts) {
  if (parts.text) return parts.text;
  if (parts.images.length) return `\u5DF2\u8FD4\u56DE ${parts.images.length} \u5F20\u56FE\u7247\u4F9B\u6A21\u578B\u67E5\u770B\u3002`;
  return "\u5DE5\u5177\u672A\u8FD4\u56DE\u5185\u5BB9\u3002";
}
function summarizeToolResult(value) {
  const parts = toolResultParts(value);
  if (!parts.images.length) return value;
  return { ...parts.text ? { text: parts.text } : {}, images: parts.images.map((image) => ({ type: image.type, name: image.name, path: image.path, mimeType: image.mimeType, bytes: Math.floor(image.data.length * 3 / 4) - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0) })) };
}

// src/tool-content.test.ts
test("normalizes an MCP image content block without losing the image", () => {
  const parts = toolResultParts([
    { type: "text", text: "\u622A\u56FE" },
    { type: "image", data: "AQI=", mimeType: "image/png" }
  ]);
  assert.equal(parts.text, "\u622A\u56FE");
  assert.equal(parts.images[0]?.mimeType, "image/png");
  assert.equal(toolResultText(parts), "\u622A\u56FE");
});
test("summarizes image results without persisting base64 data", () => {
  const summary = summarizeToolResult({ type: "image", data: "AQI=", mimeType: "image/png", name: "screen.png" });
  assert.equal(summary.images[0]?.name, "screen.png");
  assert.equal(summary.images[0]?.bytes, 2);
  assert.equal(summary.images[0]?.data, void 0);
});
