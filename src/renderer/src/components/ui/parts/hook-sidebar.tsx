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
/* HookSidebar (rareui hooksidebar) — 钩式侧导航                          */
/* 逐行直译自 swamimalode07/rare-ui components/ui/hook-sidebar.tsx：    */
/* 1px 虚线（repeating-gradient）+ 12×7 SVG 圆弧钩，双轨（灰 hover /     */
/* 彩 active）均 spring 420/34/0.7 驱动 top/height。                    */
/* 适配：无 next 路由（去掉 usePathname/Link 分支，仅受控 value 模式）； */
/* 保留应用侧 items[{id,label,dividerBefore}] 签名 + 设置页分隔线注入。   */
/* ------------------------------------------------------------------ */
const HK_CORNER = 6;
const HK_DASH =
  "repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)";

function HookRail({ from = 0, y, visible, color, dashed, className }: {
  from?: number;
  y: number | null;
  visible: boolean;
  color?: string;
  dashed: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const travel = reduced
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 };

  return (
    <motion.span
      aria-hidden
      initial={false}
      style={{ color }}
      animate={{ opacity: visible && y !== null ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.2 }}
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      <motion.span
        initial={false}
        animate={{ top: from, height: Math.max(0, (y ?? 0) - HK_CORNER - from) }}
        transition={travel}
        style={
          dashed
            ? { backgroundImage: HK_DASH }
            : { backgroundColor: "currentColor" }
        }
        className="absolute left-0.5 w-px"
      />
      <motion.svg
        initial={false}
        animate={{ top: (y ?? 0) - HK_CORNER }}
        transition={travel}
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
        className="absolute left-0.5"
      >
        <path
          d="M0.5 0a6 6 0 0 0 6 6H12"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray={dashed ? "2 2" : undefined}
        />
      </motion.svg>
    </motion.span>
  );
}

export function HookSidebar({ activeId, items, onSelect }: {
  activeId: string;
  items: Array<{ id: string; label: string; dividerBefore?: boolean }>;
  onSelect: (id: string) => void;
}) {
  // 应用适配：active 轨颜色取主题 accent 蓝（原版默认 #FC4C01）
  const color = "#2563EB";
  const dashed = true;
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [centers, setCenters] = useState<number[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId));

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      // 设置窗口常以 hidden 创建、ready-to-show 后才显示：未布局完成时宽/高为 0，
      // offsetTop 全部塌到 0，钩线会叠到第一项上且 ResizeObserver 不再触发。此时跳过，
      // 等布局稳定（observer/rAF）再测。
      if (list.getBoundingClientRect().width === 0) return;
      const next = itemRefs.current.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : null));
      if (next.length !== items.length || next.some((c) => c === null)) return;
      setCenters(next as number[]);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    // 容器尺寸不变但按钮位置变化（窗口从隐藏到显示、字体晚到）时容器 observer 不触发，
    // 逐个按钮 observe + 双 rAF 兜底，确保真实位置最终被测到。
    for (const el of itemRefs.current) if (el) observer.observe(el);
    const first = requestAnimationFrame(measure);
    const second = requestAnimationFrame(() => requestAnimationFrame(measure));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [items.length]);

  const activeY = activeIndex < 0 ? null : (centers[activeIndex] ?? null);
  const hoverY = hoverIndex === null ? null : (centers[hoverIndex] ?? null);

  // above the active row the accent line already covers the span, so draw only the corner
  const hoverFrom =
    activeY !== null && hoverY !== null && hoverY <= activeY
      ? Math.max(0, hoverY - HK_CORNER)
      : (activeY ?? 0);

  const select = (index: number) => {
    onSelect(items[index]!.id);
  };

  return (
    <nav data-slot="hook-sidebar" aria-label="设置导航" className="settings-nav flex flex-col">
      <div
        ref={listRef}
        onMouseLeave={() => setPointerInside(false)}
        className="relative flex flex-col gap-0.5"
      >
        <HookRail
          from={hoverFrom}
          y={hoverY}
          visible={(pointerInside || focusInside) && hoverIndex !== activeIndex}
          dashed={dashed}
          className="text-foreground/30"
        />
        <HookRail
          y={activeY}
          visible={activeY !== null}
          color={color}
          dashed={dashed}
        />

        {items.map((item, index) => {
          const isActive = index === activeIndex;
          const setRef = (el: HTMLElement | null): void => {
            itemRefs.current[index] = el;
          };
          return (
            <Fragment key={item.id}>
              {item.dividerBefore && <div className="settings-nav-divider" role="separator" />}
              <button
                type="button"
                data-slot="hook-sidebar-item"
                data-active={isActive}
                ref={setRef}
                onMouseEnter={() => {
                  setHoverIndex(index);
                  setPointerInside(true);
                }}
                onFocus={() => {
                  setHoverIndex(index);
                  setFocusInside(true);
                }}
                onBlur={() => setFocusInside(false)}
                onClick={() => select(index)}
                className={cn(
                  "rounded-lg py-1.5 pl-5 pr-2 text-left text-sm transition-colors duration-200 motion-reduce:transition-none",
                  isActive
                    ? "text-foreground"
                    : "text-foreground/50 hover:text-foreground/80",
                )}
              >
                {item.label}
              </button>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}

