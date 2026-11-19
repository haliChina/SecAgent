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
/* AnimatedCounter (rareui animatedcounter) — 逐位滚轮数字动画           */
/* 逐行直译自 swamimalode07/rare-ui components/ui/animated-counter.tsx。 */
/* 每位 0-9 纵向滚轮（尾 0 环绕）、方向感知、1.5em 渐隐遮罩、popLayout  */
/* 进位整组横移（motion layout 动画，shifts/layoutDependency）。         */
/* ------------------------------------------------------------------ */
const AC_FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// the trailing 0 makes the wrap from 9 back to 0 land on an identical face
const AC_WHEEL = [...AC_FACES, 0];

// the air around each face is what the mask fades through, so a resting digit stays solid
const AC_LINE = 1.5;
// eased rather than a straight ramp; a linear fade of the same width reads as a hard edge
const AC_FADE = `linear-gradient(to bottom,
  rgba(0,0,0,0) 0%,
  rgba(0,0,0,0.06) 5.5%,
  rgba(0,0,0,0.5) 11%,
  rgba(0,0,0,0.94) 16.5%,
  #000 22%,
  #000 78%,
  rgba(0,0,0,0.94) 83.5%,
  rgba(0,0,0,0.5) 89%,
  rgba(0,0,0,0.06) 94.5%,
  rgba(0,0,0,0) 100%)`;

const AC_EASE = [0.22, 1, 0.36, 1] as const;
const AC_BOUNCE = 0.18;
const AC_LEAVE = { duration: 0.18, ease: AC_EASE } as const;
const AC_INSTANT = { duration: 0 } as const;

const acSpring = (duration: number): Transition => ({
  type: "spring",
  visualDuration: duration,
  bounce: AC_BOUNCE,
});

const AC_MAX_DECIMALS = 15;
const AC_MAX_PAD = 24;
const AC_MIN_DURATION = 0.01;
const AC_MAX_DURATION = 60;

const acMod = (n: number, m: number) => ((n % m) + m) % m;
const acClamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Number.isFinite(n) ? n : low));
const acIsDigit = (char: string) => char >= "0" && char <= "9";

// built once so React skips reconciling 21 spans per digit on every change
const AC_SIZER = AC_FACES.map((face) => (
  <span key={face} aria-hidden className="invisible [grid-area:1/1]">
    {face}
  </span>
));

const AC_STACK = AC_WHEEL.map((face, index) => (
  <span
    key={index}
    className="flex items-center justify-center"
    style={{ height: `${AC_LINE}em` }}
  >
    {face}
  </span>
));

export type CounterGrouping = "western" | "indian";

const AC_EVERY_THREE = /\B(?=(\d{3})+(?!\d))/g;
const AC_EVERY_TWO = /\B(?=(\d{2})+(?!\d))/g;

function acGroup(whole: string, separator: string, grouping: CounterGrouping) {
  if (!separator) return whole;
  if (grouping !== "indian") return whole.replace(AC_EVERY_THREE, separator);
  const head = whole.slice(0, -3);
  if (!head) return whole;
  return `${head.replace(AC_EVERY_TWO, separator)}${separator}${whole.slice(-3)}`;
}

type AcShape = {
  amount: number;
  scaled: number;
  places: number;
  pace: number;
  width: number;
};

function acMeasure(
  value: number,
  decimals: number,
  padStart: number,
  duration: number,
): AcShape {
  // NaN would make the previous-value comparison true forever
  const amount = Number.isFinite(value) ? value : 0;
  const places = acClamp(Math.trunc(decimals), 0, AC_MAX_DECIMALS);
  const pad = acClamp(Math.trunc(padStart), 1, AC_MAX_PAD);
  // past MAX_SAFE_INTEGER the digits are noise, and past 1e21 String() turns exponential
  const scaled = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.round(Math.abs(amount) * 10 ** places),
  );

  return {
    amount,
    scaled,
    places,
    pace: acClamp(duration, AC_MIN_DURATION, AC_MAX_DURATION),
    width: Math.max(String(scaled).length, places + pad),
  };
}

function acFormat({ scaled, places, width }: AcShape, separator: string, decimalSeparator: string, grouping: CounterGrouping) {
  const raw = String(scaled).padStart(width, "0");
  const whole = acGroup(raw.slice(0, raw.length - places) || "0", separator, grouping);
  return places
    ? `${whole}${decimalSeparator}${raw.slice(raw.length - places)}`
    : whole;
}

// keyed by distance from the right, so gaining a place moves columns rather than remounting them
type AcCell =
  | { kind: "digit"; key: number; digit: number }
  | { kind: "mark"; key: string; char: string };

function acToCells(chars: string, width: number): AcCell[] {
  const cells: AcCell[] = [];
  let seen = 0;
  // only digits advance the place, so a multi-character separator would repeat a key
  let run = 0;

  for (const char of chars) {
    if (acIsDigit(char)) {
      run = 0;
      cells.push({ kind: "digit", key: width - seen++, digit: Number(char) });
    } else {
      cells.push({ kind: "mark", key: `mark-${width - seen}-${run++}`, char });
    }
  }
  return cells;
}

// 应用适配（非原版行为）：每位最短路径——上升距离 ≤5 面向上滚，否则向下滚
function acNearestGoal(at: number, digit: number): number {
  const up = acMod(digit - at, 10);
  return up <= 5 ? at + up : at + up - 10;
}

function useAcWheel(
  from: number,
  digit: number,
  dir: number,
  duration: number,
  reduced: boolean,
  odometer: boolean,
) {
  const pos = useMotionValue(from);
  const goal = useRef(from);

  // read rather than depended on: a reversal alone must not restart every column
  const heading = useRef(dir);
  useEffect(() => {
    heading.current = dir;
  }, [dir]);

  useEffect(() => {
    if (reduced) {
      goal.current = digit;
      pos.set(digit);
      return;
    }
    // re-aim only when the face changed, or a reversal sends the wheel the long way round
    if (acMod(goal.current, 10) !== digit) {
      // aim from where the wheel is, so a moving value never queues up a backlog of turns
      const at = pos.get();
      goal.current = !odometer
        ? acNearestGoal(at, digit)
        : heading.current < 0
          ? at - acMod(at - digit, 10)
          : at + acMod(digit - at, 10);
    }
    const roll = animate(pos, goal.current, acSpring(duration));
    return () => roll.stop();
  }, [digit, duration, reduced, pos, odometer]);

  return useTransform(pos, (p) => `${(-acMod(p, 10) * 100) / AC_WHEEL.length}%`);
}

type AcSlotProps = {
  reduced: boolean;
  dep: number;
  shift: Transition;
};

const acShifts = ({ reduced, dep, shift }: AcSlotProps) => ({
  layout: !reduced,
  layoutDependency: dep,
  transition: shift,
});

const acFades = (reduced: boolean) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: reduced ? AC_INSTANT : AC_LEAVE },
});

function AcFixed({ children, ...slot }: AcSlotProps & { children: ReactNode }) {
  return (
    <motion.span {...acShifts(slot)} className="inline-block">
      {children}
    </motion.span>
  );
}

function AcMark({ char, ...slot }: AcSlotProps & { char: string }) {
  return (
    <motion.span
      data-slot="animated-counter-mark"
      {...acShifts(slot)}
      {...acFades(slot.reduced)}
      className="inline-block"
    >
      {char}
    </motion.span>
  );
}

const AcDigit = memo(function AcDigit({
  digit,
  from,
  dir,
  duration,
  odometer,
  ...slot
}: AcSlotProps & {
  digit: number;
  from: number;
  dir: number;
  duration: number;
  odometer: boolean;
}) {
  const y = useAcWheel(from, digit, dir, duration, slot.reduced, odometer);

  return (
    <motion.span
      data-slot="animated-counter-digit"
      {...acShifts(slot)}
      className="relative inline-grid overflow-hidden"
      style={{
        height: `${AC_LINE}em`,
        lineHeight: AC_LINE,
        maskImage: AC_FADE,
        WebkitMaskImage: AC_FADE,
      }}
    >
      {/* widest-face width, for fonts with no tabular figures */}
      {AC_SIZER}
      <motion.span style={{ y }} className="absolute inset-x-0 top-0">
        {AC_STACK}
      </motion.span>
    </motion.span>
  );
});

export type AnimatedCounterProps = Omit<
  ComponentProps<"span">,
  "children" | "prefix" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
> & {
  value: number;
  decimals?: number;
  duration?: number;
  padStart?: number;
  separator?: string;
  decimalSeparator?: string;
  grouping?: CounterGrouping;
  /** 滚动方向语义：true（默认）= 原版里程表——值降时所有位统一向下滚（反向位绕远路）；
   *  false = 每位最短路径（更符合直觉）。 */
  odometer?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export function AnimatedCounter({
  value,
  decimals = 0,
  duration = 0.6,
  padStart = 1,
  separator = ",",
  decimalSeparator = ".",
  grouping = "western",
  odometer = true,
  prefix,
  suffix,
  className,
  style,
  ...props
}: AnimatedCounterProps) {
  const reduced = useReducedMotion() ?? false;

  const shape = acMeasure(value, decimals, padStart, duration);
  const chars = acFormat(shape, separator, decimalSeparator, grouping);
  const cells = acToCells(chars, shape.width);
  const negative = shape.amount < 0 && shape.scaled > 0;

  const [previous, setPrevious] = useState(shape.amount);
  const [dir, setDir] = useState(1);
  if (previous !== shape.amount) {
    setDir(shape.amount >= previous ? 1 : -1);
    setPrevious(shape.amount);
  }

  // faces at mount; a place that appears later starts from 0 and rolls in
  const [seed] = useState(() => {
    const faces: Record<number, number> = {};
    for (const cell of cells) {
      if (cell.kind === "digit") faces[cell.key] = cell.digit;
    }
    return faces;
  });

  const shift = useMemo<Transition>(
    () => (reduced ? AC_INSTANT : acSpring(shape.pace)),
    [reduced, shape.pace],
  );

  const slot: AcSlotProps = { reduced, dep: chars.length, shift };

  return (
    <span
      data-slot="animated-counter"
      className={cn("inline-flex items-center tabular-nums", className)}
      aria-live="off"
      {...props}
      style={style}
    >
      {/* the whole number stays available to screen readers and find-in-page */}
      <span className="sr-only">{chars}</span>

      {prefix != null && <AcFixed {...slot}>{prefix}</AcFixed>}
      <span aria-hidden className="inline-flex select-none items-center">
        {negative && <AcFixed {...slot}>-</AcFixed>}
        <AnimatePresence mode="popLayout" initial={false}>
          {cells.map((cell) =>
            cell.kind === "digit" ? (
              <AcDigit
                key={cell.key}
                {...slot}
                digit={cell.digit}
                from={seed[cell.key] ?? 0}
                dir={dir}
                duration={shape.pace}
                odometer={odometer}
              />
            ) : (
              <AcMark key={cell.key} {...slot} char={cell.char} />
            ),
          )}
        </AnimatePresence>
      </span>

      {suffix != null && <AcFixed {...slot}>{suffix}</AcFixed>}
    </span>
  );
}

