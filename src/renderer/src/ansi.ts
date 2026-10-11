/**
 * ANSI 转义序列剥离（UI P3-7 不可信输出处理）。
 *
 * 工具输出（bash/命令行程序）常带颜色/光标/标题控制序列，原样进
 * <pre> 会显示成乱码方块。这里按 primitives 模式处理：只剥序列、
 * 保留纯文本——不解释颜色语义（解释即给不可信内容开渲染面）。
 *
 * 覆盖：CSI（SGR 颜色/光标/擦除）、OSC（终端标题/超链接，BEL 或
 * ST 终止）、DCS、PM/APC、无参数 Fe 转义、遗留 BEL、单字节 C1
 * 引入符（先归一化成 ESC 双字节形式再剥）。
 */

// OSC（如 \u001b]0;title\u0007、\u001b]8;;url\u001b\\link…）：吃掉整段，
// 无终止符时吃到下一个 ESC 前或串尾（宁可多剥，不留裸 ESC）
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
// DCS（\u001bP … \u001b\\）
const DCS_SEQUENCE = /\u001bP[\s\S]*?\u001b\\/g;
// PM/APC（\u001b^ … \u001b\\、\u001b_ … \u001b\\）：私有消息/应用命令，整段
// 无显示意义；此前只吃引入符不吃载荷，C0/C1 两形式统一整段剥
const PM_APC_SEQUENCE = /\u001b[\^_][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
// CSI（\u001b[31m、\u001b[2K、\u001b[?25l 等）：参数 + 中间字节 + 终止字节
const CSI_SEQUENCE = /[\u001b\u009b]\[[0-9;:<=>?]*[ -/]*[@-~]/g;
// 其余两字符 Fe 转义（\u001b(B 字符集、\u001bM 反卷等）
const ESC_SEQUENCE = /[\u001b\u009b][ -/]*[@-~]/g;
// 遗留 BEL（进度条/提示音噪声，无显示意义）
const STRAY_BEL = /\u0007/g;
// C1→C0 归一化（评审补漏）：单字节 C1 引入符（DCS \x90、OSC \x9d、
// PM \x9e、APC \x9f、ST \x9c、CSI \x9b）在 UTF-8 译码后若以 C1 形式
// 穿过（如 \x9d8;;url\x9c），双字节正则拦不住。先统一归一成 ESC 形式
// 再走下方剥离规则——\x9c 归一为 ESC \ 后由 Fe 转义规则吃掉。
const C1_TO_C0: Array<[RegExp, string]> = [
  [/\u0090/g, "\u001bP"],
  [/\u009b/g, "\u001b["],
  [/\u009c/g, "\u001b\\"],
  [/\u009d/g, "\u001b]"],
  [/\u009e/g, "\u001b^"],
  [/\u009f/g, "\u001b_"]
];

export function stripAnsi(text: string): string {
  let normalized = text;
  for (const [pattern, replacement] of C1_TO_C0) normalized = normalized.replace(pattern, replacement);
  return normalized
    .replace(OSC_SEQUENCE, "")
    .replace(DCS_SEQUENCE, "")
    .replace(PM_APC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(ESC_SEQUENCE, "")
    .replace(STRAY_BEL, "");
}

/** 对任意 JSON 形状的值做深遍历，剥掉所有字符串里的 ANSI 序列。 */
export function stripAnsiDeep<T>(value: T): T {
  if (typeof value === "string") return stripAnsi(value) as unknown as T;
  if (Array.isArray(value)) return value.map(stripAnsiDeep) as unknown as T;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const target: Record<string, unknown> = {};
    for (const key of Object.keys(source)) target[key] = stripAnsiDeep(source[key]);
    return target as unknown as T;
  }
  return value;
}
