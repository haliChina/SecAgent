/**
 * HookSidebar（R101 重设计）— 设置页侧导航，shadcn/ui Sidebar Menu 风格。
 *
 * 原实现为 rareui 钩式轨道（1px 虚线 + SVG 圆弧钩，靠 offsetTop 手动测量）；
 * 用户点名换 uiverse card（ashif_6672/stale-bulldog-96）——素材未能抵达
 * （上传丢失 + Cloudflare 拦截），按用户授权的 fallback 方案套 shadcn/ui。
 *
 * 设计（对齐 shadcn/ui 设计语言）：
 *  - 每项一枚圆角条目（卡片式），hover 态 --accent-soft 微光背景；
 *  - 选中态：accent-soft 背景 + accent 文字 + 左缘 3px 圆角指示条；
 *  - 指示条用 motion layoutId 共享布局动画在条目间平滑滑动——**取代旧的
 *    offsetTop 手动测量**（layout 动画在真实布局稳定后自动重测，天然免疫
 *    「设置窗 hidden 创建时 width=0、offsetTop 全塌 0」的老事故，R24/R30
 *    沉淀的双 rAF 兜底与逐按钮 ResizeObserver 不再需要）；
 *  - 分组标签：小号、大写字距（shadcn SidebarGroupLabel 观感），组间距留白。
 *
 * 健壮性（真机事故沉淀，勿删）：
 *  - activeId 不在列表时不渲染指示条、不高亮首项（防误报「当前在第一项」）；
 *  - 调用方 items 必须 `?? []` 兜底：IPC 运行时数据缺字段时裸 .map 会让
 *    整棵设置窗 React 树崩溃（R6 真机白屏，tsc 捕获不到）；
 *  - prefers-reduced-motion：指示条直接跳位（无滑动动画），颜色语义不变。
 *
 * Tailwind 工具类依赖 styles.css 顶部 @layer base 的 button reset
 * （2c426e6 修复，reset 关进 base 层防吃工具类）。
 */
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import clsx from "clsx";

/** rare-ui 的 cn 为 twMerge(clsx(...))；本项目无 Tailwind 类冲突合并需求，clsx 等价 */
const cn = clsx;

export interface HookSidebarItem {
  id: string;
  label: string;
  /** 可选 16px 图标（lucide 等）；选中/悬停时颜色随文字强调。 */
  icon?: ReactNode;
  /** 组标签（仅每组首项设置）：该项之前渲染一行小标题（shadcn 分组标签观感）。 */
  group?: string;
}

export function HookSidebar({ activeId, items, onSelect }: {
  activeId: string;
  items: HookSidebarItem[];
  onSelect: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const slide = reduced
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 420, damping: 34 };

  /* 按 group 切组：组标签渲染在组首，组间距留白。 */
  const sections: { label: string | null; entries: { item: HookSidebarItem; index: number }[] }[] = [];
  items.forEach((item, index) => {
    if (sections.length === 0 || item.group) sections.push({ label: item.group ?? null, entries: [] });
    sections[sections.length - 1].entries.push({ item, index });
  });

  return (
    <nav data-slot="hook-sidebar" aria-label="设置导航" className="flex flex-col gap-4">
      {sections.map((section, sectionIndex) => (
        <div key={section.label ?? `section-${sectionIndex}`} className="flex flex-col gap-1">
          {section.label && (
            <span className="hook-sidebar-group-label">{section.label}</span>
          )}
          {section.entries.map(({ item }) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "hook-sidebar-item",
                  active && "hook-sidebar-item-active"
                )}
              >
                {/* 选中指示条：layoutId 共享布局动画——同 id 的元素换位置时
                    motion 自动补间飞行轨迹，无需手动测量任何坐标。 */}
                {active && (
                  <motion.span
                    aria-hidden
                    layoutId="hook-sidebar-indicator"
                    transition={slide}
                    className="hook-sidebar-indicator"
                  />
                )}
                {item.icon && <span aria-hidden className="hook-sidebar-icon">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
