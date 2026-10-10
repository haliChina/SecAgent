/**
 * 运行轨迹面板（B4 自 App.tsx 拆出；P3-2 升级版）。
 *
 * - 回合分组：user.request 开启新回合，组头显示事件数与组耗时
 * - 事件行：相对上一事件的时延（>0.1s 才显示），工具事件高亮
 * - 记录检查器：data 的 KV 摘要（长值截断）+ 原始 JSON
 * - 尾部跟随：新增事件时若原本贴底则继续贴底；用户上滚即停止
 * - in-flight：运行中面板头显示运行标记（诚实标记：面板只反映
 *   已收到的事件，不伪造进度）
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import { traceLabel, type TraceEvent } from "../constants.js";

interface TraceTurn {
  key: string;
  index: number;
  startedAt: number;
  events: Array<{ item: TraceEvent; gapMs: number }>;
}

function summarizeData(data: unknown): string | null {
  if (typeof data === "string") return `${data.length} 字符`;
  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (!entries.length) return null;
    return entries.map(([key, value]) => {
      const text = typeof value === "string" ? (value.length > 24 ? `${value.slice(0, 24)}…` : value) : Array.isArray(value) ? `${value.length} 项` : String(value);
      return `${key}: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`;
    }).slice(0, 4).join(" · ");
  }
  return null;
}

export function TracePanel({ activeTrace, isExecuting = false }: { activeTrace: TraceEvent[]; isExecuting?: boolean }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottom = useRef(true);

  const timelineTrace = useMemo(() => activeTrace.filter((item) => item.stage !== "model.output.delta"), [activeTrace]);

  // 回合分组：model.request（工具循环里每次模型请求）开新组；
  // 早于首个请求的事件（用户输入/工具发现等）归入第 0 组
  const turns = useMemo(() => {
    const result: TraceTurn[] = [];
    let current: TraceTurn | null = null;
    let previousAt = 0;
    for (const item of timelineTrace) {
      if (!current || item.stage === "model.request") {
        current = { key: `${item.sequence}-${item.stage}`, index: result.length, startedAt: Date.parse(item.at), events: [] };
        result.push(current);
        previousAt = Date.parse(item.at);
      }
      current.events.push({ item, gapMs: Math.max(0, Date.parse(item.at) - previousAt) });
      previousAt = Date.parse(item.at);
    }
    return result;
  }, [timelineTrace]);

  // 尾部跟随：贴底时新事件继续贴底，上滚后停跟
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [timelineTrace.length]);

  const onListScroll = () => {
    const list = listRef.current;
    if (!list) return;
    pinnedToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  };

  return <aside className="trace-panel">
    <div className="trace-heading"><p className="eyebrow">运行轨迹</p><h2>本轮与本会话事件{isExecuting && <span className="trace-live"><span className="trace-live-dot" aria-hidden="true" />运行中</span>}</h2></div>
    <div className="trace-list" ref={listRef} onScroll={onListScroll}>
      {activeTrace.length === 0 && <p className="trace-empty">发送消息后，模型请求、响应、工具调用和返回结果会实时显示并保存到会话目录。</p>}
      {turns.map((turn) => <section key={turn.key} className="trace-turn">
        <header className="trace-turn-head">
          <strong>{turn.index === 0 ? "准备" : `回合 ${turn.index}`}</strong>
          <span>{turn.events.length} 个事件{turn.events.length > 1 && ` · ${((Date.parse(turn.events.at(-1)!.item.at) - turn.startedAt) / 1000).toFixed(1)}s`}</span>
        </header>
        {turn.events.map(({ item, gapMs }) => <details key={`${item.sequence}-${item.stage}`} className={`trace-item ${item.stage.startsWith("mcp.tools/") ? "tool-event" : ""}`}>
          <summary><span className="trace-order">{item.sequence}</span><span>{traceLabel[item.stage] || item.stage}</span><time>{new Date(item.at).toLocaleTimeString()}{gapMs >= 100 ? ` · +${gapMs < 1000 ? `${Math.round(gapMs)}ms` : `${(gapMs / 1000).toFixed(1)}s`}` : ""}</time></summary>
          <div className="trace-data">
            {summarizeData(item.data) && <p className="trace-data-summary">{summarizeData(item.data)}</p>}
            <pre>{JSON.stringify(item.data, null, 2)}</pre>
          </div>
        </details>)}
      </section>)}
    </div>
  </aside>;
}
