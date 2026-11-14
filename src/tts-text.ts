/**
 * Markdown → 可朗读纯文本，以及按句切块。
 *
 * 背景：朗读此前在 App.tsx 里用一行正则清洗正文，`[#*_>`~-]` 全局删除会把
 * `GPT-4`、`3-2=1`、`my_var` 这类正文拆坏，也不处理表格、脚注、LaTeX 与
 * `<workspace-files>` 之类的结构化块。这里把清洗收敛成纯函数，主进程与渲染端
 * 共用同一套规则（纯逻辑，不引入 Electron / Node API，渲染端可直接引用）。
 */

/** 单段语音文本上限：与 IPC 层、云端 TTS 的舒适区间对齐（字符）。 */
export const TTS_CHUNK_MAX = 1800;

interface PlainTextOptions {
  /** 是否朗读围栏代码块内容；默认跳过，避免把符号和缩进读成噪声。 */
  readCodeBlocks?: boolean;
}

/** 这些块是给界面看的结构化数据，朗读时整段丢弃（含标签内的文件列表/图形参数）。 */
const STRUCTURED_TAGS = ["workspace-files", "Mafs", "R3F", "tool-call", "tool-result", "thinking"];

function stripStructuredBlocks(markdown: string): string {
  let result = markdown;
  for (const tag of STRUCTURED_TAGS) {
    const pair = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "gi");
    result = result.replace(pair, " ");
    const self = new RegExp(`<${tag}(?:\\s[^>]*)?\\/>`, "gi");
    result = result.replace(self, " ");
  }
  return result;
}

/** 围栏代码：默认整块跳过；开启朗读时压平成一行的代码正文。 */
function replaceCodeFences(markdown: string, readCodeBlocks: boolean): string {
  return markdown.replace(/(?:```|~~~)[^\n]*\n([\s\S]*?)(?:```|~~~)/g, (_match, code: string) => {
    if (!readCodeBlocks) return " ";
    return ` ${code.replace(/\s+/g, " ").trim()} `;
  });
}

/** 表格：分隔行丢弃，数据行按单元格用逗号串起来（保留可读的字段值）。 */
function replaceTables(markdown: string): string {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || trimmed.split("|").length < 3) {
      out.push(line);
      continue;
    }
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (cells.every((cell) => cell === "" || /^:?-{2,}:?$/.test(cell))) continue;
    const text = cells.filter(Boolean).join("，");
    if (text) out.push(text);
  }
  return out.join("\n");
}

/** LaTeX：块级与行内公式整体丢弃（符号串读出来没有意义）。 */
function stripMath(markdown: string): string {
  return markdown
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]+?\$/g, " ");
}

/**
 * Markdown → 纯文本。
 *
 * 只清理“结构性标记”（标题/列表/引用/强调/链接/表格/公式），不做全局字符删除，
 * 因此 `GPT-4`、`3-2=1`、`my_var` 这些正文里的符号会原样保留。
 */
export function markdownToPlainText(markdown: string, options: PlainTextOptions = {}): string {
  let text = markdown.replace(/\r\n?/g, "\n");
  text = stripStructuredBlocks(text);
  text = replaceCodeFences(text, options.readCodeBlocks === true);
  text = replaceTables(text);
  text = stripMath(text);
  text = text.replace(/^\[\^[^\]]+\]:.*$/gm, " "); // 脚注定义
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => (alt ? ` ${alt} ` : " "))
    // 纯数字链接是引用标注（[1](url)），只丢标注本身
    .replace(/\[([^\]]+)\]\([^)]*\)/g, (_match, label: string) => (/^\d{1,2}$/.test(label) ? " " : ` ${label} `))
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, " $1 ") // 引用式链接
    .replace(/\[\^[^\]]+\]/g, " ") // 脚注引用
    .replace(/\[\d{1,2}\]/g, " ") // 引用标注（[1] [2]）
    .replace(/https?:\/\/[^\s<>"')]+/g, " ") // 裸链接
    .replace(/<[^>]+>/g, " ") // 其余 HTML 标签
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]{0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}(?:-{3,}|_{3,}|\*{3,}|={3,})[ \t]*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, " $1 ")
    .replace(/__([^_]+)__/g, " $1 ")
    .replace(/(?<![A-Za-z0-9*])\*([^*\s][^*]*[^*\s])\*(?![A-Za-z0-9*])/g, " $1 ")
    .replace(/(?<![A-Za-z0-9_])_([^_\s][^_]*[^_\s])_(?![A-Za-z0-9_])/g, " $1 ")
    .replace(/`([^`\n]+)`/g, " $1 ")
    .replace(/[\u200B-\u200F\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。！？；：、,.!?;:])/g, "$1")
    .trim();
  return text;
}

const SENTENCE_TERMINATORS = new Set(["。", "！", "？", "!", "?", "；", ";"]);
const SOFT_BREAKS = new Set(["，", ",", "、", "：", ":", "；", ";", " ", "（", "("]);

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let buffer = "";
  for (const char of text) {
    if (char === "\n") {
      if (buffer.trim()) sentences.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
    if (SENTENCE_TERMINATORS.has(char)) {
      if (buffer.trim()) sentences.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) sentences.push(buffer.trim());
  return sentences;
}

/** 超长单句二次切分：优先在逗号/冒号/空格处断开，避免整段被硬切。 */
function splitLongSentence(sentence: string, maxLength: number): string[] {
  const parts: string[] = [];
  const softLimit = Math.floor(maxLength * 0.6);
  let buffer = "";
  for (const char of sentence) {
    buffer += char;
    if (buffer.length >= maxLength) {
      parts.push(buffer);
      buffer = "";
    } else if (buffer.length >= softLimit && SOFT_BREAKS.has(char)) {
      parts.push(buffer);
      buffer = "";
    }
  }
  if (buffer.trim()) parts.push(buffer);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * 按句切成朗读段，每段不超过 `maxLength`。
 * 返回空数组表示没有可朗读内容。
 */
export function splitForSpeech(text: string, maxLength = TTS_CHUNK_MAX): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  for (const sentence of splitSentences(normalized)) {
    if (sentence.length <= maxLength) {
      chunks.push(sentence);
      continue;
    }
    chunks.push(...splitLongSentence(sentence, maxLength));
  }
  return chunks;
}
