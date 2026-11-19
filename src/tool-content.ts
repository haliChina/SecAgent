export interface ToolImageContent {
  type: "image";
  data: string;
  mimeType: string;
  name?: string;
  path?: string;
}

export interface ToolResultParts {
  text: string;
  images: ToolImageContent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function imageFromBlock(value: unknown): ToolImageContent | undefined {
  if (!isRecord(value) || value.type !== "image" || typeof value.data !== "string" || typeof value.mimeType !== "string" || !value.mimeType.startsWith("image/")) return undefined;
  const dataUrl = value.data.match(/^data:[^;,]+;base64,(.*)$/s);
  return { type: "image", data: dataUrl?.[1] || value.data, mimeType: value.mimeType, ...(typeof value.name === "string" ? { name: value.name } : {}), ...(typeof value.path === "string" ? { path: value.path } : {}) };
}

function textFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Converts MCP/local tool results into provider-neutral text and image parts. */
export function toolResultParts(value: unknown): ToolResultParts {
  const image = imageFromBlock(value);
  if (image) return { text: "", images: [image] };
  if (Array.isArray(value) && value.every((item) => isRecord(item) && (item.type === "text" || item.type === "image" || item.type === "resource"))) {
    const parts = value.map(toolResultParts);
    return { text: parts.map((item) => item.text).filter(Boolean).join("\n"), images: parts.flatMap((item) => item.images) };
  }
  if (isRecord(value) && Array.isArray(value.content)) {
    const parts = toolResultParts(value.content);
    if (value.structuredContent !== undefined) parts.text = [parts.text, textFromValue(value.structuredContent)].filter(Boolean).join("\n");
    return parts;
  }
  if (isRecord(value) && value.type === "text" && typeof value.text === "string") return { text: value.text, images: [] };
  if (isRecord(value) && value.type === "resource" && isRecord(value.resource)) {
    const resource = value.resource;
    if (typeof resource.blob === "string" && typeof resource.mimeType === "string" && resource.mimeType.startsWith("image/")) return { text: "", images: [{ type: "image", data: resource.blob, mimeType: resource.mimeType }] };
  }
  return { text: textFromValue(value), images: [] };
}

/** UTF-8 byte budget for one tool result rendered into the model prompt. */
export const TOOL_RESULT_BYTE_BUDGET = 32 * 1024;
/** Stable prefix of the truncation notice so callers can detect a clipped result. */
export const TOOL_RESULT_TRUNCATED_PREFIX = "[结果已截断";

function utf8Bytes(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
}

/** Byte-accurate clip that never splits a surrogate pair or a CJK character. */
function clipToBytes(text: string, maxBytes: number): { text: string; bytes: number; truncated: boolean } {
  if (maxBytes <= 0) return { text: "", bytes: 0, truncated: text.length > 0 };
  let used = 0;
  let end = 0;
  for (const char of text) {
    const cost = utf8Bytes(char);
    if (used + cost > maxBytes) return { text: text.slice(0, end), bytes: used, truncated: true };
    used += cost;
    end += char.length;
  }
  return { text, bytes: used, truncated: false };
}

function utf8ByteLength(text: string): number {
  let total = 0;
  for (const char of text) total += utf8Bytes(char);
  return total;
}

/**
 * Text the model sees for a tool result, capped at `maxBytes` UTF-8 bytes.
 * Oversized output is clipped with an explicit notice instead of silently
 * pretending the result is complete — the model can narrow the query or page.
 */
export function toolResultText(parts: ToolResultParts, maxBytes = TOOL_RESULT_BYTE_BUDGET): string {
  const raw = parts.text || (parts.images.length ? `已返回 ${parts.images.length} 张图片供模型查看。` : "工具未返回内容。");
  const total = utf8ByteLength(raw);
  const clipped = clipToBytes(raw, maxBytes);
  if (!clipped.truncated) return raw;
  return `${clipped.text}\n\n${TOOL_RESULT_TRUNCATED_PREFIX}：原始 ${total} 字节，仅显示前 ${clipped.bytes} 字节（单次上限 ${maxBytes} 字节）。这不是完整结果，请缩小查询范围、分页读取或改写参数后重试。]`;
}

/** Keep binary image data out of audit logs and renderer trace events. */
export function summarizeToolResult(value: unknown): unknown {
  const parts = toolResultParts(value);
  if (!parts.images.length) return value;
  return { ...(parts.text ? { text: parts.text } : {}), images: parts.images.map((image) => ({ type: image.type, name: image.name, path: image.path, mimeType: image.mimeType, bytes: Math.floor(image.data.length * 3 / 4) - (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0) })) };
}
