/**
 * Context budget: CJK-aware token estimation and an opt-in sliding window for
 * the conversation history sent to the model.
 *
 * Adapted from the token-estimation / context-budget approach in AIStudio
 * (https://github.com/SRInternet-Studio/AIStudio, Apache-2.0, © 2026
 * SRInternet-Studio). The calibration matters because a flat "3 chars/token"
 * estimate under-counts Chinese history by ~2.5x, so long sessions overflow a
 * configured window before the local budget ever trims them.
 *
 * Defaults are deliberately inert: `contextTokens = 0` keeps the previous
 * behaviour (send the whole 20-message window) and only a configured budget
 * enables trimming.
 */

const CHARS_PER_TOKEN_LATIN = 4;
/** Measured Gemini-class density is ~1.39 CJK chars/token → 0.72 tokens/char;
 *  0.75 adds a small safety margin so trimming still lands inside the window. */
const TOKENS_PER_CHAR_CJK = 0.75;

const CJK_CHAR_REGEX = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F\u3040-\u30FF]/g;

/** Media payloads are base64, not text — counting them would invent millions of
 *  fake tokens. Their real cost is only known to the provider. */
const DATA_URL_REGEX = /data:[^;,]*;base64,[A-Za-z0-9+/=]+/g;

const OUTPUT_RESERVE_RATIO = 0.125;
const OUTPUT_RESERVE_MIN_TOKENS = 1024;

/** Shared with `conversationInput` so the UI estimate matches what is sent. */
export const HISTORY_MESSAGE_WINDOW = 20;

export interface ContextMessage {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: Array<{ dataUrl?: string }>;
  toolCalls?: Array<{ name?: string; arguments?: unknown; result?: unknown }>;
}

/** Rough, CJK-aware token count (never zero for non-empty text). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkCount = (text.match(CJK_CHAR_REGEX) || []).length;
  const latinChars = text.length - cjkCount;
  return Math.ceil(cjkCount * TOKENS_PER_CHAR_CJK + latinChars / CHARS_PER_TOKEN_LATIN);
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? ""; } catch { return ""; }
}

function textOf(message: ContextMessage): string {
  const parts = [message.content || ""];
  for (const call of message.toolCalls || []) {
    parts.push(call.name || "", stringify(call.arguments), stringify(call.result));
  }
  return parts.join("\n").replace(DATA_URL_REGEX, "[media]");
}

/** Estimated tokens of one persisted message, including its tool arguments/results. */
export function estimateMessageTokens(message: ContextMessage): number {
  return estimateTokens(textOf(message));
}

/** Estimated tokens of the whole (already windowed) message list. */
export function estimateConversationTokens(messages: readonly ContextMessage[]): number {
  let total = 0;
  for (const message of messages) total += estimateMessageTokens(message);
  return total;
}

export interface PromptBudget {
  /** Tokens available for system prompt + conversation history. */
  promptTokens: number;
  /** Tokens reserved for the reply. */
  outputTokens: number;
}

/**
 * Split a configured context window into prompt and reply shares. Returns
 * `undefined` when no budget is configured (0 = unlimited).
 */
export function resolvePromptBudget(contextTokens: number, maxOutputTokens: number): PromptBudget | undefined {
  const window = Math.floor(Number(contextTokens) || 0);
  if (window <= 0) return undefined;
  const requested = Math.floor(Number(maxOutputTokens) || 0);
  const outputTokens = Math.min(
    Math.max(OUTPUT_RESERVE_MIN_TOKENS, requested > 0 ? requested : OUTPUT_RESERVE_MIN_TOKENS),
    Math.floor(window * OUTPUT_RESERVE_RATIO)
  );
  return { promptTokens: Math.max(0, window - Math.max(0, outputTokens)), outputTokens };
}

interface TrimResult<T> {
  messages: T[];
  /** Number of messages removed from the front/middle of the old context. */
  dropped: number;
  originalCount: number;
}

/**
 * Keep whole messages newest-first until the prompt budget is spent. Oversize
 * messages are skipped rather than treated as a hard stop, so one giant tool
 * result cannot erase every older turn; the newest message always survives.
 */
export function trimConversationToBudget<T extends ContextMessage>(
  messages: readonly T[],
  promptTokens: number,
  systemTokens = 0
): TrimResult<T> {
  const originalCount = messages.length;
  if (!originalCount || promptTokens <= 0) return { messages: [...messages], dropped: 0, originalCount };

  const selected: T[] = [];
  let remaining = Math.max(0, Math.floor(promptTokens) - Math.max(0, Math.floor(systemTokens)));

  for (let index = originalCount - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = estimateMessageTokens(message);
    if (cost <= remaining) {
      selected.unshift(message);
      remaining -= cost;
    }
  }

  const newest = messages[originalCount - 1];
  if (!selected.includes(newest)) selected.push(newest);

  // Providers reject histories that start with an assistant/tool turn. Drop
  // leading assistant messages until the first user turn (system messages stay
  // where they are; they are per-turn injections and cheap to re-send).
  while (selected.length && selected[0].role === "assistant") selected.shift();

  if (!selected.length) selected.push(newest);

  return { messages: selected, dropped: originalCount - selected.length, originalCount };
}

/** Compact display used by the composer chip ("~12.3k"). */
export function formatTokenCount(tokens: number): string {
  const value = Math.max(0, Math.floor(tokens));
  if (value < 1_000) return String(value);
  if (value < 100_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(value / 1_000)}k`;
}
