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
/* DeleteButton (rareui deletebutton) — 展开式两钮确认删除               */
/* 逐行直译自 swamimalode07/rare-ui components/ui/delete-button.tsx：    */
/* 48px 垃圾桶（桶壁 motion 模板插值、盖 -35° spring LID）展开 84px 凹槽 */
/* 面板；✓ 描画 pathLength / × 圆钮 whileTap PRESS 弹簧；kept 回弹 nudge。 */
/* 适配：sr-only/aria-label 中文化；ariaLabel prop 供会话列表命名。       */
/* ------------------------------------------------------------------ */
const DB_HINGE = "3px 6px";
const DB_LID_OPEN = -35;
const DB_WALL_TOP = 6;
const DB_WALL_TOP_OPEN = 13.5;
const DB_WALL_BASE = 20;

const DB_TILE = 48;
const DB_PANEL = 84;
const DB_HOLD = { deleted: 1400, kept: 600 } as const;

const DB_EASE = [0.32, 0.72, 0, 1] as const;
const DB_EASE_LID = [0.34, 1.1, 0.64, 1] as const;

const DB_WIDTH = { duration: 0.62, ease: DB_EASE } as const;
const DB_LID = { duration: 0.6, ease: DB_EASE_LID } as const;
const DB_WALL = { duration: 0.56, ease: DB_EASE } as const;
const DB_IN = { duration: 0.44, ease: DB_EASE, delay: 0.14 } as const;
const DB_OUT = { duration: 0.3, ease: DB_EASE } as const;
const DB_TAP = { duration: 0.2, ease: DB_EASE } as const;
const DB_SWAP = { duration: 0.22, ease: DB_EASE } as const;
const DB_SETTLE = { duration: 0.45, ease: DB_EASE } as const;
const DB_PRESS = {
  type: "spring",
  stiffness: 520,
  damping: 18,
  mass: 0.5,
} as const;
const DB_INSTANT = { duration: 0 } as const;

const DB_SURFACE = "bg-[#F4F4F9] dark:bg-[#262626]";
const DB_RECESS = "bg-[#E7E7EF] dark:bg-[#1B1B1B]";
const DB_GLYPH = "text-[#868593] dark:text-[#9B9AA7]";
const DB_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[#868593]";
const DB_ACCENT = "#FF5F2E";

const DB_LIFT =
  "shadow-[0_0.5px_1px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.08),inset_0_0.5px_0_rgba(255,255,255,0.9)] dark:shadow-[0_0.5px_1px_rgba(0,0,0,0.35),0_1.5px_4px_rgba(0,0,0,0.3),inset_0_0.5px_0_rgba(255,255,255,0.05)]";

const DB_CIRCLE = `grid h-7 w-7 place-items-center rounded-full transition-colors duration-200 hover:bg-[#FAFAFD] dark:hover:bg-[#2C2C2C] ${DB_FOCUS} ${DB_SURFACE} ${DB_LIFT}`;

const DB_ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const dbPanelMotion = {
  hidden: { opacity: 0, x: -6, transition: DB_OUT },
  shown: { opacity: 1, x: 0, transition: { ...DB_IN, staggerChildren: 0.07 } },
};

const dbCircleMotion = {
  hidden: { opacity: 0, scale: 0.9, transition: DB_OUT },
  shown: { opacity: 1, scale: 1, transition: DB_IN },
};

function DbCircle({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.div className="flex" variants={reduced ? undefined : dbCircleMotion}>
      <motion.button
        type="button"
        aria-label={label}
        onClick={onClick}
        whileHover={reduced ? undefined : { scale: 1.03 }}
        whileTap={reduced ? undefined : { scale: 0.84 }}
        transition={DB_PRESS}
        className={DB_CIRCLE}
      >
        <svg
          {...DB_ICON}
          width="14"
          height="14"
          stroke="currentColor"
          strokeWidth="3.5"
        >
          {children}
        </svg>
      </motion.button>
    </motion.div>
  );
}

type DbStatus = "idle" | "deleted" | "kept";

export type DeleteButtonProps = Omit<
  ComponentProps<"div">,
  "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
> & {
  onConfirm?: () => void;
  onCancel?: () => void;
  /** 应用适配：覆盖默认 aria-label（会话列表传入「删除会话 xxx」） */
  ariaLabel?: string;
};

export function DeleteButton({ onConfirm, onCancel, ariaLabel, className, ...props }: DeleteButtonProps) {
  const reduced = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DbStatus>("idle");
  const trigger = useRef<HTMLButtonElement>(null);
  const timing = (transition: Transition) => (reduced ? DB_INSTANT : transition);

  const top = useMotionValue(DB_WALL_TOP);
  const wall = useTransform(top, (y) => DB_WALL_BASE - y);
  const bin = useMotionTemplate`M19 ${top}v${wall}a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V${top}`;
  const settle = useMotionValue(1);

  useEffect(() => {
    const walls = animate(
      top,
      open ? DB_WALL_TOP_OPEN : DB_WALL_TOP,
      reduced ? DB_INSTANT : DB_WALL,
    );
    return () => walls.stop();
  }, [open, reduced, top]);

  useEffect(() => {
    if (status === "idle") return;
    const nudge =
      status === "kept" && !reduced
        ? animate(settle, [1, 0.86, 1], DB_SETTLE)
        : null;
    const done = setTimeout(() => setStatus("idle"), DB_HOLD[status]);
    return () => {
      nudge?.stop();
      clearTimeout(done);
    };
  }, [status, reduced, settle]);

  const resolve = (next: Exclude<DbStatus, "idle">) => {
    setOpen(false);
    setStatus(next);
    trigger.current?.focus();
    (next === "deleted" ? onConfirm : onCancel)?.();
  };

  return (
    <motion.div
      data-slot="delete-button"
      data-state={open ? "open" : "closed"}
      data-status={status}
      className={cn("relative h-12 rounded-2xl", DB_SURFACE, DB_GLYPH, className)}
      animate={{ width: open ? DB_TILE + DB_PANEL : DB_TILE }}
      transition={timing(DB_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) resolve("kept");
      }}
      {...props}
    >
      <motion.button
        ref={trigger}
        type="button"
        aria-label={ariaLabel ?? "删除"}
        aria-expanded={open}
        onClick={() => {
          if (open) return resolve("kept");
          setStatus("idle");
          setOpen(true);
        }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={DB_TAP}
        className={cn(
          "relative z-10 grid h-12 w-12 place-items-center rounded-2xl",
          DB_FOCUS,
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {status === "deleted" ? (
            <motion.svg
              key="done"
              {...DB_ICON}
              width="20"
              height="20"
              stroke={DB_ACCENT}
              strokeWidth="2.5"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={timing(DB_SWAP)}
            >
              <motion.path
                d="M4 12.5 9.5 18 20 7"
                initial={reduced ? undefined : { pathLength: 0 }}
                animate={reduced ? undefined : { pathLength: 1 }}
                transition={DB_SETTLE}
              />
            </motion.svg>
          ) : (
            <motion.svg
              key="bin"
              {...DB_ICON}
              width="20"
              height="20"
              stroke="currentColor"
              strokeWidth="2"
              className="overflow-visible"
              style={{ scale: settle }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={timing(DB_SWAP)}
            >
              <motion.path d={bin} />
              <motion.g
                style={{ transformBox: "view-box", transformOrigin: DB_HINGE }}
                animate={{ rotate: open ? DB_LID_OPEN : 0 }}
                transition={timing(DB_LID)}
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </motion.g>
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.button>

      <span role="status" aria-live="polite" className="sr-only">
        {status === "deleted" ? "已删除" : status === "kept" ? "已保留" : ""}
      </span>

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            style={{ width: DB_PANEL }}
            className={cn(
              "absolute inset-y-0 right-0 flex items-center justify-center gap-2 rounded-2xl",
              DB_RECESS,
            )}
            variants={reduced ? undefined : dbPanelMotion}
            initial="hidden"
            animate="shown"
            exit="hidden"
          >
            <span
              aria-hidden
              className={cn(
                "absolute -left-1.25 top-1/2 z-20 h-2.5 w-1.5 -translate-y-1/2 [clip-path:polygon(100%_0,0_50%,100%_100%)]",
                DB_RECESS,
              )}
            />
            <DbCircle label="确认删除" onClick={() => resolve("deleted")}>
              <path d="M4 12.5 9.5 18 20 7" stroke={DB_ACCENT} />
            </DbCircle>
            <DbCircle label="取消" onClick={() => resolve("kept")}>
              <path d="M6 6 18 18M18 6 6 18" />
            </DbCircle>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

