/**
 * HookSidebar（R102）— 设置页侧导航：分叉树形菜单（branched-menu）。
 *
 * 逐行移植自 Uiverse.io by ashif_6672（stale-bulldog-96）：
 *   https://uiverse.io/ashif_6672/stale-bulldog-96
 * MIT License · Copyright 2026 ashif_6672 (Ashif)——许可全文见根目录 NOTICE。
 *
 * 原作观感：左缘一条树干（渐隐底线），每个条目一段圆弧分支从树干引出；
 * 选中项的分支以描线动画「生长」点亮（stroke-dashoffset 展开），组头可
 * 折叠（grid 0fr↔1fr），组内有选中项时左缘 marker 常亮。
 *
 * 适配本项目（相对原作的技术偏差，行为保持一致）：
 *  - styled-components → styles.css（.branched-menu__* 类名原样保留，
 *    颜色 token 映射 --text-1/--accent/--line，深浅色主题自动跟随）；
 *  - radio/checkbox hack → React 受控（activeId/onSelect + openGroups），
 *    :has() 选择器不再需要，键盘可达性用原生 button；
 *  - 固定 4 项 × 156px 的 SVG → 动态项数：分支 path 按条目序号生成，
 *    以 pathLength="1" 归一化——dasharray/dashoffset 恒为 1，免去原作
 *    手算每条路径长度（37.71/73.71/…）的维护负担；
 *  - 条目数 = 组内 items 实时长度，树高同步 = n*36+12。
 *
 * 健壮性（真机事故沉淀，勿删）：
 *  - 调用方 items 必须 `?? []` 兜底：IPC 运行时数据缺字段时裸 .map
 *    会让整棵设置窗 React 树崩溃（R6 真机白屏）；
 *  - activeId 不在列表时不高亮任何项、reach 不展开（防误报首项）；
 *  - prefers-reduced-motion：描线与折叠动画全关，颜色语义不变。
 */
import { useState } from "react";
import clsx from "clsx";
import type { ReactNode } from "react";

const cn = clsx;

export interface HookSidebarItem {
  id: string;
  label: string;
  /** 可选 16px 图标；随条目颜色一起变浅/变实。 */
  icon?: ReactNode;
  /** 组标签（仅每组首项设置）：渲染可折叠组头。 */
  group?: string;
}

const ROW = 36; /* 每条目占用高度（CSS --bm-row 同值） */
const TREE_PAD = 12; /* 树容器上下 padding 合计（CSS 6px×2） */

/** 分支 path：从树干顶部下行到第 index 项的圆弧拐点再水平引出。
 *  与原作同构（M 14 0 V … A 10 10 0 0 0 24 … H 32）。 */
function branchPath(index: number): string {
  const y = 14 + ROW * index;
  return `M 14 0 V ${y} A 10 10 0 0 0 24 ${y + 10} H 32`;
}

export function HookSidebar({ activeId, items, onSelect }: {
  activeId: string;
  items: HookSidebarItem[];
  onSelect: (id: string) => void;
}) {
  const safeItems = items ?? [];
  /* 分组：group 字段开启新组；无 group 的连续条目并入「通用」段。 */
  const sections: { label: string | null; entries: { item: HookSidebarItem; index: number }[] }[] = [];
  for (const item of safeItems) {
    const last = sections.at(-1);
    if (item.group || !last || last.label !== null) sections.push({ label: item.group ?? null, entries: [{ item, index: 0 }] });
    else last.entries.push({ item, index: last.entries.length });
  }
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (label: string | null) => {
    const key = label ?? "";
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <nav className="branched-menu" data-slot="hook-sidebar">
      {sections.map((section) => {
        const open = !closed.has(section.label ?? "");
        const activeIndex = section.entries.findIndex((entry) => entry.item.id === activeId);
        const hasActive = activeIndex !== -1;
        const treeHeight = section.entries.length * ROW + TREE_PAD;
        return (
          <div
            key={section.label ?? "_ungrouped"}
            className="branched-menu__section"
            data-open={open || undefined}
            data-has-active={hasActive || undefined}
          >
            {section.label !== null && (
              <button
                type="button"
                className="branched-menu__head"
                aria-expanded={open}
                onClick={() => toggle(section.label)}
              >
                {section.label}
              </button>
            )}
            {/* 折叠组头隐藏时的占位行（保持组间节奏与左缘线连续感）。 */}
            {section.label === null && <span className="branched-menu__head branched-menu__head--static" aria-hidden />}

            <div className="branched-menu__body" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
              <div className="branched-menu__fold">
                <div className="branched-menu__tree" style={{ height: treeHeight }}>
                  <svg className="branched-menu__lines" width={40} height={treeHeight} aria-hidden="true" viewBox={`0 0 40 ${treeHeight}`}>
                    {/* 树干：到组内最后一项的拐点（原作 M 14 0 V 122 同构）。 */}
                    <path className="branched-menu__base" d={`M 14 0 V ${14 + ROW * (section.entries.length - 1)}`} />
                    {/* 底层全部分支（灰）。 */}
                    {section.entries.map((entry) => (
                      <path key={`b-${entry.item.id}`} className="branched-menu__base" d={branchPath(entry.index)} />
                    ))}
                    {/* 选中分支的描线层（accent）：pathLength 归一化，dash 1→0 生长。 */}
                    {section.entries.map((entry) => (
                      <path
                        key={`r-${entry.item.id}`}
                        className="branched-menu__reach"
                        d={branchPath(entry.index)}
                        pathLength={1}
                        data-active={entry.item.id === activeId || undefined}
                      />
                    ))}
                  </svg>

                  {section.entries.map((entry) => {
                    const active = entry.item.id === activeId;
                    return (
                      <button
                        key={entry.item.id}
                        type="button"
                        onClick={() => onSelect(entry.item.id)}
                        aria-current={active ? "page" : undefined}
                        className="branched-menu__item"
                        data-active={active || undefined}
                      >
                        {entry.item.icon && <span aria-hidden className="branched-menu__icon">{entry.item.icon}</span>}
                        <span className="branched-menu__label">{entry.item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
