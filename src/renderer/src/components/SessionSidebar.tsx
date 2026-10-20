/**
 * 侧栏常驻会话列表（UI P3-1）。
 *
 * 取代原 topbar session-menu（悬停下拉只显 10 条）与 allSessionsOpen
 * 模态弹层——会话常驻可见，切换一步直达。
 * 交互语言与原 modal 一致：active 高亮（--accent-soft）、预览一行
 * 截断、DeleteButton 悬停浮现、相对时间。
 *
 * R56：可收窄成图标轨（56px）——头部折叠按钮 ⇄ 轨道展开按钮，状态存
 * localStorage（与主题缓存同源同防御姿势）；收窄后会话以图标+tooltip
 * 呈现，新建/设置同为图标钮，active 高亮保留。
 */
import { useEffect, useState } from "react";
import { MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Settings } from "lucide-react";
import { DeleteButton } from "./ui/Bits.js";

const COLLAPSED_KEY = "secagent.sidebar.collapsed";

export function SessionSidebar({ sessions, activeId, onSwitch, onDelete, onNew, onOpenSettings }: { sessions: SessionMeta[]; activeId?: string; onSwitch: (id: string) => void; onDelete: (id: string) => void; onNew: () => void; onOpenSettings: () => void }) {
  const [collapsed, setCollapsed] = useState(() => { try { return window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } });
  useEffect(() => { try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* 隐私模式等场景忽略 */ } }, [collapsed]);

  if (collapsed) {
    return <aside className="session-sidebar collapsed" aria-label="会话列表（已收窄）">
      <div className="sidebar-rail-top">
        <button className="sidebar-rail-button" type="button" onClick={() => setCollapsed(false)} aria-label="展开会话侧栏" title="展开侧栏（显示会话名与预览）"><PanelLeftOpen size={17} aria-hidden /></button>
        <button className="sidebar-rail-button accent" type="button" onClick={onNew} aria-label="新建会话" title="新建会话"><Plus size={17} aria-hidden /></button>
      </div>
      <div className="sidebar-list" role="list">
        {sessions.map((item) => <div className={`sidebar-item rail ${item.id === activeId ? "active" : ""}`} role="listitem" key={item.id}>
          <button className="sidebar-rail-button wide" type="button" onClick={() => onSwitch(item.id)} title={item.title} aria-label={`切换到会话 ${item.title}`} aria-current={item.id === activeId || undefined}><MessageSquare size={15} aria-hidden /></button>
        </div>)}
      </div>
      <div className="sidebar-foot">
        <button className="sidebar-rail-button" type="button" onClick={onOpenSettings} aria-label="打开设置" title="设置"><Settings size={16} aria-hidden /></button>
      </div>
    </aside>;
  }

  return <aside className="session-sidebar" aria-label="会话列表">
    <div className="sidebar-head">
      <button className="sidebar-new" type="button" onClick={onNew}><Plus size={14} aria-hidden /> 新建会话</button>
      <button className="sidebar-collapse" type="button" onClick={() => setCollapsed(true)} aria-label="收窄会话侧栏" title="收窄成图标侧栏"><PanelLeftClose size={16} aria-hidden /></button>
    </div>
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
      <button className="sidebar-settings" type="button" onClick={onOpenSettings}><Settings size={14} aria-hidden /> 设置</button>
    </div>
  </aside>;
}
