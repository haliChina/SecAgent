/**
 * 共享脱敏内核（R63）——密钥类字段的深掩码。
 *
 * 此前 SECRET_KEY_PATTERN / maskSecretsDeep 在 session-store.ts（主进程落盘）
 * 与 TracePanel.tsx（渲染层显示）各有一份，两份会漂移；且旧实现无环引用
 * 防护（工具结果含循环引用会在主进程 appendRuntimeEvent 热路径上栈溢出
 * 崩溃）、无深递归上限（构造的深层嵌套可打爆栈）。本模块统一为单一事实源：
 *  - WeakSet 环引用剪枝；
 *  - 深度上限 REDACT_MAX_DEPTH（超出截断为占位符，防栈溢出/解析炸弹）；
 *  - key 归一化（零宽字符/软连字符/空白/点号/间隔号绕过——api\u200bkey 之流）。
 * 本文件不得引入 node:fs 等主进程专属模块（渲染进程沙盒可导入）。
 */
export const SECRET_KEY_PATTERN = /api[_-]?key|password|passwd|pwd|token|secret|credential|access[_-]?key|authorization|private[_-]?key|passphrase/i;
export const MASKED_SECRET = "••••••••";
const TRUNCATED_PLACEHOLDER = "[深度截断]";

const KEY_NOISE = /[\u200b-\u200d\ufeff\xad\s.\u00b7]/g;
const REDACT_MAX_DEPTH = 64;

export function maskSecretsDeep(value: unknown, depth = 0, seen?: WeakSet<object>): unknown {
  if (depth > REDACT_MAX_DEPTH) return TRUNCATED_PLACEHOLDER;
  if (Array.isArray(value)) {
    const guard = seen ?? new WeakSet<object>();
    if (guard.has(value)) return "[循环引用]";
    guard.add(value);
    return value.map((item) => maskSecretsDeep(item, depth + 1, guard));
  }
  if (value && typeof value === "object") {
    const guard = seen ?? new WeakSet<object>();
    if (guard.has(value as object)) return "[循环引用]";
    guard.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.replace(KEY_NOISE, "");
      out[key] = SECRET_KEY_PATTERN.test(normalizedKey) ? MASKED_SECRET : maskSecretsDeep(entry, depth + 1, guard);
    }
    return out;
  }
  return value;
}
