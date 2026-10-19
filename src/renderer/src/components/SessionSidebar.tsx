/**
 * 侧栏常驻会话列表（UI P3-1）。
 *
 * 取代原 topbar session-menu（悬停下拉只显 10 条）与 allSessionsOpen
 * 模态弹层——会话常驻可见，切换一步直达。
 *
 * R56：可收窄成图标轨（56px）——头部折叠按钮 ⇄ 轨道展开按钮，状态存
 * localStorage（与主题缓存同源同防御姿势）；收窄后会话以图标+tooltip
 * 呈现，新建/设置同为图标钮，active 高亮保留。
 *
 * v2（展开态视觉重做）：新建会话改实底 accent 主按钮；列表加"会话"
 * 小节标签；日期并入标题行右端（hover 时与 ⋯ 按钮做淡入淡出互换，不再
 * 为删除键预留整列）；删除收进每行的 ⋯ 更多菜单（两步确认在菜单内完成）；
 * 选中态加 3px 左指示条；预览 12px/text-2（修浅色对比度 3.51:1 不达标）。
 */
import { useEffect, useState } from "react";
import { MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Settings, Trash2 } from "lucide-react";

const COLLAPSED_KEY = "secagent.sidebar.collapsed";

export function SessionSidebar({ sessions, activeId, onSwitch, onDelete, onNew, onOpenSettings }: { sessions: SessionMeta[]; activeId?: string; onSwitch: (id: string) => void; onDelete: (id: string) => void; onNew: () => void; onOpenSettings: () => void }) {
  const [collapsed, setCollapsed] = useState(() => { try { return window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } });
  useEffect(() => { try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* 隐私模式等场景忽略 */ } }, [collapsed]);

  // 展开态 ⋯ 菜单：同一时间只开一个；confirming 为菜单内两步确认态。
  const [menu, setMenu] = useState<{ id: string; confirming: boolean } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".sidebar-item.menu-open")) setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

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
    <p className="sidebar-section-label">会话</p>
    <div className="sidebar-list" role="list">
      {sessions.length === 0 && <p className="sidebar-empty">还没有会话</p>}
      {sessions.map((item, index) => {
        const menuOpen = menu?.id === item.id;
        // 列表底部两项菜单向上展开，避免被滚动容器裁掉。
        const menuUp = sessions.length > 3 && index >= sessions.length - 2;
        return <div className={`sidebar-item ${item.id === activeId ? "active" : ""}${menuOpen ? " menu-open" : ""}`} role="listitem" key={item.id}>
          <button className="sidebar-item-main" type="button" onClick={() => onSwitch(item.id)} title={item.title}>
            <span className="sidebar-row1">
              <span className="sidebar-item-title">{item.title}</span>
              <span className="sidebar-meta"><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</time></span>
            </span>
            {item.preview && <span className="sidebar-item-preview">{item.preview}</span>}
          </button>
          <button
            className="sidebar-more"
            type="button"
            aria-label={`会话 ${item.title} 的更多操作`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="更多操作"
            onClick={() => setMenu(menuOpen ? null : { id: item.id, confirming: false })}
          ><MoreHorizontal size={15} aria-hidden /></button>
          {menuOpen && <div className={`sidebar-menu${menuUp ? " up" : ""}`} role="menu" aria-label={`会话 ${item.title} 的操作`}>
            {menu.confirming ? <>
              <p className="sidebar-menu-confirm-text">删除该会话？</p>
              <div className="sidebar-menu-confirm-row">
                <button type="button" className="sidebar-menu-del" onClick={() => { setMenu(null); onDelete(item.id); }}>删除</button>
                <button type="button" className="sidebar-menu-cancel" onClick={() => setMenu({ id: item.id, confirming: false })}>取消</button>
              </div>
            </> : <button type="button" className="sidebar-menu-item danger" role="menuitem" onClick={() => setMenu({ id: item.id, confirming: true })}>
              <Trash2 size={13} aria-hidden /> 删除会话
            </button>}
          </div>}
        </div>;
      })}
    </div>
    <div className="sidebar-foot">
      <button className="sidebar-settings" type="button" onClick={onOpenSettings}><Settings size={14} aria-hidden /> 设置</button>
    </div>
  </aside>;
}
