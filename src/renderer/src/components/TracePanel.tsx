/**
 * 运行轨迹面板（B4 自 App.tsx 拆出）。
 *
 * P3-2「轨迹面板升级」（turn-aware 台账/记录检查器/尾部跟随）
 * 的落点文件；当前先做 1:1 搬运，行为零变化。
 */
import { useMemo } from "react";
import { traceLabel, type TraceEvent } from "../constants.js";

export function TracePanel({ activeTrace }: { activeTrace: TraceEvent[] }) {
  const timelineTrace = useMemo(() => activeTrace.filter((item) => item.stage !== "model.output.delta"), [activeTrace]);
  return <aside className="trace-panel">
    <div className="trace-heading"><p className="eyebrow">运行轨迹</p><h2>本轮与本会话事件</h2></div>
    <div className="trace-list">
      {activeTrace.length === 0 && <p className="trace-empty">发送消息后，模型请求、响应、工具调用和返回结果会实时显示并保存到会话目录。</p>}
      {timelineTrace.map((item) => <details key={`${item.sequence}-${item.stage}`} className={`trace-item ${item.stage.startsWith("mcp.tools/") ? "tool-event" : ""}`}>
        <summary><span className="trace-order">{item.sequence}</span><span>{traceLabel[item.stage] || item.stage}</span><time>{new Date(item.at).toLocaleTimeString()}</time></summary>
        <pre>{JSON.stringify(item.data, null, 2)}</pre>
      </details>)}
    </div>
  </aside>;
}
