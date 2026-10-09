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

import { AUI_PAPER, AUI_FLOATING, AUI_FIELD, AUI_GHOST, AUI_MONO, AUI_ICON_SWAP, AUI_ICON_SWAP_IN, AUI_ICON_SWAP_OUT, auiAt, auiIndexIn } from "./aui-shared.js";
export function ToolError({
  name,
  target,
  message,
  attempt,
  maxAttempts,
  retrying,
  onRetry,
  onSkip,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "name" | "target" | "message" | "attempt" | "maxAttempts" | "retrying" | "onRetry" | "onSkip"
> & {
  name: string;
  // 应用适配：真源必填的 target/attempt 系列放宽为可选（工具活动里无对应数据）
  target?: string;
  message: string;
  attempt?: number;
  maxAttempts?: number;
  retrying?: boolean;
  onRetry?: () => void;
  onSkip?: () => void;
}) {
  return (
    <div
      data-slot="tool-error"
      className={cn(AUI_PAPER, "flex w-full max-w-sm flex-col gap-3 rounded-2xl p-3.5", className)}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <AlertCircleIcon className="size-3.5 shrink-0 text-red-500" />
        <span className={cn(AUI_MONO, "text-muted-foreground min-w-0 wrap-anywhere")}>{name}</span>
        <span className="text-foreground/80 min-w-0 flex-1 truncate text-[13px]">{target}</span>
        <span className={cn(AUI_MONO, "text-muted-foreground shrink-0 tabular-nums")}>
          {attempt}/{maxAttempts}
        </span>
      </div>
      <div
        className={cn(
          AUI_FIELD,
          "rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed break-words text-red-700 dark:text-red-300",
        )}
      >
        {message}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={!onSkip}
          className="text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/90 h-7 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground/95 flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96] disabled:pointer-events-none"
        >
          {retrying ? (
            <Loader2Icon className="size-3 animate-spin motion-reduce:animate-none" />
          ) : (
            <RotateCwIcon className="size-3" />
          )}
          {retrying ? "Retrying" : "Retry"}
        </button>
      </div>
    </div>
  );
}
