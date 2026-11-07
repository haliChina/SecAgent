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
 *  - 归档立即提交，统一从设置页的已归档列表恢复；
 *  - 已归档会话从底部「已归档」入口进入设置管理，可恢复。
 *
 * R68：菜单补「重命名」（用户点名三级操作之一）——行内输入框改题
 * （Electron 沙盒 prompt() 恒 null，不能用对话框），Enter 提交 / Esc
 * 取消 / 失焦提交；60 字符上限与 IPC 侧一致。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Archive, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PencilLine, Plus, Search, Settings, X } from "lucide-react";
import { FuseButton } from "./ui/Bits.js";
import { filterActiveSessions } from "../session-navigation.js";

const COLLAPSED_KEY = "secagent.sidebar.collapsed";

export function SessionSidebar({ sessions, activeId, onSwitch, onDelete, onArchive, onRename, onNew, onOpenSettings, onOpenArchived }: { sessions: SessionMeta[]; activeId?: string; onSwitch: (id: string) => void; onDelete: (id: string) => void; onArchive: (id: string, archived: boolean) => void; onRename: (id: string, title: string) => void; onNew: () => void; onOpenSettings: () => void; onOpenArchived: () => void }) {
  const [collapsed, setCollapsed] = useState(() => { try { return window.localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } });
  const [menu, setMenu] = useState<{ id: string } | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus) menuAnchor.current?.focus({ preventScroll: true });
    setMenu(null);
  };
  /* R68 重命名：menu.id 与 renameId 分开记——菜单里点「重命名」后菜单收起、
     该行切行内输入框；renameDraft 是受控草稿。 */
  const [renameState, setRenameState] = useState<{ id: string; draft: string } | null>(null);
  /* Esc/Enter 后输入框会卸载并触发 blur；旧闭包里的 draft 会把已取消的改名
     再次提交。用 ref 标记「本次重命名已结束」，blur 先查标记再决定是否提交。 */
  const renameDoneRef = useRef(false);
  useEffect(() => { try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* 隐私模式等场景忽略 */ } }, [collapsed]);

  /* 菜单坐标：fixed 定位挂 ⋯ 的屏幕位置，滚动容器不裁剪（R62 教训）。
     R73 溢出根治：①用真实渲染尺寸（旧估 150px < 实际 ~210px，靠底部的会话
     菜单向下溢出遮住设置钮/出屏）；②锚点贴近视口底部时整菜单向上翻转；
     ③视口尺寸/滚动变化时重算（菜单内 FuseButton 动画会改变高度——用
     ResizeObserver 同步，滚动监听保持贴锚点）。 */
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const placeMenu = () => {
    if (!menu || !menuAnchor.current) return;
    const rect = menuAnchor.current.getBoundingClientRect();
    const size = menuRef.current?.getBoundingClientRect();
    const height = size?.height ?? 216;
    const width = size?.width ?? 176;
    const gap = 6;
    const flipUp = rect.bottom + gap + height > window.innerHeight - 8 && rect.top - gap - height >= 8;
    setMenuPos({
      top: flipUp ? Math.max(8, rect.top - gap - height) : Math.max(8, Math.min(rect.bottom + gap, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
    });
  };
  useLayoutEffect(() => { placeMenu(); }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const observer = menuRef.current ? new ResizeObserver(() => placeMenu()) : null;
    if (observer && menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => { observer?.disconnect(); window.removeEventListener("resize", placeMenu); window.removeEventListener("scroll", placeMenu, true); };
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const filtered = filterActiveSessions(sessions, query);
  const archived = sessions.filter((item) => item.archived);

  if (collapsed) {
    /* R72 缩小态定调（用户：简洁美观不臃肿）——不渲染会话列表与已归档区，
       只留 展开侧栏 / 新建 / 设置 三键；切会话先展开侧栏。
       动效：rail-pop stagger 弹入、宽度过渡、按钮 hover 微动（styles.css）。 */
    return <aside className="session-sidebar collapsed" aria-label="会话侧栏（已收窄）">
      <div className="sidebar-rail-top">
        <button className="sidebar-rail-button" type="button" onClick={() => setCollapsed(false)} aria-label="展开会话侧栏" title="展开侧栏（显示会话列表）"><PanelLeftOpen size={17} aria-hidden /></button>
        <button className="sidebar-rail-button accent" type="button" onClick={onNew} aria-label="新建会话" title="新建会话"><Plus size={17} aria-hidden /></button>
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
    <div className="sidebar-search">
      <label htmlFor="session-search">搜索会话</label>
      <div className="sidebar-search-field"><Search size={14} aria-hidden /><input id="session-search" ref={searchRef} type="search" value={query} placeholder="标题或消息摘要" onChange={(event) => setQuery(event.target.value)} />
        {query && <button type="button" aria-label="清空会话搜索" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={14} aria-hidden /></button>}
      </div>
    </div>
    {filtered.length === 0 && <p className="sidebar-empty">{query.trim() ? "没有匹配的会话，试试其他关键词。" : archived.length ? "暂无未归档会话" : "还没有会话"}</p>}
    <span className="sidebar-section-label">会话</span>
    <div className="sidebar-list" role="list" aria-label="未归档会话">
      {filtered.map((item) => {
        const renaming = renameState?.id === item.id;
        return <div className={`sidebar-item ${item.id === activeId ? "active" : ""} ${menu?.id === item.id ? "menu-open" : ""} ${renaming ? "renaming" : ""}`} role="listitem" key={item.id} onContextMenu={(event) => { if (renaming) return; event.preventDefault(); setMenu((current) => current?.id === item.id ? null : { id: item.id }); }}>
          {renaming ? (
            /* R68 行内重命名：Enter 提交 / Esc 取消 / 失焦提交（空值回退原题）。 */
            <input
              className="sidebar-rename-input"
              value={renameState.draft}
              maxLength={60}
              autoFocus
              aria-label={`重命名会话 ${item.title}`}
              onChange={(event) => setRenameState({ id: item.id, draft: event.target.value })}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  const next = renameState.draft.trim();
                  renameDoneRef.current = true;
                  setRenameState(null);
                  if (next && next !== item.title) onRename(item.id, next);
                  // 改名后若不再匹配搜索，行会被移除；直接回到稳定的搜索入口。
                  const leavesResults = next && !filterActiveSessions([{ ...item, title: next }], query).length;
                  requestAnimationFrame(() => (leavesResults ? searchRef.current : rowRefs.current.get(item.id) ?? searchRef.current)?.focus());
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  renameDoneRef.current = true;
                  setRenameState(null);
                  requestAnimationFrame(() => rowRefs.current.get(item.id)?.focus());
                }
              }}
              onBlur={() => {
                if (renameDoneRef.current) {
                  renameDoneRef.current = false;
                  return;
                }
                const next = renameState.draft.trim();
                setRenameState(null);
                if (next && next !== item.title) onRename(item.id, next);
              }}
            />
          ) : (
            <button className="sidebar-item-main" type="button" ref={(element) => { if (element) rowRefs.current.set(item.id, element); else rowRefs.current.delete(item.id); }} aria-current={item.id === activeId ? "true" : undefined} onClick={() => onSwitch(item.id)} title={item.title}>
              <span className="sidebar-item-title">{item.title}</span>
              {item.preview && <span className="sidebar-item-preview">{item.preview}</span>}
            </button>
          )}
          <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</time>
          <button className="sidebar-more" type="button" ref={menu?.id === item.id ? menuAnchor : undefined} aria-label={`更多操作（会话 ${item.title}）`} aria-controls={menu?.id === item.id ? "session-actions" : undefined} aria-expanded={menu?.id === item.id} onClick={() => setMenu((current) => current?.id === item.id ? null : { id: item.id })}><MoreHorizontal size={15} aria-hidden /></button>
        </div>;
      })}
    </div>
    {archived.length > 0 && <div className="sidebar-archived">
      {/* R73：归档管理迁设置页（用户提议）——侧栏只留紧凑入口行，不再铺 47 条挤爆侧栏。 */}
      <button className="sidebar-archived-toggle" type="button" onClick={onOpenArchived} title="在设置中管理已归档会话">
        <span>已归档（{archived.length}）</span>
        <span className="sidebar-archived-chevron" aria-hidden>›</span>
      </button>
    </div>}
    <div className="sidebar-foot">
      <button className="sidebar-settings" type="button" onClick={onOpenSettings}><Settings size={14} aria-hidden /> 设置</button>
    </div>
    {menu && <>
      <div className="sidebar-menu-backdrop" onClick={() => setMenu(null)} aria-hidden />
      <div key={menu.id} id="session-actions" className="sidebar-menu" role="group" aria-label="会话操作" ref={menuRef} style={{ top: menuPos.top, left: menuPos.left }} onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== menuAnchor.current) closeMenu(); }}>
        <div className="sidebar-menu-row">
          <button className="sidebar-menu-rename" type="button" onClick={() => { const target = sessions.find((entry) => entry.id === menu.id); renameDoneRef.current = false; setRenameState({ id: menu.id, draft: target?.title ?? "" }); setMenu(null); }}><PencilLine size={15} aria-hidden /> 重命名</button>
        </div>
        <div className="sidebar-menu-row">
          <button className="sidebar-menu-rename" type="button" onClick={() => { onArchive(menu.id, true); closeMenu(); searchRef.current?.focus(); }}><Archive size={15} aria-hidden /> 归档会话</button>
        </div>
        <div className="sidebar-menu-row">
          <FuseButton className="sidebar-menu-fuse danger" label="删除会话" undoLabel="反悔（保留）" doneLabel="已删除" fuse="outline" fuseColor="var(--danger)" commitOn="fuseEnd" settle="stay" onFuseEnd={() => { onDelete(menu.id); closeMenu(); searchRef.current?.focus(); }} onUndo={() => {}} />
        </div>
        <p className="sidebar-menu-hint">删除在引线烧完（约 4 秒）才执行，期间可反悔；归档后可在设置中恢复。</p>
      </div>
    </>}
  </aside>;
}
