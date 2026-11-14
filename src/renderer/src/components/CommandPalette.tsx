/**
 * R82 快速跳转面板（Ctrl/Cmd+P）。
 *
 * 目的：侧栏只能线性浏览，会话一多就难找；键盘用户可以不出输入区完成
 * 切会话 / 新建 / 开设置。搜索复用 filterActiveSessions（含拼音全拼与首字母）。
 *
 * 无障碍：焦点圈禁在输入框（combobox + aria-activedescendant），
 * ↑↓ 选择、↵ 执行、Esc 关闭；背景点击与 Esc 均可退出，关闭后焦点回到
 * 打开前的元素。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Bot, CornerDownLeft, MessageSquare, Plus, Search, Settings, Square, X, type LucideIcon } from "lucide-react";
import { filterActiveSessions } from "../session-navigation.js";

type PaletteEntry = {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
};

function shortcutLabel(platform: string): string {
  return platform === "darwin" ? "⌘P" : "Ctrl+P";
}

export function CommandPalette({
  open,
  onClose,
  sessions,
  activeId,
  platform,
  onSwitch,
  onNewSession,
  onOpenSettings,
  onOpenArchived,
  onFocusComposer,
  onStopReply,
  onReadAloud,
  onStopReading,
  onCustomCommand,
  running,
  customCommands
}: {
  open: boolean;
  onClose: () => void;
  sessions: SessionMeta[];
  activeId?: string;
  platform: string;
  onSwitch: (id: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  onOpenArchived: () => void;
  onFocusComposer: () => void;
  /* issue #26 合并项：原 PromptBar「/」命令并入本面板——统一一个功能列表入口。 */
  onStopReply: () => void;
  onReadAloud: () => void;
  onStopReading: () => void;
  onCustomCommand: (command: { name: string; prompt: string; description?: string }) => void;
  running?: boolean;
  customCommands: Array<{ name: string; prompt: string; description?: string }>;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActive(0);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      restoreFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  const modChar = platform === "darwin" ? "⌘" : "Ctrl+";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const actions = useMemo<PaletteEntry[]>(() => {
    const list: PaletteEntry[] = [
      { id: "action-new", label: "新建会话", hint: `${modChar}N`, icon: Plus, run: onNewSession },
      { id: "action-focus", label: "聚焦输入框", hint: `${modChar}K`, icon: CornerDownLeft, run: onFocusComposer }
    ];
    if (running) list.push({ id: "action-stop", label: "停止当前回复", icon: Square, run: onStopReply });
    list.push(
      { id: "action-read", label: "朗读最后一条回复", icon: Bot, run: onReadAloud },
      { id: "action-stop-read", label: "停止朗读", icon: Square, run: onStopReading },
      { id: "action-settings", label: "打开设置", hint: "账户 · 模型 · 语音", icon: Settings, run: onOpenSettings },
      { id: "action-archived", label: "已归档会话", hint: "恢复或清理", icon: Archive, run: onOpenArchived },
      /* 自定义命令沿用原「/」菜单语义：填入输入框，可补充参数后发送。 */
      ...customCommands
        .filter((command) => command.name.trim() && command.prompt.trim())
        .map((command) => ({
          id: `custom-${command.name}`,
          label: `/${command.name}`,
          hint: command.description || "自定义命令",
          icon: Bot,
          run: () => onCustomCommand(command)
        }))
    );
    if (!normalizedQuery) return list;
    return list.filter((entry) => `${entry.label} ${entry.hint || ""}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [modChar, normalizedQuery, onNewSession, onOpenSettings, onOpenArchived, onFocusComposer, onStopReply, onReadAloud, onStopReading, running, customCommands, onCustomCommand]);

  const matchedSessions = useMemo(() => {
    const matched = filterActiveSessions(sessions, query);
    return normalizedQuery ? matched.slice(0, 20) : matched.slice(0, 6);
  }, [sessions, query, normalizedQuery]);

  const grouped = useMemo(() => {
    const result: Array<{ key: string; label: string; entries: PaletteEntry[] }> = [];
    const sessionEntries: PaletteEntry[] = matchedSessions.map((session) => ({
      id: `session-${session.id}`,
      label: session.title || "未命名会话",
      hint: session.id === activeId ? "当前会话" : session.preview || "打开会话",
      icon: MessageSquare,
      run: () => onSwitch(session.id)
    }));
    if (actions.length) result.push({ key: "actions", label: query.trim() ? "操作" : "快捷操作", entries: actions });
    if (sessionEntries.length) result.push({ key: "sessions", label: query.trim() ? "会话" : "最近会话", entries: sessionEntries });
    return result;
  }, [actions, matchedSessions, activeId, onSwitch, query]);

  const flat = useMemo(() => grouped.flatMap((group) => group.entries), [grouped]);
  const safeActive = flat.length ? Math.min(active, flat.length - 1) : 0;

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [safeActive, open, query]);

  if (!open) return null;

  const execute = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onClose();
    entry.run();
  };

  const move = (delta: number) => {
    if (!flat.length) return;
    setActive((current) => (Math.min(current, flat.length - 1) + delta + flat.length) % flat.length);
  };

  let optionIndex = -1;
  return <div className="command-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="快速跳转">
      <div className="command-palette-input">
        <Search size={16} aria-hidden />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? `command-palette-option-${safeActive}` : undefined}
          aria-label="搜索会话或操作"
          placeholder="搜索会话，或输入命令…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
            else if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
            else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
            else if (event.key === "Enter") { event.preventDefault(); execute(flat[safeActive]); }
            else if (event.key === "Tab") { event.preventDefault(); }
          }}
        />
        {query ? <button className="command-palette-clear" type="button" aria-label="清空搜索" onClick={() => { setQuery(""); inputRef.current?.focus(); }}><X size={14} aria-hidden /></button> : <kbd>{shortcutLabel(platform)}</kbd>}
      </div>
      <div className="command-palette-list" id="command-palette-list" role="listbox" aria-label="搜索结果">
        {grouped.map((group) => <div className="command-palette-group" key={group.key}>
          <p className="command-palette-group-label" aria-hidden>{group.label}</p>
          {group.entries.map((entry) => {
            optionIndex += 1;
            const index = optionIndex;
            const Icon = entry.icon;
            return <button
              key={entry.id}
              id={`command-palette-option-${index}`}
              ref={index === safeActive ? activeRef : undefined}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === safeActive}
              className={`command-palette-item ${index === safeActive ? "active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => execute(entry)}
            >
              <span className="command-palette-icon"><Icon size={15} aria-hidden /></span>
              <span className="command-palette-copy"><strong>{entry.label}</strong>{entry.hint && <small>{entry.hint}</small>}</span>
              {index === safeActive && <span className="command-palette-enter" aria-hidden><CornerDownLeft size={13} /></span>}
            </button>;
          })}
        </div>)}
        {flat.length === 0 && <p className="command-palette-empty">没有匹配的会话或操作。<br /><small>试试标题、消息摘要或拼音首字母（如「kt」→ 课堂）。</small></p>}
      </div>
      <div className="command-palette-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>↵</kbd> 打开</span>
        <span><kbd>esc</kbd> 关闭</span>
      </div>
    </div>
  </div>;
}
