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
export function NumberTicker({
  value,
  label,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "value" | "label"> & {
  value: number;
  label: string;
}) {
  function RollingDigit({ digit }: { digit: number }) {
    return (
      <span className="inline-flex h-[1.15em] overflow-hidden">
        <span
          className="flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
          style={{ transform: `translateY(-${digit * 1.15}em)` }}
        >
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="h-[1.15em] leading-[1.15]">
              {i}
            </span>
          ))}
        </span>
      </span>
    );
  }
  const formatted = value.toLocaleString("en-US");
  return (
    <div
      data-slot="number-ticker"
      className={cn("flex flex-col items-center gap-2.5", className)}
      {...props}
    >
      <span
        className="flex text-3xl font-medium tracking-tight tabular-nums"
        aria-label={formatted}
      >
        {formatted.split("").map((char, i) =>
        /\d/.test(char) ? (
            <RollingDigit key={i} digit={Number(char)} />
          ) : (
            <span key={i} className="h-[1.15em] leading-[1.15]">
              {char}
            </span>
          ),
        )}
      </span>
      <span className={cn(AUI_MONO, "text-muted-foreground")}>{label}</span>
    </div>
  );
}

export function MessageQueue({
  running,
  queued,
  onCancel,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "running" | "queued" | "onCancel"> & {
  running: string;
  queued: readonly AuiQueuedMessage[];
  onCancel?: (id: string) => void;
}) {
  return (
    <div
      data-slot="message-queue"
      className={cn("flex w-full max-w-sm flex-col gap-2", className)}
      {...props}
    >
      <div className={cn(AUI_PAPER, "flex items-center gap-2.5 rounded-2xl p-3")}>
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500/60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-blue-500 dark:bg-blue-400" />
        </span>
        <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13.5px]">{running}</span>
        <span className={cn(AUI_MONO, "text-muted-foreground shrink-0")}>running</span>
      </div>

      {queued.length > 0 && (
        <div className="flex items-baseline justify-between px-1">
          <span className={cn(AUI_MONO, "text-muted-foreground")}>{queued.length} queued</span>
          <span className={cn(AUI_MONO, "text-muted-foreground")}>sends when this finishes</span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {queued.map((message, index) => (
          <li
            key={message.id}
            className={cn(
              AUI_FIELD,
              "aui-pop-up flex items-center gap-2.5 rounded-2xl py-2 pr-2 pl-3",
            )}
          >
            <span className={cn(AUI_MONO, "text-muted-foreground w-3 shrink-0 tabular-nums")}>
              {index + 1}
            </span>
            <span className="text-foreground/60 min-w-0 flex-1 truncate text-[13.5px]">
              {message.text}
            </span>
            <ArrowUpIcon className="text-foreground/25 size-3 shrink-0" />
            {onCancel && (
              <button
                type="button"
                aria-label={`Remove "${message.text}" from the queue`}
                onClick={() => onCancel(message.id)}
                className={cn(AUI_GHOST, "size-6 shrink-0")}
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface AuiRegenerateOption {
  id: string;
  label: string;
  detail: string;
}

export function RegenerateMenu({
  options,
  open,
  currentId,
  onOpenChange,
  onPick,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "options" | "open" | "currentId" | "onOpenChange" | "onPick"
> & {
  options: readonly AuiRegenerateOption[];
  open: boolean;
  currentId: string;
  onOpenChange?: (open: boolean) => void;
  onPick?: (id: string) => void;
}) {
  return (
    <div
      data-slot="regenerate-menu"
      className={cn("flex w-full max-w-sm flex-col gap-2", className)}
      {...props}
    >
      {onOpenChange && (
        <button
          type="button"
          aria-expanded={open}
          aria-label="Regenerate with a different model"
          onClick={() => onOpenChange(!open)}
          className={cn(AUI_GHOST, "size-7 self-start", open && "bg-foreground/[0.06] text-foreground/90")}
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
      )}

      {open && (
        <div
          className={cn(
            AUI_FLOATING,
            "aui-pop-down flex flex-col gap-0.5 rounded-2xl p-1.5",
          )}
        >
          {options.map((option) => {
            const content = (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px]">{option.label}</span>
                <span className={cn(AUI_MONO, "text-muted-foreground shrink-0")}>
                  {option.id === currentId ? "current" : option.detail}
                </span>
              </>
            );
            const itemClass = onPick
              ? "hover:bg-foreground/[0.05] flex items-baseline gap-2 rounded-xl px-2.5 py-1.5 text-start transition-colors"
              : "flex items-baseline gap-2 rounded-xl px-2.5 py-1.5 text-start";
            return onPick ? (
              <button key={option.id} type="button" onClick={() => onPick(option.id)} className={itemClass}>
                {content}
              </button>
            ) : (
              <div key={option.id} className={itemClass}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type AuiSpeakerKind = "user" | "agent" | "subagent" | "tool";

export interface AuiSpeakerTurn {
  id: string;
  kind: AuiSpeakerKind;
  name: string;
  detail?: string;
  text: string;
}

const AUI_TONE: Record<AuiSpeakerKind, string> = {
  user: "bg-foreground/[0.06] text-muted-foreground",
  agent: "bg-blue-500/12 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400",
  subagent: "bg-foreground/[0.06] text-muted-foreground",
  tool: "bg-foreground/[0.04] text-muted-foreground",
};

export function SpeakerIdentity({
  turns,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "turns"> & {
  turns: readonly AuiSpeakerTurn[];
}) {
  return (
    <div
      data-slot="speaker-identity"
      className={cn("flex w-full max-w-sm flex-col gap-3.5", className)}
      {...props}
    >
      {turns.map((turn) => (
        <div key={turn.id} className="flex gap-2.5">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-lg",
              AUI_TONE[turn.kind],
              turn.kind === "subagent" && "rounded-full",
            )}
          >
            {turn.kind === "user" ? (
              <UserIcon className="size-3" />
            ) : turn.kind === "tool" ? (
              <WrenchIcon className="size-3" />
            ) : (
              <BotIcon className="size-3" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[13px] font-medium">{turn.name}</span>
              {turn.detail && (
                <span className={cn(AUI_MONO, "text-muted-foreground")}>{turn.detail}</span>
              )}
            </span>
            <span className="text-foreground/65 text-[13.5px] leading-relaxed break-words">
              {turn.text}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface AuiComputerStep {
  id: string;
  action: string;
  target: string;
  x: number;
  y: number;
}

export function ComputerUse({
  url,
  steps,
  activeIndex,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "url" | "steps" | "activeIndex" | "children"> & {
  url: string;
  steps: readonly AuiComputerStep[];
  activeIndex: number;
  children?: ReactNode;
}) {
  const index = auiIndexIn(steps, activeIndex);
  const active = auiAt(steps, index);
  const trail = steps.slice(Math.max(0, index - 2), index + 1);
  return (
    <div
      data-slot="computer-use"
      className={cn(AUI_PAPER, "flex w-full max-w-md flex-col overflow-hidden rounded-2xl", className)}
      {...props}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex shrink-0 gap-1">
          {["bg-red-500/50", "bg-amber-500/50", "bg-emerald-500/50"].map((tint) => (
            <span key={tint} aria-hidden className={cn("size-2 rounded-full", tint)} />
          ))}
        </span>
        <span className={cn(AUI_FIELD, AUI_MONO, "text-muted-foreground min-w-0 flex-1 truncate rounded-full px-2.5 py-1")}>
          {url}
        </span>
      </div>
      <div className="border-foreground/[0.07] relative min-h-[8.5rem] overflow-hidden border-t">
        {children}
        {trail.map((step, i) => (
          <span
            key={step.id}
            aria-hidden
            className="pointer-events-none absolute size-2 rounded-full bg-blue-500 transition-opacity duration-300 dark:bg-blue-400"
            style={{ left: `${step.x}%`, top: `${step.y}%`, opacity: 0.18 * (i + 1) }}
          />
        ))}
        {active && (
          <MousePointer2Icon
            aria-hidden
            className="pointer-events-none absolute size-4 fill-blue-500 text-blue-500 transition-[left,top] duration-500 ease-out motion-reduce:transition-none dark:fill-blue-400 dark:text-blue-400"
            style={{ left: `${active.x}%`, top: `${active.y}%`, translate: "-50% -50%" }}
          />
        )}
      </div>
    </div>
  );
}

export interface AuiDatedMessage {
  id: string;
  day: string;
  time: string;
  role: "user" | "assistant";
  text: string;
}

export function DaySeparatorTranscript({
  messages,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "messages"> & {
  messages: readonly AuiDatedMessage[];
}) {
  let lastDay = "";
  return (
    <div
      data-slot="day-separator-transcript"
      className={cn("flex w-full max-w-sm flex-col gap-2", className)}
      {...props}
    >
      {messages.map((message) => {
        const newDay = message.day !== lastDay;
        lastDay = message.day;
        return (
          <div key={message.id} className="flex flex-col gap-2">
            {newDay && (
              <div className="flex items-center gap-3">
                <span className="bg-border h-px w-6" />
                <span className={cn(AUI_MONO, "text-muted-foreground")}>{message.day}</span>
                <span className="bg-border h-px flex-1" />
              </div>
            )}
            <div className="group flex items-center gap-1.5">
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-baseline gap-2",
                  message.role === "user" && "flex-row-reverse",
                )}
              >
                <span
                  className={cn(
                    "max-w-[80%] text-[13.5px] leading-relaxed break-words",
                    message.role === "user"
                      ? "bg-foreground/[0.05] rounded-2xl px-3.5 py-2"
                      : "text-foreground/75",
                  )}
                >
                  {message.text}
                </span>
                <span
                  className={cn(
                    AUI_MONO,
                    "text-foreground/0 group-hover:text-foreground/30 shrink-0 tabular-nums transition-colors",
                  )}
                >
                  {message.time}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface AuiQueuedMessage {
  id: string;
  text: string;
}
