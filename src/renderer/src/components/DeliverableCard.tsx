/**
 * 交付物卡片（UI P3-6）：本轮文件改动列表 + 行数统计。
 *
 * 数据只来自会话记录里的 toolCalls（write/edit），路径不从模型
 * prose 解析——prose 可以声称改了什么，记录才是事实。
 * 没有文件改动时整卡不渲染（null）。
 * issue #26 合并项：File 栏（WorkspaceFileStrip）不再在持久消息重复渲染，
 * 预览动作并入本卡——一个文件列表、预览/引用两个动作。
 */
import { AnimatedDetails } from "./AnimatedDetails.js";
import { collectFileChanges, splitPath } from "../deliverable.js";

export function DeliverableCard({ toolCalls, onQuote, onPreview, onReveal }: { toolCalls?: Array<{ name: string; arguments?: unknown; result?: unknown }>; onQuote?: (path: string) => void; onPreview?: (path: string) => void; onReveal?: (path: string) => void }) {
  const changes = collectFileChanges(toolCalls);
  if (!changes.length) return null;
  const totals = changes.reduce((sum, change) => ({ additions: sum.additions + change.additions, deletions: sum.deletions + change.deletions }), { additions: 0, deletions: 0 });
  return <AnimatedDetails className="deliverable-card" summary={<><span className="deliverable-title">交付物</span><span className="deliverable-count">{changes.length} 个文件</span><span className="deliverable-stat"><span className="deliverable-add">+{totals.additions}</span><span className="deliverable-del">-{totals.deletions}</span></span><img className="details-chevron" src="/session-chevron.svg" alt="" /></>}>
    <ul className="deliverable-list">
      {changes.map((change) => {
        const { name, dir } = splitPath(change.path);
        return <li key={change.path} className="deliverable-item" title={change.path}>
          <span className="deliverable-path"><strong>{name}</strong>{dir ? <em>{dir}</em> : null}</span>
          <span className="deliverable-badge">{change.writes > 0 && `${change.writes} 写入`}{change.writes > 0 && change.edits > 0 ? " · " : ""}{change.edits > 0 && `${change.edits} 编辑`}</span>
          {onPreview && <button type="button" className="deliverable-quote" title="预览这个文件" onClick={() => onPreview(change.path)}>预览</button>}
          {onReveal && <button type="button" className="deliverable-quote" title="在资源管理器中打开并定位" onClick={() => onReveal(change.path)}>定位</button>}
          {onQuote && <button type="button" className="deliverable-quote" title="把这个文件引用到输入框" onClick={() => onQuote(change.path)}>引用</button>}
          <span className="deliverable-stat"><span className="deliverable-add">+{change.additions}</span>{change.deletions > 0 && <span className="deliverable-del">-{change.deletions}</span>}</span>
        </li>;})}
    </ul>
  </AnimatedDetails>;
}
