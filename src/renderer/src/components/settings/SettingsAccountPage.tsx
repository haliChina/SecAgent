/**
 * R78 新「账户与通用」设置页（桌面版改写的手机端设置结构）。
 *
 * 与手机原稿的差异（桌面适配，已在 PR 说明）：
 * - 顶部返回箭头不需要：左侧 HookSidebar 已负责导航，只保留标题 + ⋯ 更多；
 * - 右侧纵向数据取真实数据（积分余额 / 可用模型），不虚构「评价数 / 加入年限」；
 * - 无 Avatar 组件：用主题 token 画的圆形首字母头像（无外部图片依赖）。
 *
 * 开关持久化：深色模式走既有 settings.theme（保存到工作区配置，双窗广播即时换肤，
 * 三态切换仍在「系统 → 界面主题」里保留）；「通知」暂存 localStorage 偏好。
 */
import { useEffect, useRef, useState } from "react";
import { CircleHelp, Info, LogOut, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { formatOfficialPoints } from "../../official-balance.js";
import { formatUpdateBytes } from "../SettingsFields.js";
import { SettingsConfirmDialog, SettingsGroup, SettingsInfoRow, SettingsLinkRow, SettingsSwitchRow, SettingsUserCard } from "./SettingPrimitives.js";

const PRIVACY_URL = "https://github.com/haliChina/SecAgent/blob/master/docs/privacy-policy.zh-CN.md";
const FEEDBACK_URL = "https://github.com/haliChina/SecAgent/issues";
const NOTIFY_STORAGE_KEY = "secagent:notifications";
/** 与 theme.ts 的 STORAGE_KEY 一致（首帧防闪烁缓存，属于偏好而非缓存）。 */
const THEME_STORAGE_KEY = "secagent-theme";

type AccountPageProps = {
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark") => void;
  version?: string;
  officialLoggedIn: boolean;
  officialEmail: string;
  points: number | null;
  modelCount: number;
  onNavigate: (page: string) => void;
  onOpenExternal: (url: string) => void;
  onLogout: () => Promise<void> | void;
};

function readNotifyPreference(): boolean {
  try { return window.localStorage.getItem(NOTIFY_STORAGE_KEY) !== "off"; } catch { return true; }
}

function writeNotifyPreference(enabled: boolean): void {
  try { window.localStorage.setItem(NOTIFY_STORAGE_KEY, enabled ? "on" : "off"); } catch { /* 隐私模式忽略 */ }
}

/** 缓存用量估算（renderer 侧 storage API；主进程 HTTP 缓存不计入）。 */
async function estimateCacheLabel(): Promise<string> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return formatUpdateBytes(estimate?.usage ?? 0);
  } catch {
    return "0 KB";
  }
}

export function SettingsAccountPage(props: AccountPageProps) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<"logout" | "cache" | null>(null);
  const [cacheLabel, setCacheLabel] = useState("计算中…");
  const [cacheBusy, setCacheBusy] = useState(false);
  const [notifications, setNotifications] = useState(readNotifyPreference);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refreshCacheLabel = async (): Promise<void> => setCacheLabel(await estimateCacheLabel());

  useEffect(() => { void refreshCacheLabel(); }, []);

  // 提示条自动消退，避免占位信息长期挂在页面上。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // ⋯ 菜单：点外部关闭。
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const darkActive = props.theme === "dark" || (props.theme === "system" && prefersDark);
  const accountName = props.officialLoggedIn && props.officialEmail ? props.officialEmail.split("@")[0] : "本地模式";
  const accountRole = props.officialLoggedIn
    ? `已登录 SECTL · ${props.officialEmail}`
    : "未登录 SECTL · 仅本地模型";
  const stats = [
    { value: props.officialLoggedIn && props.points !== null ? formatOfficialPoints(props.points) : "—", label: "积分余额" },
    { value: String(props.modelCount), label: "可用模型" }
  ];

  const toggleNotifications = (next: boolean): void => {
    setNotifications(next);
    writeNotifyPreference(next);
    setNotice(next ? "已开启通知偏好（系统通知渠道将在后续版本接入）。" : "已关闭通知偏好。");
  };

  const clearCache = async (): Promise<void> => {
    setCacheBusy(true);
    try {
      // 偏好不是缓存：清空前记下主题与通知开关，清完原样写回。
      let themeCache: string | null = null;
      let notifyPreference: string | null = null;
      try {
        themeCache = window.localStorage.getItem(THEME_STORAGE_KEY);
        notifyPreference = window.localStorage.getItem(NOTIFY_STORAGE_KEY);
      } catch { /* 忽略 */ }
      try { window.localStorage.clear(); } catch { /* 忽略 */ }
      try { window.sessionStorage.clear(); } catch { /* 忽略 */ }
      try {
        if (themeCache !== null) window.localStorage.setItem(THEME_STORAGE_KEY, themeCache);
        if (notifyPreference !== null) window.localStorage.setItem(NOTIFY_STORAGE_KEY, notifyPreference);
      } catch { /* 忽略 */ }
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      setNotifications(readNotifyPreference());
      await refreshCacheLabel();
      setNotice("缓存已清除。");
    } finally {
      setCacheBusy(false);
      setConfirmDialog(null);
    }
  };

  const logout = async (): Promise<void> => {
    await props.onLogout();
    setConfirmDialog(null);
    setNotice("已退出 SECTL 账号。");
  };

  type RowDefinition =
    | { kind: "link"; title: string; desc?: string; value?: string; onSelect: () => void; disabled?: boolean }
    | { kind: "switch"; title: string; desc?: string; checked: boolean; onChange: (next: boolean) => void }
    | { kind: "info"; title: string; desc?: string; value?: string };

  const groups: Array<{ label: string; rows: RowDefinition[] }> = [
    {
      label: "账号与偏好",
      rows: [
        { kind: "link", title: "账号与安全", desc: "登录状态、凭据与模型服务授权", value: props.officialLoggedIn ? "已登录" : "未登录", onSelect: () => props.onNavigate("settings-models") },
        { kind: "switch", title: "通知", desc: "保存桌面通知偏好；系统通知渠道接入后按此开关生效", checked: notifications, onChange: toggleNotifications },
        { kind: "switch", title: "深色模式", desc: "即时切换整个应用的深浅配色；「跟随系统」仍可在系统分区选择", checked: darkActive, onChange: (next) => props.onThemeChange(next ? "dark" : "light") },
        { kind: "link", title: "语言", desc: "界面与提示文案的语言", value: "简体中文", onSelect: () => setNotice("当前仅提供简体中文界面，多语言支持仍在规划中。") }
      ]
    },
    {
      label: "存储与数据",
      rows: [
        { kind: "link", title: "清除缓存", desc: "清空本地存储、会话缓存与站点缓存", value: cacheBusy ? "清理中…" : cacheLabel, onSelect: () => setConfirmDialog("cache"), disabled: cacheBusy }
      ]
    },
    {
      label: "关于与法律",
      rows: [
        { kind: "link", title: "隐私政策", desc: "数据采集范围与遥测说明", onSelect: () => props.onOpenExternal(PRIVACY_URL) },
        { kind: "link", title: "用户协议", desc: "使用条款与免责声明", onSelect: () => setNotice("用户协议页面尚未发布，发布后会在这里跳转。") },
        { kind: "link", title: "帮助与反馈", desc: "问题反馈与功能建议", onSelect: () => props.onOpenExternal(FEEDBACK_URL) },
        { kind: "info", title: "关于", desc: "SecAgent 桌面端", value: props.version ? `v${props.version}` : "读取中…" }
      ]
    }
  ];

  const keyword = query.trim().toLowerCase();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => !keyword || `${row.title} ${row.desc || ""}`.toLowerCase().includes(keyword))
    }))
    .filter((group) => group.rows.length > 0);
  const totalRows = groups.reduce((count, group) => count + group.rows.length, 0);

  const menuItems = [
    { icon: <RefreshCw aria-hidden />, label: "检查更新", run: () => { setMenuOpen(false); props.onNavigate("settings-updates"); } },
    { icon: <CircleHelp aria-hidden />, label: "反馈问题", run: () => { setMenuOpen(false); props.onOpenExternal(FEEDBACK_URL); } },
    { icon: <Info aria-hidden />, label: "关于 SecAgent", run: () => { setMenuOpen(false); setNotice(`SecAgent ${props.version ? `v${props.version}` : ""} · Electron 桌面端 · 设置页快捷键 Alt + 方向键`); } }
  ];

  return <>
    <div className="set-head">
      <div className="set-head-copy">
        <h2 className="set-head-title">设置</h2>
        <p className="set-head-sub">账号、外观与偏好集中在这里；左侧是全部设置分区。</p>
      </div>
      <div className="set-head-actions" ref={menuRef}>
        <button type="button" className="set-icon-button" aria-label="更多设置操作" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
          <MoreHorizontal size={18} aria-hidden />
        </button>
        {menuOpen && <div className="set-menu aui-pop-down" role="menu">
          {menuItems.map((item) => <button key={item.label} type="button" role="menuitem" onClick={item.run}>{item.icon}{item.label}</button>)}
        </div>}
      </div>
    </div>

    {totalRows > 5 && <label className="set-search">
      <Search aria-hidden />
      <input
        type="search"
        value={query}
        aria-label="搜索设置项"
        placeholder="搜索设置项"
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>}

    {notice ? <p className="set-notice" role="status">{notice}</p> : null}

    <SettingsUserCard name={accountName} role={accountRole} stats={stats} />

    {visibleGroups.map((group) => <SettingsGroup label={group.label} key={group.label}>
      {group.rows.map((row) => {
        if (row.kind === "switch") {
          return <SettingsSwitchRow key={row.title} title={row.title} desc={row.desc} checked={row.checked} onChange={row.onChange} />;
        }
        if (row.kind === "info") {
          return <SettingsInfoRow key={row.title} title={row.title} desc={row.desc} value={row.value} />;
        }
        return <SettingsLinkRow key={row.title} title={row.title} desc={row.desc} value={row.value} onSelect={row.onSelect} disabled={row.disabled} />;
      })}
    </SettingsGroup>)}

    {visibleGroups.length === 0 && <p className="set-notice">没有匹配「{query.trim()}」的设置项。</p>}

    <button type="button" className="set-danger" onClick={() => setConfirmDialog("logout")} disabled={!props.officialLoggedIn}>
      <LogOut aria-hidden />
      退出登录
    </button>

    <SettingsConfirmDialog
      open={confirmDialog === "cache"}
      title="清除缓存"
      message="将清空本地存储、会话缓存与站点缓存。已保存的配置与 API Key 位于工作区文件，不受影响。确定继续吗？"
      confirmLabel="清除"
      danger
      onCancel={() => setConfirmDialog(null)}
      onConfirm={() => void clearCache()}
    />
    <SettingsConfirmDialog
      open={confirmDialog === "logout"}
      title="退出登录"
      message="退出后自定义模型仍可用，但将无法调用官方服务与积分额度。确定退出 SECTL 账号吗？"
      confirmLabel="退出登录"
      danger
      onCancel={() => setConfirmDialog(null)}
      onConfirm={() => void logout()}
    />
  </>;
}
