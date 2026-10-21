/**
 * 侧栏常驻会话列表（UI P3-1）。
 *
 * R56：可收窄成图标轨（56px），状态存 localStorage；收窄后会话以
 * 图标+tooltip 呈现。
 *
 * R65 操作重做（用户点名）：删除/归档收进行尾「⋯ 更多」菜单——
 *  - 菜单 position: fixed + getBoundingClientRect 定位（R62 版绝对定位
 *    在滚动容器内被裁剪/遮盖内容的教训）；
 *  - 删除 = FuseButton commitOn:"fuseEnd"（烧完才真删，4 秒反悔窗，
 *    react-bits Micro/FuseButton 移植），Undo 直接取消；
 *  - 归档 = FuseButton commitOn:"press"（立即归档，fuse 期间可撤销）；
 *  - 已归档会话收进底部「已归档」折叠区，可恢复。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArchiveRestore, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Settings } from "lucide-react";
import { FuseButton } from "./ui/Bits.js";

const COLLAPSED_KEY = "secagent.sidebar.collapsed";

export function SessionSidebar({ sessions, activeId, onSwitch, onDelete, onArchive, onNew, onOpenSettings }: { sessions: SessionMeta[]; activeId?: string; onSwitch: (id: string) => void; onDelete: (id: string) => void; onArchive: (id: string, archived: boolean) => void; onNew: () => void; onOpenSettings: () => void }) {
  const [collapsed, setCollapsed] = useState(() => { try { return window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } });
  const [menu, setMenu] = useState<{ id: string } | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  useEffect(() => { try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* 隐私模式等场景忽略 */ } }, [collapsed]);

  /* 菜单坐标：fixed 定位挂 ⋯ 的屏幕位置，滚动容器不裁剪（R62 教训）。 */
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!menu || !menuAnchor.current) return;
    const rect = menuAnchor.current.getBoundingClientRect();
    const height = 150;
    const width = 172;
    setMenuPos({
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const live = sessions.filter((item) => !item.archived);
  const archived = sessions.filter((item) => item.archived);

  if (collapsed) {
    return <aside className="session-sidebar collapsed" aria-label="会话列表（已收窄）">
      <div className="sidebar-rail-top">
        <button className="sidebar-rail-button" type="button" onClick={() => setCollapsed(false)} aria-label="展开会话侧栏" title="展开侧栏（显示会话名与预览）"><PanelLeftOpen size={17} aria-hidden /></button>
        <button className="sidebar-rail-button accent" type="button" onClick={onNew} aria-label="新建会话" title="新建会话"><Plus size={17} aria-hidden /></button>
      </div>
      <div className="sidebar-list" role="list">
        {live.map((item) => <div className={`sidebar-item rail ${item.id === activeId ? "active" : ""}`} role="listitem" key={item.id}>
          <button className={`sidebar-rail-session ${item.id === activeId ? "active" : ""}`} type="button" onClick={() => onSwitch(item.id)} aria-label={`会话 ${item.title}`} title={item.title}><MessageSquare size={17} aria-hidden /></button>
        </div>)}
      </div>
      <div className="sidebar-foot">
        <button className="sidebar-rail-button" type="button" onClick={onOpenSettings} aria-label="设置" title="设置"><Settings size={17} aria-hidden /></button>
      </div>
    </aside>;
  }
  return <aside className="session-sidebar" aria-label="会话列表">
    <div className="sidebar-head">
      <button className="sidebar-new" type="button" onClick={onNew}><Plus size={15} aria-hidden /> 新建会话</button>
      <button className="sidebar-collapse" type="button" onClick={() => setCollapsed(true)} aria-label="收窄会话侧栏" title="收窄成图标侧栏"><PanelLeftClose size={16} aria-hidden /></button>
    </div>
    <div className="sidebar-list" role="list">
      {live.length === 0 && <p className="sidebar-empty">还没有会话</p>}
      {live.map((item) => <div className={`sidebar-item ${item.id === activeId ? "active" : ""} ${menu?.id === item.id ? "menu-open" : ""}`} role="listitem" key={item.id}>
        <button className="sidebar-item-main" type="button" onClick={() => onSwitch(item.id)} title={item.title}>
          <span className="sidebar-item-title">{item.title}</span>
          {item.preview && <span className="sidebar-item-preview">{item.preview}</span>}
        </button>
        <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</time>
        <button className="sidebar-more" type="button" ref={menu?.id === item.id ? menuAnchor : undefined} aria-label={`更多操作（会话 ${item.title}）`} aria-haspopup="menu" aria-expanded={menu?.id === item.id} onClick={() => setMenu((current) => current?.id === item.id ? null : { id: item.id })}><MoreHorizontal size={15} aria-hidden /></button>
      </div>)}
    </div>
    {archived.length > 0 && <div className="sidebar-archived">
      <button className="sidebar-archived-toggle" type="button" onClick={() => setArchivedOpen((value) => !value)} aria-expanded={archivedOpen}>
        <span>已归档（{archived.length}）</span>
        <span className="sidebar-archived-chevron" data-open={archivedOpen ? "" : undefined} aria-hidden>▾</span>
      </button>
      {archivedOpen && <div className="sidebar-archived-list" role="list">
        {archived.map((item) => <div className="sidebar-item archived" role="listitem" key={item.id}>
          <span className="sidebar-item-title" title={item.title}>{item.title}</span>
          <button className="sidebar-archived-restore" type="button" onClick={() => onArchive(item.id, false)} aria-label={`恢复会话 ${item.title}`} title="恢复到列表"><ArchiveRestore size={14} aria-hidden /></button>
        </div>)}
      </div>}
    </div>}
    <div className="sidebar-foot">
      <button className="sidebar-settings" type="button" onClick={onOpenSettings}><Settings size={14} aria-hidden /> 设置</button>
    </div>
    {menu && <>
      <div className="sidebar-menu-backdrop" onClick={() => setMenu(null)} aria-hidden />
      <div className="sidebar-menu" role="menu" aria-label="会话操作" style={{ top: menuPos.top, left: menuPos.left }}>
        <div className="sidebar-menu-row" role="menuitem">
          <FuseButton className="sidebar-menu-fuse" label="归档会话" undoLabel="已撤销" doneLabel="已归档" fuse="outline" commitOn="press" settle="reset" onCommit={() => { onArchive(menu.id, true); setMenu(null); }} onUndo={() => onArchive(menu.id, false)} />
        </div>
        <div className="sidebar-menu-row" role="menuitem">
          <FuseButton className="sidebar-menu-fuse danger" label="删除会话" undoLabel="反悔（保留）" doneLabel="已删除" fuse="outline" fuseColor="#dc2626" commitOn="fuseEnd" settle="stay" onFuseEnd={() => { onDelete(menu.id); setMenu(null); }} onUndo={() => {}} />
        </div>
        <p className="sidebar-menu-hint">删除在引线烧完（约 4 秒）才执行，期间可反悔。</p>
      </div>
    </>}
  </aside>;
}
