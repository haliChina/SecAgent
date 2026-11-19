/**
 * P2 主题色板（TS 侧唯一真源）。
 * CSS 侧真源是 styles.css 的 :root 变量（--accent 等）；SVG presentation
 * 属性与 canvas fillStyle 不支持 var()，故 TS 侧由本模块供值。
 * 改主题时与 :root 同步（目前均为白蓝黑体系，见 R32）。
 */

/** 主 accent（= CSS --accent #2563EB） */
export const ACCENT = "#2563EB";
/** 深 accent（= CSS --accent-text #1D4ED8） */
export const ACCENT_DEEP = "#1D4ED8";
/** 蓝渐变中间调（WakeOverlay 流光等） */
export const ACCENT_SKY = "#60A5FA";
/** 蓝渐变高光调 */
export const ACCENT_PALE = "#93C5FD";
/** 浅蓝面（数学教具侧面） */
export const ACCENT_MID = "#BFDBFE";
/** 浅蓝面（= CSS --color-blue-100 量级） */
export const ACCENT_SOFT = "#DBEAFE";
/** 极浅蓝底（= CSS --color-blue-50 量级） */
export const ACCENT_FAINT = "#EFF6FF";

/** 错误红（功能语义色） */
export const ERROR_RED = "#F87171";
/** 成功绿（功能语义色） */
export const OK_GREEN = "#4ADE80";
