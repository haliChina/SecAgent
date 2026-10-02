/**
 * Model-run budget: a hard ceiling on tool-calling turns plus image-history
 * pruning. Both exist because the tool loop is otherwise unbounded — every
 * screenshot a GUI agent takes stays in the conversation as base64 forever,
 * and a runaway loop keeps paying for it.
 *
 * Defaults keep the previous behaviour for the common case (file work needs
 * many turns) while making long multimodal runs survivable:
 *   - maxToolTurns: 0 = unlimited (unchanged default).
 *   - keepRecentImages: 2 = only the newest 2 images survive; older ones
 *     become a short text marker so the provider still sees the sequence.
 */

export interface ModelBudgetSettings {
  /** 0 disables the ceiling. */
  maxToolTurns: number;
  /** How many image payloads survive in the conversation history. */
  keepRecentImages: number;
}

export const DEFAULT_MODEL_BUDGET: ModelBudgetSettings = { maxToolTurns: 0, keepRecentImages: 2 };

export function normalizeModelBudgetSettings(raw: unknown): ModelBudgetSettings {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const turns = Number(input.maxToolTurns);
  const images = Number(input.keepRecentImages);
  return {
    maxToolTurns: Number.isFinite(turns) && turns > 0 ? Math.min(200, Math.floor(turns)) : 0,
    keepRecentImages: Number.isFinite(images) ? Math.min(24, Math.max(0, Math.floor(images))) : DEFAULT_MODEL_BUDGET.keepRecentImages
  };
}

export const IMAGE_PRUNE_NOTE = "（较早的图片已从上下文中移除）";
export const WRAP_UP_NOTICE = "工具调用轮次已达上限。不要再调用工具，直接用中文总结当前进展、已完成与未完成的部分，以及用户接下来可以做什么。";

/** Text returned when the ceiling stops the loop instead of the model. */
export function budgetStopMessage(maxToolTurns: number, lastText?: string): string {
  const tail = lastText?.trim();
  return `已停止自动调用工具：达到单轮工具调用上限（${maxToolTurns} 轮）。${tail ? `\n\n${tail}` : ""}`;
}

/** Recognises an inline image payload in any of the four provider shapes. */
function isImagePart(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const record = node as Record<string, unknown>;
  // OpenAI chat/completions: image_url is an object; Responses: image_url is a string.
  const imageUrl = record.image_url;
  if (typeof imageUrl === "string" && imageUrl.startsWith("data:image")) return true;
  if (imageUrl && typeof imageUrl === "object") {
    const url = (imageUrl as { url?: unknown }).url;
    if (typeof url === "string" && url.startsWith("data:image")) return true;
  }
  const source = record.source as { type?: unknown; data?: unknown } | undefined;
  if (source && source.type === "base64" && typeof source.data === "string") return true;
  const inline = record.inlineData as { data?: unknown } | undefined;
  if (inline && typeof inline.data === "string") return true;
  if (record.type === "image" && typeof record.data === "string") return true;
  return false;
}

/** Provider-appropriate stand-in for a dropped image block. */
function imageReplacement(node: Record<string, unknown>, note: string): Record<string, unknown> {
  const type = typeof node.type === "string" ? node.type : "";
  if (type === "input_image") return { type: "input_text", text: note };
  if (node.inlineData) return { text: note };
  return { type: "text", text: note };
}

function pruneNode(node: unknown, state: { keep: number; kept: number; dropped: number }, note: string): unknown {
  if (Array.isArray(node)) {
    // Copy-on-write: an untouched array must stay reference-identical so callers
    // (and tests) can treat "pruned === original" as "nothing to prune".
    let changed = false;
    const next = node.map((item) => {
      const pruned = pruneNode(item, state, note);
      if (pruned !== item) changed = true;
      return pruned;
    });
    return changed ? next : node;
  }
  if (!node || typeof node !== "object") return node;
  if (isImagePart(node)) {
    if (state.kept < state.keep) {
      state.kept += 1;
      return node;
    }
    state.dropped += 1;
    return imageReplacement(node as Record<string, unknown>, note);
  }
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const pruned = pruneNode(value, state, note);
    if (pruned !== value) changed = true;
    next[key] = pruned;
  }
  return changed ? next : node;
}

/**
 * Keep only the newest `keep` images in a conversation payload. Walks newest
 * first so "recent" means what the model just received.
 */
export function pruneImageHistory<T>(messages: T[], keep: number): { messages: T[]; dropped: number } {
  const limit = Number.isFinite(keep) ? Math.max(0, Math.floor(keep)) : 0;
  const state = { keep: limit, kept: 0, dropped: 0 };
  const out = new Array<T>(messages.length);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    out[index] = pruneNode(messages[index], state, IMAGE_PRUNE_NOTE) as T;
  }
  return { messages: out, dropped: state.dropped };
}