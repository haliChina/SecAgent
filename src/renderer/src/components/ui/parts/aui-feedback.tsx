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
/* ------------------------------------------------------------------ */
/* assistant-ui 真源直译 2（elements：guardrail/message-actions/error/stopped-run） */
/* 适配：可选化应用无数据 props；未传回调的按钮条件隐藏；copied 内部化。     */
/* ------------------------------------------------------------------ */

export type AuiReaction = "up" | "down" | null;

function ShimmerLabel({ active = true, className, ...props }: ComponentProps<"span"> & { active?: boolean }) {
  return <span className={cn(active && "aui-shimmer motion-reduce:animate-none", className)} {...props} />;
}

export function AuiGuardrailNotice({
  title,
  explanation,
  policy,
  alternatives = [],
  onPick,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "title" | "explanation" | "policy" | "alternatives" | "onPick"
> & {
  title: string;
  explanation: string;
  // 应用适配：真源必填的 policy/alternatives 放宽可选
  policy?: string;
  alternatives?: readonly string[];
  onPick?: (alternative: string) => void;
}) {
  return (
    <div
      data-slot="guardrail-notice"
      className={cn(AUI_PAPER, "flex w-full max-w-sm flex-col gap-3 rounded-[20px] p-4", className)}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <ShieldIcon className="size-4" />
        </span>
        <p className="text-foreground/90 text-[13.5px] font-medium">{title}</p>
      </div>
      <p className="text-foreground/60 text-[13.5px] leading-relaxed">{explanation}</p>
      {policy ? (
        <div className={cn(AUI_FIELD, "rounded-full px-2.5 py-1")}>
          <span className={cn(AUI_MONO, "text-muted-foreground")}>{policy}</span>
        </div>
      ) : null}
      {alternatives.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className={cn(AUI_MONO, "text-muted-foreground")}>try instead</span>
          {alternatives.map((alternative) =>
            onPick ? (
              <button
                key={alternative}
                type="button"
                onClick={() => onPick(alternative)}
                className="text-foreground/70 hover:bg-foreground/[0.06] -mx-1.5 rounded-lg px-1.5 py-1 text-start text-[13px] transition-colors"
              >
                {alternative}
              </button>
            ) : (
              <span key={alternative} className="text-foreground/70 -mx-1.5 rounded-lg px-1.5 py-1 text-start text-[13px]">
                {alternative}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function AuiMessageActions({
  copied,
  reaction,
  regenerating,
  onCopy,
  onReactionChange,
  onRegenerate,
  onMore,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "copied" | "reaction" | "regenerating" | "onCopy" | "onReactionChange" | "onRegenerate" | "onMore"
> & {
  // 应用适配：全部可选；未传回调的按钮隐藏；copied 未受控时内部维护
  copied?: boolean;
  reaction?: AuiReaction;
  regenerating?: boolean;
  onCopy?: () => void;
  onReactionChange?: (reaction: AuiReaction) => void;
  onRegenerate?: () => void;
  onMore?: () => void;
}) {
  const [localCopied, setLocalCopied] = useState(false);
  const isCopied = copied ?? localCopied;
  const buttonClassName = cn(AUI_GHOST, "size-7");

  return (
    <div data-slot="message-actions" className={cn("flex items-center gap-1", className)} {...props}>
      {onCopy && (
        <button
          type="button"
          aria-label={isCopied ? "Copied response" : "Copy response"}
          onClick={() => {
            onCopy();
            setLocalCopied(true);
            window.setTimeout(() => setLocalCopied(false), 1500);
          }}
          className={cn(buttonClassName, "grid place-items-center", isCopied && "text-emerald-500")}
        >
          <CopyIcon className={cn(AUI_ICON_SWAP, "size-3.5", isCopied ? AUI_ICON_SWAP_OUT : AUI_ICON_SWAP_IN)} />
          <CheckIcon
            className={cn(
              AUI_ICON_SWAP,
              "absolute size-3.5",
              isCopied ? AUI_ICON_SWAP_IN : AUI_ICON_SWAP_OUT,
            )}
          />
        </button>
      )}
      {onReactionChange && (
        <>
          <button
            type="button"
            aria-label="Mark response helpful"
            aria-pressed={reaction === "up"}
            onClick={() => onReactionChange(reaction === "up" ? null : "up")}
            className={cn(buttonClassName, reaction === "up" && "bg-foreground/[0.06] text-foreground/90")}
          >
            <ThumbsUpIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Mark response unhelpful"
            aria-pressed={reaction === "down"}
            onClick={() => onReactionChange(reaction === "down" ? null : "down")}
            className={cn(buttonClassName, reaction === "down" && "bg-foreground/[0.06] text-foreground/90")}
          >
            <ThumbsDownIcon className="size-3.5" />
          </button>
        </>
      )}
      {onRegenerate && (
        <button type="button" aria-label="Regenerate response" onClick={onRegenerate} className={buttonClassName}>
          <RefreshCwIcon className={cn("size-3.5", regenerating && "animate-spin motion-reduce:animate-none")} />
        </button>
      )}
      {onMore && (
        <button type="button" aria-label="More response actions" onClick={onMore} className={buttonClassName}>
          <EllipsisIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function AuiErrorState({
  title,
  detail,
  retrying = false,
  onRetry,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "title" | "detail" | "retrying" | "onRetry"> & {
  title: string;
  detail: string;
  // 应用适配：retrying/onRetry 可选（无重试动作的场景隐藏按钮）
  retrying?: boolean;
  onRetry?: () => void;
}) {
  if (retrying) {
    return (
      <div
        data-slot="error-state"
        key="retrying"
        role="status"
        className={cn("aui-rise flex w-full max-w-sm items-center gap-2.5 text-sm", className)}
        {...props}
      >
        <RefreshCwIcon className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        <ShimmerLabel className="text-muted-foreground relative inline-block">Retrying</ShimmerLabel>
      </div>
    );
  }

  return (
    <div
      data-slot="error-state"
      key="error"
      role="alert"
      className={cn(
        "aui-rise flex w-full max-w-sm items-start gap-2.5 rounded-2xl bg-red-500/[0.06] px-4 py-3 text-sm",
        className,
      )}
      {...props}
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-red-500/80" />
      <div>
        <p className="font-medium text-red-600">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-red-600/60">{detail}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-red-600 hover:bg-red-500/10 ms-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors"
        >
          <RefreshCwIcon className="size-3" />
          Retry
        </button>
      )}
    </div>
  );
}

export function AuiStoppedRun({
  words = [],
  reason,
  onContinue,
  onDiscard,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "words" | "reason" | "onContinue" | "onDiscard"
> & {
  // 应用适配：words 可选（应用停止标签无词列表，空时隐藏段落）
  words?: readonly string[];
  reason: string;
  onContinue?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <div data-slot="stopped-run" className={cn("flex w-full max-w-sm flex-col gap-3", className)} {...props}>
      {words.length > 0 && (
        <p className="text-foreground/80 text-[13.5px] leading-relaxed">
          {words.join(" ")}
          <span aria-hidden className="bg-foreground/20 ms-1 inline-block h-[1em] w-[2px] translate-y-[0.15em] rounded-full" />
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className={cn(AUI_FIELD, AUI_MONO, "text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1")}>
          <SquareIcon className="size-2.5 fill-current" />
          {reason}
        </span>

        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
            className="text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground/95 ms-auto flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
          >
            Continue
            <ArrowRightIcon className="size-3" />
          </button>
        )}
        {onDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            className="text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/90 flex h-7 items-center rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
          >
            Discard
          </button>
        )}
      </div>
    </div>
  );
}
