/**
 * HookSidebar (rareui hooksidebar) — 设置页常驻钩式侧导航。
 *
 * 逐行直译自 swamimalode07/rare-ui components/ui/hook-sidebar.tsx：1px 虚线轨
 * （repeating-gradient）+ 12×7 SVG 圆弧钩，双轨（灰 hover / 彩 active）均 spring
 * 420/34/0.7 驱动 top/height。适配本项目：去 next 路由（usePathname/Link），
 * 受控 activeId 模式。
 *
 * 分组（R84）：每组一条独立轨道，线不跨组贯穿；分组标签在轨道左侧同一行，
 * 轨道从标签中线起笔，到组内的选中/悬停项收钩——文字和线首尾相接，不留空档。
 * 组与组之间留白，不连线。
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
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { clsx } from "clsx";

/** rare-ui 的 cn 为 twMerge(clsx(...))；本项目无 Tailwind 类冲突合并需求，clsx 等价 */
const cn = clsx;
const HK_CORNER = 6;
const HK_DASH = "repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)";

export interface HookSidebarItem {
  id: string;
  label: string;
  /** 可选 16px 图标（lucide 等）；随导航项颜色一起变浅/变实。 */
  icon?: ReactNode;
  /** 组标签（仅每组首项设置）：在该项之前渲染一行小标题，位置贴着左侧轨道。 */
  group?: string;
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
  const listRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [centers, setCenters] = useState<(number | null)[]>([]);
  const [starts, setStarts] = useState<number[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  /* activeId 不在列表时保持 -1：不把钩线静默钉在首项，避免误报「当前在第一项」。 */
  const activeIndex = items.findIndex((item) => item.id === activeId);

  /* 按 group 切组：每组一条独立轨道，线不跨组贯穿；标签作为组内首行，
     轨道从类别栏顶端起笔，到组内的选中/悬停项收钩。 */
  const sections: { label: string | null; entries: { item: HookSidebarItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    if (sections.length === 0 || item.group) sections.push({ label: item.group ?? null, entries: [] });
    sections[sections.length - 1].entries.push({ item, index });
  });

  useLayoutEffect(() => {
    const sectionsEls = sectionRefs.current.filter((el): el is HTMLDivElement => el !== null);
    if (!sectionsEls.length) return;
    const measure = () => {
      // 未布局完成时容器宽为 0、offsetTop 全塌到 0——跳过，等稳定后再测。
      if (sectionsEls.some((el) => el.getBoundingClientRect().width === 0)) return;
      const next = itemRefs.current.map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : null));
      if (next.length !== items.length || next.some((center) => center === null)) return;
      setCenters(next as number[]);
      // 组标签是一个小框：轨道从框的底边接出，与框左边框同一列，读作框线延续。
      setStarts(sectionRefs.current.map((_, index) => {
        const label = labelRefs.current[index];
        return label ? label.offsetTop + label.offsetHeight : 0;
      }));
    };

    measure();
    const observer = new ResizeObserver(measure);
    for (const el of sectionsEls) observer.observe(el);
    for (const el of itemRefs.current) if (el) observer.observe(el);
    for (const el of labelRefs.current) if (el) observer.observe(el);
    const first = requestAnimationFrame(measure);
    const second = requestAnimationFrame(() => requestAnimationFrame(measure));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [items.length, items.map((item) => `${item.group ?? ""}:${item.id}`).join("|")]);

  const centerOf = (index: number | undefined): number | null =>
    index === undefined ? null : (centers[index] ?? null);

  return (
    <nav data-slot="hook-sidebar" aria-label="设置导航" className="flex flex-col">
      {sections.map((section, sectionIndex) => {
        const activeEntry = section.entries.find((entry) => entry.index === activeIndex);
        const hoverEntry = hoverIndex === null ? undefined : section.entries.find((entry) => entry.index === hoverIndex);
        const activeY = centerOf(activeEntry?.index);
        const hoverY = centerOf(hoverEntry?.index);
        const showHover =
          hoverEntry !== undefined && hoverEntry.index !== activeIndex && (pointerInside || focusInside);
        const startY = starts[sectionIndex] ?? 0;
        const hoverAbove = showHover && hoverY !== null && activeY !== null && hoverY <= activeY;
        // 悬停项在活动项之上：灰轨从标签中线连到悬停点，彩轨从悬停点接续；
        // 在其下则相反——两段错开起笔，组内整根线保持连续且不重叠。
        const hoverFrom =
          showHover && hoverY !== null && activeY !== null && !hoverAbove
            ? Math.max(startY, activeY - HK_CORNER)
            : startY;
        const activeFrom = hoverAbove ? Math.max(startY, (hoverY ?? 0) - HK_CORNER) : startY;

        return (
          <div
            key={section.entries[0]?.item.id ?? sectionIndex}
            data-slot="hook-sidebar-section"
            ref={(el) => { sectionRefs.current[sectionIndex] = el; }}
            className={cn("relative", sectionIndex > 0 && "pt-3")}
          >
            {section.label ? (
              <span
                data-slot="hook-sidebar-group"
                ref={(el) => { labelRefs.current[sectionIndex] = el; }}
                className="relative z-[1] mb-1 ml-0.5 inline-flex items-center rounded-r-md border border-[var(--line)] bg-[var(--bg-1)] px-2 py-0.5 text-[11px] font-semibold tracking-[.04em] text-foreground/40"
              >
                {section.label}
              </span>
            ) : null}

            <HookRail
              from={hoverFrom}
              y={hoverY}
              visible={showHover}
              dashed={dashed}
              className="text-foreground/30"
            />
            <HookRail from={activeFrom} y={activeY} visible={activeY !== null} color={color} dashed={dashed} />

            <div
              ref={(el) => { listRefs.current[sectionIndex] = el; }}
              onMouseLeave={() => setPointerInside(false)}
              className="flex flex-col gap-0.5"
            >
              {section.entries.map(({ item, index }) => {
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
                      "flex items-center gap-2 rounded-lg py-1.5 pl-5 pr-2 text-left text-sm transition-colors duration-200 motion-reduce:transition-none",
                      isActive ? "text-foreground" : "text-foreground/50 hover:text-foreground/80"
                    )}
                  >
                    {item.icon ? (
                      <span className="flex h-4 w-4 flex-none items-center justify-center" aria-hidden="true">
                        {item.icon}
                      </span>
                    ) : null}
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
