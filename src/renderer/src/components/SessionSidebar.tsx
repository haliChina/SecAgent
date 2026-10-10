/**
 * 侧栏常驻会话列表（UI P3-1）。
 *
 * 取代原 topbar session-menu（悬停下拉只显 10 条）与 allSessionsOpen
 * 模态弹层——会话常驻可见，切换一步直达。
 * 交互语言与原 modal 一致：active 高亮（--accent-soft）、预览一行
 * 截断、DeleteButton 悬停浮现、相对时间。
 */
import { DeleteButton } from "./ui/Bits.js";

export function SessionSidebar({ sessions, activeId, onSwitch, onDelete, onNew, onOpenSettings }: { sessions: SessionMeta[]; activeId?: string; onSwitch: (id: string) => void; onDelete: (id: string) => void; onNew: () => void; onOpenSettings: () => void }) {
  return <aside className="session-sidebar" aria-label="会话列表">
    <button className="sidebar-new" type="button" onClick={onNew}>+ 新建会话</button>
    <div className="sidebar-list" role="list">
      {sessions.length === 0 && <p className="sidebar-empty">还没有会话</p>}
      {sessions.map((item) => <div className={`sidebar-item ${item.id === activeId ? "active" : ""}`} role="listitem" key={item.id}>
        <button className="sidebar-item-main" type="button" onClick={() => onSwitch(item.id)} title={item.title}>
          <span className="sidebar-item-title">{item.title}</span>
          {item.preview && <span className="sidebar-item-preview">{item.preview}</span>}
        </button>
        <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</time>
        <DeleteButton ariaLabel={`删除会话 ${item.title}`} onConfirm={() => onDelete(item.id)} />
      </div>)}
    </div>
    <div className="sidebar-foot">
      <button className="sidebar-settings" type="button" onClick={onOpenSettings}>设置</button>
    </div>
  </aside>;
}
