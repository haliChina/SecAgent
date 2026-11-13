import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CircleAlert, CircleArrowUp, CircleCheck, Download, ExternalLink, MoreHorizontal, PackageOpen, Power, RefreshCw, Search, Trash2 } from "lucide-react";
import { pluginStateLabel } from "../utils.js";
import { pluginNavigationIndex } from "../plugin-navigation.js";

function latestMarketVersion(plugin?: MarketplacePlugin): MarketplaceVersion | undefined {
  return plugin?.latest;
}

export function PluginSettingsPanel({
  plugins,
  setPlugins,
  marketPlugins,
  setMarketPlugins,
  marketError,
  setMarketError
}: {
  plugins: PluginStatus[];
  setPlugins: (plugins: PluginStatus[]) => void;
  marketPlugins: MarketplacePlugin[];
  setMarketPlugins: (plugins: MarketplacePlugin[]) => void;
  marketError: string;
  setMarketError: (message: string) => void;
}) {
  const bridge = window.secagent;
  const categoryId = useId();
  const detailId = useId();
  const navigate = (event: KeyboardEvent<HTMLDivElement>, role: "tab" | "option", orientation: "horizontal" | "vertical") => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(`button[role="${role}"]:not(:disabled)`)];
    const current = items.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = pluginNavigationIndex(event.key, current, items.length, orientation);
    if (next === null) return;
    event.preventDefault();
    items[next].focus({ preventScroll: true });
    items[next].click();
    items[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const [category, setCategory] = useState<"installed" | "market">("installed");
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState("");
  const [detailTab, setDetailTab] = useState<"readme" | "error" | "details">("readme");
  const [marketLoading, setMarketLoading] = useState(false);
  const [operationId, setOperationId] = useState("");
  const [panelError, setPanelError] = useState("");
  const [updateNotice, setUpdateNotice] = useState("");
  const [updatingAll, setUpdatingAll] = useState(false);

  const refreshMarket = async () => {
    setMarketLoading(true);
    setMarketError("");
    try {
      setMarketPlugins(await bridge.listMarketplace());
    } catch (reason) {
      setMarketError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMarketLoading(false);
    }
  };

  useEffect(() => { void refreshMarket(); }, []);
  useEffect(() => {
    const source = category === "installed" ? plugins : marketPlugins;
    if (!selectedId || !source.some((plugin) => plugin.id === selectedId)) setSelectedId(source[0]?.id || "");
    setDetailTab("readme");
  }, [category, plugins, marketPlugins]);
  useEffect(() => { setUpdateNotice(""); setDetailTab("readme"); }, [selectedId, category]);

  const visiblePlugins = useMemo(() => {
    const keyword = filter.trim().toLocaleLowerCase();
    const source = category === "installed" ? plugins : marketPlugins;
    if (!keyword) return source;
    return source.filter((plugin) => `${plugin.name} ${plugin.id} ${plugin.description}`.toLocaleLowerCase().includes(keyword));
  }, [category, filter, marketPlugins, plugins]);
  const installed = plugins.find((plugin) => plugin.id === selectedId);
  const activeDetailTab = detailTab === "error" && installed?.state !== "error" ? "readme" : detailTab;
  const market = marketPlugins.find((plugin) => plugin.id === selectedId);
  const selected = category === "installed" ? installed : market;
  const selectedVersion = latestMarketVersion(market);
  const selectedReadme = installed?.readme || market?.readme || (market ? `# ${market.name}\n\n${market.description}\n\n该插件的完整 README 请前往项目主页查看。` : "");

  const reportError = (reason: unknown) => setPanelError(reason instanceof Error ? reason.message : String(reason));
  /* R96：一键全部更新（学习 ZCode 3.17.2）——手动触发后台更新循环。 */
  const updateAll = async () => {
    setUpdatingAll(true);
    setUpdateNotice("");
    try {
      const result = await bridge.updateAllPlugins();
      setUpdateNotice(result.updates.length
        ? `已更新 ${result.updates.length} 个插件：${result.updates.map((item) => `${item.id} ${item.from} → ${item.to}`).join("、")}`
        : "所有插件都已是最新版本");
      if (result.errors.length) setPanelError(result.errors.map((item) => `${item.id}：${item.error}`).join("；"));
      setPlugins(await bridge.listPlugins());
    } catch (reason) {
      setPanelError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdatingAll(false);
    }
  };

  const installLocal = async () => {
    setPanelError("");
    try { setPlugins(await bridge.installPlugin()); setCategory("installed"); }
    catch (reason) { reportError(reason); }
  };
  const installMarket = async () => {
    if (!selectedVersion || !market) return;
    setOperationId(market.id); setPanelError("");
    try { setPlugins(await bridge.installMarketplaceVersion(selectedVersion)); setCategory("installed"); setSelectedId(market.id); }
    catch (reason) { reportError(reason); }
    finally { setOperationId(""); }
  };
  const uninstall = async () => {
    if (!installed || !window.confirm(`确定卸载“${installed.name}”吗？`)) return;
    setOperationId(installed.id); setPanelError("");
    try {
      const next = await bridge.uninstallPlugin(installed.id);
      setPlugins(next);
      setSelectedId(next[0]?.id || "");
    } catch (reason) { reportError(reason); }
    finally { setOperationId(""); }
  };
  const toggleEnabled = async () => {
    if (!installed) return;
    setOperationId(installed.id); setPanelError("");
    try { setPlugins(await bridge.setPluginEnabled(installed.id, !installed.enabled)); }
    catch (reason) { reportError(reason); }
    finally { setOperationId(""); }
  };
  const reload = async () => {
    if (!installed) return;
    setOperationId(installed.id); setPanelError("");
    try { setPlugins(await bridge.reloadPlugin(installed.id)); }
    catch (reason) { reportError(reason); }
    finally { setOperationId(""); }
  };
  const checkUpdate = async () => {
    if (!installed) return;
    setOperationId(installed.id); setPanelError(""); setUpdateNotice("");
    try {
      const result = await bridge.updatePlugin(installed.id);
      setUpdateNotice(result.updated ? `已更新到 v${result.to}，立即生效。` : `已是最新版本 v${installed.version}。`);
    } catch (reason) { reportError(reason); }
    finally { setOperationId(""); }
  };

  return <div className="plugin-catalog">
    <div className="plugin-catalog-toolbar">
      <div>
        <h2>插件</h2>
        <p>浏览、安装和管理 SecAgent 插件。</p>
      </div>
      <div className="plugin-toolbar-actions">
        <button className="secondary-button" type="button" onClick={() => void installLocal()}><PackageOpen size={15} />本地安装</button>
        <button className="secondary-button" type="button" onClick={() => void updateAll()} disabled={updatingAll} title="检查并更新所有已安装插件"><RefreshCw size={15} className={updatingAll ? "spin" : ""} />{updatingAll ? "正在更新…" : "全部更新"}</button>
        <button className="icon-button settings-icon-button" type="button" title="刷新市场" onClick={() => void refreshMarket()} disabled={marketLoading}><RefreshCw size={16} className={marketLoading ? "spin" : ""} /></button>
      </div>
    </div>
    {(marketError || panelError) && <div className="settings-error plugin-catalog-error">{marketError || panelError}</div>}
    <div className="plugin-catalog-workspace">
      <aside className="plugin-catalog-sidebar">
        <div className="plugin-search"><Search size={16} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索插件…" aria-label="搜索插件" /></div>
        <div className="plugin-category-tabs" role="tablist" aria-label="插件分类" onKeyDown={(event) => navigate(event, "tab", "horizontal")}>
          <button type="button" role="tab" id={`${categoryId}-installed`} aria-controls={`${categoryId}-panel`} tabIndex={category === "installed" ? 0 : -1} aria-selected={category === "installed"} className={category === "installed" ? "active" : ""} onClick={() => setCategory("installed")}>已安装 <span>{plugins.length}</span></button>
          <button type="button" role="tab" id={`${categoryId}-market`} aria-controls={`${categoryId}-panel`} tabIndex={category === "market" ? 0 : -1} aria-selected={category === "market"} className={category === "market" ? "active" : ""} onClick={() => setCategory("market")}>市场 <span>{marketPlugins.length}</span></button>
        </div>
        <div id={`${categoryId}-panel`} role="tabpanel" aria-labelledby={`${categoryId}-${category}`} className="plugin-category-panel" tabIndex={visiblePlugins.length ? -1 : 0}>
        <div className="plugin-list" role={visiblePlugins.length ? "listbox" : undefined} aria-label={visiblePlugins.length ? (category === "installed" ? "已安装插件" : "插件市场") : undefined} onKeyDown={(event) => navigate(event, "option", "vertical")}>
          {visiblePlugins.map((plugin, index) => {
            const local = plugins.find((item) => item.id === plugin.id);
            const marketPlugin = category === "market" ? plugin as MarketplacePlugin : undefined;
            const installedPlugin = category === "installed" ? plugin as PluginStatus : undefined;
            const version = marketPlugin?.latest?.version || installedPlugin?.version;
            const state = local ? pluginStateLabel(local) : marketPlugin?.releaseError ? "暂不可用" : version ? `v${version}` : "未安装";
            return <button type="button" role="option" tabIndex={selectedId === plugin.id || (index === 0 && !visiblePlugins.some((item) => item.id === selectedId)) ? 0 : -1} aria-selected={selectedId === plugin.id} className={`plugin-list-item ${selectedId === plugin.id ? "selected" : ""}`} key={plugin.id} onClick={() => setSelectedId(plugin.id)}>
              <span className="plugin-list-icon">{plugin.icon ? <img src={plugin.icon} alt="" /> : plugin.name.slice(0, 1).toUpperCase()}</span>
              <span className="plugin-list-copy"><strong>{plugin.name}</strong><small>{plugin.description || plugin.id}</small></span>
              <span className={`plugin-list-state ${local?.state || "market"}`}>{state}</span>
            </button>;
          })}
          {!visiblePlugins.length && <div className="plugin-list-empty" role="status"><PackageOpen size={26} /><span>{filter.trim() ? "没有找到匹配的插件" : category === "installed" ? "还没有安装插件" : marketLoading ? "正在加载市场…" : "没有找到匹配的插件"}</span></div>}
        </div>
        </div>
      </aside>
      <section className="plugin-detail" aria-label="插件详情">
        {!selected && <div className="plugin-detail-empty"><PackageOpen size={42} /><h3>选择一个插件</h3><p>从左侧列表选择插件，查看基本信息和 README。</p></div>}
        {selected && <>
          <header className="plugin-detail-header">
            <div className="plugin-detail-identity">
              <div className="plugin-detail-icon">{selected.icon ? <img src={selected.icon} alt="" /> : selected.name.slice(0, 1).toUpperCase()}</div>
              <div><h3>{selected.name}</h3><p>{selected.id} <span>·</span> v{installed?.version || selectedVersion?.version || "—"}{installed?.author && <><span> · </span>{installed.author}</>}</p><span className={`plugin-status-pill ${installed?.state || "market"}`}>{installed ? <>{installed.state === "ready" ? <CircleCheck size={14} /> : installed.state === "error" ? <CircleAlert size={14} /> : null}{pluginStateLabel(installed)}</> : <><Download size={14} />市场插件</>}</span></div>
            </div>
            <button className="icon-button settings-icon-button" type="button" title="更多操作"><MoreHorizontal size={18} /></button>
          </header>
          <div className="plugin-detail-actions">
            {installed ? <><button className="secondary-button" type="button" onClick={() => void checkUpdate()} disabled={operationId === installed.id}><CircleArrowUp size={15} />{operationId === installed.id ? "检查中…" : "检查更新"}</button><button className="primary-button" type="button" onClick={() => void toggleEnabled()} disabled={operationId === installed.id}><Power size={15} />{installed.enabled ? "禁用" : "启用"}</button><button className="secondary-button" type="button" onClick={() => void reload()} disabled={operationId === installed.id}><RefreshCw size={15} />重新加载</button><button className="secondary-button danger-button" type="button" onClick={() => void uninstall()} disabled={operationId === installed.id}><Trash2 size={15} />卸载</button></> : <button className="primary-button" type="button" onClick={() => void installMarket()} disabled={!selectedVersion || operationId === market?.id}><Download size={15} />{operationId === market?.id ? "安装中…" : `安装 v${selectedVersion?.version || "—"}`}</button>}
            {(installed?.repository || market?.repository) && <a className="secondary-button link-button" href={installed?.repository || market?.repository} target="_blank" rel="noreferrer"><ExternalLink size={15} />项目主页</a>}
          </div>
          {updateNotice && <div className="plugin-detail-message success"><CircleCheck size={16} />{updateNotice}</div>}
          {market?.releaseError && <div className="plugin-detail-message error"><CircleAlert size={16} />暂不可用：{market.releaseError}</div>}
          {installed?.message && <div className={`plugin-detail-message ${installed.state}`}><CircleAlert size={16} />{installed.message}</div>}
          <div className="plugin-detail-tabs" role="tablist" aria-label="插件详情页签" onKeyDown={(event) => navigate(event, "tab", "horizontal")}>
            <button type="button" role="tab" id={`${detailId}-readme`} aria-controls={`${detailId}-panel`} tabIndex={activeDetailTab === "readme" ? 0 : -1} aria-selected={activeDetailTab === "readme"} className={activeDetailTab === "readme" ? "active" : ""} onClick={() => setDetailTab("readme")}>概览</button>
            {installed?.state === "error" && <button type="button" role="tab" id={`${detailId}-error`} aria-controls={`${detailId}-panel`} tabIndex={activeDetailTab === "error" ? 0 : -1} aria-selected={activeDetailTab === "error"} className={activeDetailTab === "error" ? "active" : ""} onClick={() => setDetailTab("error")}>错误信息</button>}
            <button type="button" role="tab" id={`${detailId}-details`} aria-controls={`${detailId}-panel`} tabIndex={activeDetailTab === "details" ? 0 : -1} aria-selected={activeDetailTab === "details"} className={activeDetailTab === "details" ? "active" : ""} onClick={() => setDetailTab("details")}>权限与设置</button>
          </div>
          <div className="plugin-detail-content" role="tabpanel" id={`${detailId}-panel`} aria-labelledby={`${detailId}-${activeDetailTab}`} tabIndex={0}>
            {activeDetailTab === "readme" && <div className="plugin-readme"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedReadme || "暂无 README。"}</ReactMarkdown></div>}
            {activeDetailTab === "error" && <div className="plugin-error-panel"><CircleAlert size={20} /><p>{installed?.message || "插件加载时没有报告错误。"}</p></div>}
            {activeDetailTab === "details" && <div className="plugin-info-grid"><div><small>插件 ID</small><strong>{selected.id}</strong></div><div><small>格式</small><strong>{selected.format === "agent" || installed?.format === "agent" ? "Agent Plugins" : "SecAgent"}</strong></div><div><small>版本</small><strong>v{installed?.version || selectedVersion?.version || "—"}</strong></div><div><small>权限</small><strong>{(installed?.permissions || selectedVersion?.permissions || []).length ? (installed?.permissions || selectedVersion?.permissions || []).join("、") : "未声明权限"}</strong></div><div><small>设置页面</small><strong>{installed?.settingsPages.length ? installed.settingsPages.map((page) => page.title).join("、") : "无"}</strong></div></div>}
          </div>
        </>}
      </section>
    </div>
  </div>;
}
