/**
 * HookSidebar (rareui hooksidebar) — 设置页常驻钩式侧导航。
 *
 * 逐行直译自 swamimalode07/rare-ui components/ui/hook-sidebar.tsx：1px 虚线轨
 * （repeating-gradient）+ 12×7 SVG 圆弧钩，双轨（灰 hover / 彩 active）均 spring
 * 420/34/0.7 驱动 top/height。适配本项目：去 next 路由（usePathname/Link），
 * 受控 activeId 模式。注：items 仅支持 { id, label }（曾计划的 group/
 * dividerBefore 未实现，调用方勿传）。
 *
 * 健壮性（前几代真机事故沉淀，勿删）：
 *  - 设置窗常以 hidden 创建、ready-to-show 后才显示：首次布局时容器 width=0、
 *    按钮 offsetTop 全塌到 0，钩线会叠到第一项且 ResizeObserver 不再触发。
 *    measure 里 width===0 直接跳过，等 observer / 双 rAF 兜底测到真实位置（R24/R30）。
 *  - 逐按钮 observe：容器尺寸不变但按钮位置变化（字体晚到、隐藏→显示）时
 *    容器级 observer 不触发，故对每个按钮也 observe + 双 rAF 补测。
 *  - 调用方 settingsPages 必须 `?? []` 兜底：IPC 运行时数据缺字段时裸 .map
 *    会让整棵设置窗 React 树崩溃（R6 真机白屏，tsc/build 捕获不到）。
 *
 * Tailwind 工具类（text-foreground 等）依赖 styles.css 顶部 @layer base 声明
 * 把 button reset 关进 base 层，否则 reset 会吃掉工具类（见 2c426e6 修复）。
 */
import { ACCENT } from "./theme.js";
import { useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { clsx } from "clsx";

/** rare-ui 的 cn 为 twMerge(clsx(...))；本项目无 Tailwind 类冲突合并需求，clsx 等价 */
const cn = clsx;
const HK_CORNER = 6;
const HK_DASH = "repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)";

export interface HookSidebarItem {
  id: string;
  label: string;
}

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
        style={dashed ? { backgroundImage: HK_DASH } : { backgroundColor: "currentColor" }}
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
  items: HookSidebarItem[];
  onSelect: (id: string) => void;
}) {
  // active 轨颜色取主题 accent 蓝（原版默认 #FC4C01）；CSS var 不进 SVG，取 TS 真源
  const color = ACCENT;
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
      // 未布局完成时容器宽为 0、offsetTop 全塌到 0——跳过，等稳定后再测。
      if (list.getBoundingClientRect().width === 0) return;
      const next = itemRefs.current.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : null));
      if (next.length !== items.length || next.some((center) => center === null)) return;
      setCenters(next as number[]);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const el of itemRefs.current) if (el) observer.observe(el);
    const first = requestAnimationFrame(measure);
    const second = requestAnimationFrame(() => requestAnimationFrame(measure));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [items.length, items.map((item) => item.id).join("|")]);

  const activeY = activeIndex < 0 ? null : (centers[activeIndex] ?? null);
  const hoverY = hoverIndex === null ? null : (centers[hoverIndex] ?? null);

  // 悬停项在 active 项之上时，彩轨已覆盖该段，灰轨只画拐角钩
  const hoverFrom =
    activeY !== null && hoverY !== null && hoverY <= activeY
      ? Math.max(0, hoverY - HK_CORNER)
      : (activeY ?? 0);

  return (
    <nav data-slot="hook-sidebar" aria-label="设置导航" className="flex flex-col">
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
        <HookRail y={activeY} visible={activeY !== null} color={color} dashed={dashed} />

        {items.map((item, index) => {
          const isActive = index === activeIndex;
          const setRef = (el: HTMLElement | null): void => { itemRefs.current[index] = el; };
          return (
            <button
              key={item.id}
              type="button"
              data-slot="hook-sidebar-item"
              data-active={isActive}
              ref={setRef}
              onMouseEnter={() => { setHoverIndex(index); setPointerInside(true); }}
              onFocus={() => { setHoverIndex(index); setFocusInside(true); }}
              onBlur={() => setFocusInside(false)}
              onClick={() => onSelect(item.id)}
              className={cn(
                "rounded-lg py-1.5 pl-5 pr-2 text-left text-sm transition-colors duration-200 motion-reduce:transition-none",
                isActive ? "text-foreground" : "text-foreground/50 hover:text-foreground/80"
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
