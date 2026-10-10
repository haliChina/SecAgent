/**
 * ANSI 转义序列剥离（UI P3-7 不可信输出处理）。
 *
 * 工具输出（bash/命令行程序）常带颜色/光标/标题控制序列，原样进
 * <pre> 会显示成乱码方块。这里按 primitives 模式处理：只剥序列、
 * 保留纯文本——不解释颜色语义（解释即给不可信内容开渲染面）。
 *
 * 覆盖：CSI（SGR 颜色/光标/擦除）、OSC（终端标题/超链接，BEL 或
 * ST 终止）、DCS、无参数 Fe 转义、遗留 BEL。
 */

// OSC（如 \u001b]0;title\u0007、\u001b]8;;url\u001b\\link…）：吃掉整段，
// 无终止符时吃到下一个 ESC 前或串尾（宁可多剥，不留裸 ESC）
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
// DCS（\u001bP … \u001b\\）
const DCS_SEQUENCE = /\u001bP[\s\S]*?\u001b\\/g;
// CSI（\u001b[31m、\u001b[2K、\u001b[?25l 等）：参数 + 中间字节 + 终止字节
const CSI_SEQUENCE = /[\u001b\u009b]\[[0-9;:<=>?]*[ -/]*[@-~]/g;
// 其余两字符 Fe 转义（\u001b(B 字符集、\u001bM 反卷等）
const ESC_SEQUENCE = /[\u001b\u009b][ -/]*[@-~]/g;
// 遗留 BEL（进度条/提示音噪声，无显示意义）
const STRAY_BEL = /\u0007/g;

export function stripAnsi(text: string): string {
  return text
    .replace(OSC_SEQUENCE, "")
    .replace(DCS_SEQUENCE, "")
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
