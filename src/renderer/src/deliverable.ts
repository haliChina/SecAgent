/**
 * 交付物卡片数据（UI P3-6）。
 *
 * 从本轮工具记录（toolCalls）提取文件改动列表与行数统计。
 * 原则：路径只来自记录（工具 args/result），绝不从模型 prose 里
 * 解析文件名——prose 可以撒谎，记录不会。
 *
 * 计入的本地工具（pi-tools）：
 * - write { path, content }      → result { path, bytes }
 * - edit  { path, oldText, newText } → result { path, replaced }
 *
 * 行数语义（诚实标记）：
 * - write：写入内容的行数记为 +（工具不区分新建/覆盖，记录里没有
 *   该信息，故不标 -）；多次写同一路径按次累计
 * - edit：newText 行数记 +，oldText 行数记 -
 */

interface FileChangeAggregate {
  path: string;
  writes: number;
  edits: number;
  additions: number;
  deletions: number;
}

function lineCount(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

/** 只认记录里的字段：write/edit 的 result 必须是含 path 的对象（成功返回的形态）。 */
export function collectFileChanges(toolCalls: Array<{ name: string; arguments?: unknown; result?: unknown }> | undefined): FileChangeAggregate[] {
  if (!toolCalls?.length) return [];
  const aggregates = new Map<string, FileChangeAggregate>();
  for (const call of toolCalls) {
    if (call.name !== "write" && call.name !== "edit") continue;
    if (!call.result || typeof call.result !== "object") continue;
    const resultPath = (call.result as { path?: unknown }).path;
    if (typeof resultPath !== "string" || !resultPath.trim()) continue;
    const args = (call.arguments ?? {}) as Record<string, unknown>;
    let entry = aggregates.get(resultPath);
    if (!entry) {
      entry = { path: resultPath, writes: 0, edits: 0, additions: 0, deletions: 0 };
      aggregates.set(resultPath, entry);
    }
    if (call.name === "write") {
      entry.writes += 1;
      entry.additions += lineCount(typeof args.content === "string" ? args.content : "");
    } else {
      entry.edits += 1;
      entry.additions += lineCount(typeof args.newText === "string" ? args.newText : "");
      entry.deletions += lineCount(typeof args.oldText === "string" ? args.oldText : "");
    }
  }
  return [...aggregates.values()];
}

/** 路径显示：文件名 + 父目录（完整路径留给 title）。 */
export function splitPath(path: string): { name: string; dir: string | null } {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return { name: normalized, dir: null };
  if (slash === 0) return { name: normalized.slice(1), dir: "/" };
  return { name: normalized.slice(slash + 1), dir: normalized.slice(0, slash) };
}
