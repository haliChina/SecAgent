/**
 * UI Bits — 参考组件移植（A 清爽浅色 · Notion/Linear 系）。
 *
 * R14 起放弃自研动效（弹簧物理/CSS 过渡替代方案与原版手感差距过大）：
 * 直接引入 rare-ui 同款动画引擎 motion/react，组件按 GitHub 源码直译，
 * 类名原样保留（Tailwind utilities），动效参数与原版逐项一致。
 *
 * 设计参考与实现来源：
 *  - rareui（github.com/swamimalode07/rare-ui，MIT）: matrixorb / deletebutton /
 *    scrollprogress / hooksidebar / voicenote / animatedcounter —— 逐行直译自
 *    components/ui/ 下源文件，仅做 Electron/无路由环境适配（见各组件注释）。
 *  - assistant-ui.com: tool-error / guardrail-notice / message-actions / error-state /
 *    message-queue / stopped-run / day-separator / speaker-identity / regenerate-menu /
 *    computer-use / number-ticker
 *  - reactbits.dev: voice-pill / thought-line / branched-menu
 *
 * 设计参考致谢：rareui.com / assistant-ui.com / reactbits.dev（详见 README 开源致谢）。
 *
 * 交互状态同时用文字/形状表达；触屏目标 ≥44px；动画尊重 prefers-reduced-motion。
 */
import { Fragment, createContext, isValidElement, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue, type Transition } from "motion/react";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import { AlertCircleIcon, Loader2Icon, RotateCwIcon, ArrowUpIcon, XIcon, RefreshCwIcon, UserIcon, WrenchIcon, BotIcon, MousePointer2Icon, MicIcon, ArrowLeftIcon, DownloadIcon, RocketIcon, SettingsIcon, PaintbrushIcon, TypeIcon, LayersIcon, BellIcon, ChevronDownIcon, PaperclipIcon, CalendarIcon, ChartLineIcon, FileIcon, GlobeIcon, MailIcon, PlusIcon, SparklesIcon, CheckIcon, ShieldIcon, CopyIcon, ThumbsUpIcon, ThumbsDownIcon, EllipsisIcon, SquareIcon, ArrowRightIcon, CircleAlertIcon } from "lucide-react";

/** rare-ui 的 cn 为 twMerge(clsx(...))；本项目无 Tailwind 类冲突合并需求，clsx 等价 */
const cn = clsx;

/* ------------------------------------------------------------------ */
/* DaySeparator (assistant-ui) — 消息流日期分隔                           */
/* ------------------------------------------------------------------ */
export function daySeparatorLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  // 用本地日历日零点的时间差计算天数（而非 UTC epoch 日或 month*32 数字键）：
  // UTC 截断会把本地 23 点后的消息算进「下一天」，偏移非整小时的时区（如
  // UTC+5:30）每天都漂移；数字键在月/年边界不按天递增（1/31→2/1 差 2、
  // 12/31→1/1 差 130）。Math.round 兼容 DST 切换日的 23/25 小时日。
  const localMidnight = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((localMidnight(now) - localMidnight(date)) / 86_400_000);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

// 本地日历日的稳定 id（ScrollProgress 节锚点 + DaySeparator 挂载用）。
// 不用 ISO 前缀：UTC 截断在 UTC+8 的 0-8 点会把相邻本地日折叠成同一天。
export function daySeparatorId(iso: string): string {
  const date = new Date(iso);
  return `day-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function DaySeparator({ label, id }: { label: string; id?: string }) {
  // role="separator" + aria-label：日期是消息流的时间地标，读屏用户切换
  // 消息时需要这层上下文，不能从无障碍树里拿掉（R8 a11y）。
  // id 供 ScrollProgress 的节锚点定位（rareui 节列表按 document.getElementById 找）。
  return (
    <div id={id} className="day-separator" role="separator" aria-label={label}>
      <span className="day-separator-line" aria-hidden="true" />
      <span className="day-separator-label">{label}</span>
      <span className="day-separator-line" aria-hidden="true" />
    </div>
  );
}
