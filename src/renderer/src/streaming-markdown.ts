/**
 * 流式 Markdown 未闭合标记补全（R98，学习 RareUI streaming-response 的
 * 「unclosed markers treated as closed while streaming」技巧）。
 *
 * 流式输出进行到一半时，`**加粗` 的闭合星号还没到——直接丢给
 * Markdown 渲染器会显示原始星号，闭合到达后整段重排闪烁。这里在
 * 渲染前把未闭合的常用标记补上闭合（只补尾部，不改语义）：
 * - 未闭合围栏 ``` → 尾部补一行闭合（优先级最高，先于行内反引号）
 * - 行内代码 ` 未闭合 → 补一个反引号（其内的标记不处理——可能是
 *   即将出现的代码内容）
 * - `**` / `__`（粗体）与 `*` / `_`（斜体）奇数补闭合（代码段外）
 * - 未闭合的 `[文字](ur…` → 截到 `[文字]`（去掉不完整的链接语法）
 *
 * 已完成态（done）不调用——最终文本本就完整，补全无意义。
 */

/** 统计未转义出现次数（`\\*` 不计）。 */
function countUnescaped(text: string, marker: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const at = text.indexOf(marker, index);
    if (at < 0) break;
    let slashes = 0;
    for (let probe = at - 1; probe >= 0 && text[probe] === "\\"; probe -= 1) slashes += 1;
    if (slashes % 2 === 0) count += 1;
    index = at + marker.length;
  }
  return count;
}

/** 去掉尾部不完整的链接/图片语法（`[alt](ur…` → `[alt]`）。 */
function trimUnclosedLink(text: string): string {
  const open = text.lastIndexOf("[");
  if (open < 0) return text;
  const rest = text.slice(open);
  if (/^\[[^\]]*\]\([^)]*\)/.test(rest)) return text; /* 最后一个链接已闭合 */
  const paren = rest.indexOf("](");
  return text.slice(0, open) + (paren >= 0 ? rest.slice(0, paren + 1) : "");
}

/** 行内标记补全（不含围栏）：先反引号，后粗体，后斜体。 */
function closeInlineMarkers(segment: string): string {
  const trimmed = trimUnclosedLink(segment);
  if (countUnescaped(trimmed, "`") % 2 === 1) return `${trimmed}\``;
  const spans = trimmed.split("`");
  return spans.map((span, index) => {
    if (index % 2 === 1) return span; /* 行内代码内容原样 */
    let part = span;
    for (const marker of ["**", "__"]) {
      if (countUnescaped(part, marker) % 2 === 1) part += marker;
    }
    for (const marker of ["*", "_"]) {
      if (countUnescaped(part, marker) % 2 === 1) part += marker;
    }
    return part;
  }).join("`");
}

export function closeUnbalancedMarkdown(source: string): string {
  /* 围栏优先：未闭合围栏内的一切（包括标记）都是代码内容，不处理。 */
  const fences = source.split("```");
  if (fences.length % 2 === 0) return `${source}\n\`\`\``;
  return fences.map((segment, index) => (index % 2 === 1 ? segment : closeInlineMarkers(segment))).join("```");
}
