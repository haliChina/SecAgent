/**
 * OOBE 插件安装卡片（B4 自 OobeWizard.tsx 拆出）。
 *
 * 单个伴随应用的安装卡片：双端进度编排（SecAgent 半程 + 伴随半程，
 * 0-50-100 单调推进）、目标勾选列表、安装按钮组。卡片为纯展示，
 * 全部状态经 props 注入；逻辑逐字搬运自 OobeWizard（行为零变化）。
 */
import { type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { companionPluginStatus, companionProgressForPhase, isClassIslandTargetReady, isClassWidgetsTargetReady, isIccceTargetReady, isSecRandomTargetReady, latestCompatibleVersion } from "./OobeWizardHelpers.js";

interface OobePluginCardProps {
  app: DetectedCompanionApp;
  index: number;
  marketPlugins: MarketplacePlugin[];
  plugins: PluginStatus[];
  platform: NodeJS.Platform;
  installingId: string;
  batchActive: boolean;
  batchCompanionTargets: { classIsland?: string[]; secRandom?: string[]; iccce?: string[]; cw?: string[] };
  batchSecAgentTargets: Record<string, boolean>;
  saProgress: Record<string, number>;
  companionHighWater: Record<string, number>;
  cardProgressHold: Record<string, number>;
  classIslandTargets: ClassIslandInstallCandidate[];
  secRandomTargets: SecRandomInstallCandidate[];
  iccceTargets: IccceInstallCandidate[];
  cwTargets: ClassWidgetsInstallCandidate[];
  classIslandSelectedIds: string[];
  secRandomSelectedIds: string[];
  iccceSelectedIds: string[];
  cwSelectedIds: string[];
  setClassIslandSelectedIds: Dispatch<SetStateAction<string[]>>;
  setSecRandomSelectedIds: Dispatch<SetStateAction<string[]>>;
  setIccceSelectedIds: Dispatch<SetStateAction<string[]>>;
  setCwSelectedIds: Dispatch<SetStateAction<string[]>>;
  classIslandTargetsExpanded: boolean;
  secRandomTargetsExpanded: boolean;
  iccceTargetsExpanded: boolean;
  cwTargetsExpanded: boolean;
  setClassIslandTargetsExpanded: Dispatch<SetStateAction<boolean>>;
  setSecRandomTargetsExpanded: Dispatch<SetStateAction<boolean>>;
  setIccceTargetsExpanded: Dispatch<SetStateAction<boolean>>;
  setCwTargetsExpanded: Dispatch<SetStateAction<boolean>>;
  classIslandResults: Record<string, ClassIslandInstallResult>;
  secRandomResults: Record<string, SecRandomInstallResult>;
  iccceResults: Record<string, IccceInstallResult>;
  cwResults: Record<string, ClassWidgetsInstallResult>;
  classIslandPhase: ClassIslandInstallPhase | "idle";
  secRandomPhase: SecRandomInstallProgress["phase"] | "idle";
  icccePhase: IccceInstallProgress["phase"] | "idle";
  cwPhase: ClassWidgetsInstallProgress["phase"] | "idle";
  classIslandProgressPercent: number;
  secRandomProgressPercent: number;
  iccceProgressPercent: number;
  cwProgressPercent: number;
  installPlugin: (plugin: MarketplacePlugin | undefined) => Promise<boolean>;
  installClassIslandPlugin: (market: MarketplacePlugin | undefined) => Promise<boolean>;
  installSecRandomPlugin: (market: MarketplacePlugin | undefined) => Promise<boolean>;
  installIcccePlugin: (market: MarketplacePlugin | undefined) => Promise<boolean>;
  installClassWidgetsPlugin: (market: MarketplacePlugin | undefined) => Promise<boolean>;
  pickClassIslandExecutable: () => Promise<void>;
  pickSecRandomExecutable: () => Promise<void>;
  pickIccceExecutable: () => Promise<void>;
  pickClassWidgetsExecutable: () => Promise<void>;
}

export function OobePluginCard(props: OobePluginCardProps) {
  const { app, index, marketPlugins, plugins, platform, installingId, batchActive, batchCompanionTargets, batchSecAgentTargets, saProgress, companionHighWater, cardProgressHold,
    classIslandTargets, secRandomTargets, iccceTargets, cwTargets,
    classIslandSelectedIds, secRandomSelectedIds, iccceSelectedIds, cwSelectedIds,
    setClassIslandSelectedIds, setSecRandomSelectedIds, setIccceSelectedIds, setCwSelectedIds,
    classIslandTargetsExpanded, secRandomTargetsExpanded, iccceTargetsExpanded, cwTargetsExpanded,
    setClassIslandTargetsExpanded, setSecRandomTargetsExpanded, setIccceTargetsExpanded, setCwTargetsExpanded,
    classIslandResults, secRandomResults, iccceResults, cwResults,
    classIslandPhase, secRandomPhase, icccePhase, cwPhase,
    classIslandProgressPercent, secRandomProgressPercent, iccceProgressPercent, cwProgressPercent,
    installPlugin, installClassIslandPlugin, installSecRandomPlugin, installIcccePlugin, installClassWidgetsPlugin,
    pickClassIslandExecutable, pickSecRandomExecutable, pickIccceExecutable, pickClassWidgetsExecutable } = props;
  const market = marketPlugins.find((plugin) => plugin.id === app.pluginId);
  const installed = plugins.find((plugin) => plugin.id === app.pluginId);
  const version = latestCompatibleVersion(market, platform);
  const isClassIsland = app.pluginId === "classisland-connector";
  const isSecRandom = app.pluginId === "secrandom";
  const isIccce = app.pluginId === "iccce-connector";
  const isClassWidgets = app.pluginId === "class-widgets";
  const batchCompanionInstalling = installingId === "companions:batch";
  const selectedClassIslandTargets = classIslandTargets.filter((target) => classIslandSelectedIds.includes(target.id));
  const selectedSecRandomTargets = secRandomTargets.filter((target) => secRandomSelectedIds.includes(target.id));
  const selectedIccceTargets = iccceTargets.filter((target) => iccceSelectedIds.includes(target.id));
  const selectedCwTargets = cwTargets.filter((target) => cwSelectedIds.includes(target.id));
  const companionInstalling = installingId === `${app.pluginId}:companion` || (batchCompanionInstalling && (
    (isClassIsland && Boolean(batchCompanionTargets.classIsland?.length)) ||
    (isSecRandom && Boolean(batchCompanionTargets.secRandom?.length)) ||
    (isIccce && Boolean(batchCompanionTargets.iccce?.length)) ||
    (isClassWidgets && Boolean(batchCompanionTargets.cw?.length))
  ));
  const saInstalling = installingId === app.pluginId;
  const classIslandInstalledTargetCount = selectedClassIslandTargets.filter(isClassIslandTargetReady).length;
  const classIslandCompanionInstalled = selectedClassIslandTargets.length > 0 && selectedClassIslandTargets.every(isClassIslandTargetReady);
  const classIslandCanInstall = selectedClassIslandTargets.length > 0 && selectedClassIslandTargets.every((target) => target.compatible) && !classIslandCompanionInstalled;
  const classIslandPhaseLabel = classIslandPhase === "downloading" ? "下载中…" : classIslandPhase === "verifying" ? "等待插件响应…" : classIslandPhase === "installing" ? "写入中…" : classIslandPhase === "closing" ? "关闭中…" : classIslandPhase === "restarting" ? "启动中…" : "安装 ClassIsland 端插件";
  const secRandomInstalledTargetCount = selectedSecRandomTargets.filter(isSecRandomTargetReady).length;
  const secRandomCompanionInstalled = selectedSecRandomTargets.length > 0 && selectedSecRandomTargets.every(isSecRandomTargetReady);
  const secRandomCanInstall = selectedSecRandomTargets.length > 0 && selectedSecRandomTargets.every((target) => target.compatible) && !secRandomCompanionInstalled;
  const secRandomPhaseLabel = secRandomPhase === "downloading" ? "下载中…" : secRandomPhase === "verifying" ? "等待插件响应…" : secRandomPhase === "installing" ? "写入中…" : secRandomPhase === "closing" ? "关闭中…" : secRandomPhase === "restarting" ? "启动中…" : "安装 SecRandom 端插件";
  const iccceInstalledTargetCount = selectedIccceTargets.filter(isIccceTargetReady).length;
  const iccceCompanionInstalled = selectedIccceTargets.length > 0 && selectedIccceTargets.every(isIccceTargetReady);
  const iccceCanInstall = selectedIccceTargets.length > 0 && selectedIccceTargets.every((target) => target.compatible) && !iccceCompanionInstalled;
  const icccePhaseLabel = icccePhase === "downloading" ? "下载中…" : icccePhase === "verifying" ? "等待插件响应…" : icccePhase === "installing" ? "写入中…" : icccePhase === "closing" ? "关闭中…" : icccePhase === "restarting" ? "启动中…" : "安装 ICC-CE 端插件";
  const cwInstalledTargetCount = selectedCwTargets.filter(isClassWidgetsTargetReady).length;
  const cwCompanionInstalled = selectedCwTargets.length > 0 && selectedCwTargets.every(isClassWidgetsTargetReady);
  const cwCanInstall = selectedCwTargets.length > 0 && selectedCwTargets.every((target) => target.compatible) && !cwCompanionInstalled;
  const cwPhaseLabel = cwPhase === "downloading" ? "下载中…" : cwPhase === "verifying" ? "等待插件响应…" : cwPhase === "installing" ? "写入中…" : cwPhase === "closing" ? "关闭中…" : cwPhase === "restarting" ? "启动中…" : "安装 Class Widgets 端插件";
  const companionPhase = isClassIsland ? classIslandPhase : isSecRandom ? secRandomPhase : isIccce ? icccePhase : cwPhase;
  const rawCompanionPercent = isClassIsland ? classIslandProgressPercent : isSecRandom ? secRandomProgressPercent : isIccce ? iccceProgressPercent : cwProgressPercent;
  const companionPercent = Math.max(rawCompanionPercent, companionHighWater[app.pluginId] ?? 0);
  const companionProgress = companionInstalling
    ? companionProgressForPhase(companionPhase, app.appName, companionPercent > 0 ? companionPercent : undefined)
    : undefined;
  const companionPending = isClassIsland
    ? selectedClassIslandTargets.length > 0 && !classIslandCompanionInstalled
    : isSecRandom
      ? selectedSecRandomTargets.length > 0 && !secRandomCompanionInstalled
      : isIccce
        ? selectedIccceTargets.length > 0 && !iccceCompanionInstalled
        : isClassWidgets
          ? selectedCwTargets.length > 0 && !cwCompanionInstalled
          : false;
  // Dual-end cards reserve 0-50% of the background bar for the
  // SecAgent connector and 50-100% for the companion plugin, so the
  // bar advances monotonically across both halves. Single-side
  // plugins use the full card background.
  const dualEnd = isClassIsland || isSecRandom || isIccce || isClassWidgets;
  const saProgressValue = saProgress[app.pluginId] || 10;
  const saHalfOnHalf = dualEnd && companionPending;
  const saHalfPresent = Boolean(installed) || Boolean(batchSecAgentTargets[app.pluginId]);
  const companionOnHalf = dualEnd && saHalfPresent;
  // Between the SecAgent half finishing and the companion half
  // starting (the batch may still be working on other apps), the card
  // holds at 50% instead of collapsing to an empty bar.
  const holdingBetweenHalves = batchActive && Boolean(batchSecAgentTargets[app.pluginId])
    && plugins.some((plugin) => plugin.id === app.pluginId)
    && companionPending && !saInstalling && !companionInstalling;
  const cardBusy = saInstalling || companionInstalling || holdingBetweenHalves;
  // While any install runs, every card's install buttons stay disabled
  // so a batch cannot be interleaved with a per-app install.
  const installing = cardBusy || Boolean(installingId);
  const overallProgress = saInstalling
    ? saHalfOnHalf ? saProgressValue / 2 : saProgressValue
    : companionInstalling && companionProgress
      ? companionOnHalf ? 50 + companionProgress.value / 2 : companionProgress.value
      : holdingBetweenHalves
        ? 50
        : cardProgressHold[app.pluginId];
  const cardStyle = {
    animationDelay: `${index * 70}ms`,
    ...(overallProgress !== undefined ? { "--oobe-plugin-progress": `${overallProgress}%` } : {})
  } as CSSProperties;
  return <article className={`settings-card oobe-plugin-card${isClassIsland ? " oobe-plugin-card-classisland" : isSecRandom ? " oobe-plugin-card-secrandom" : isIccce ? " oobe-plugin-card-iccce" : isClassWidgets ? " oobe-plugin-card-classwidgets" : ""}${cardBusy ? " is-installing" : ""}`} aria-busy={cardBusy} style={cardStyle}>
    <div className="oobe-plugin-main">
      <span className={`oobe-plugin-icon${installed?.icon ? " has-plugin-icon" : ""}`} aria-hidden="true">
        <img className="oobe-plugin-icon-app" src={app.icon} alt="" />
        {installed?.icon && <img className="oobe-plugin-icon-plugin" key={installed.icon} src={installed.icon} alt="" />}
      </span>
      <div className="oobe-plugin-copy">
        <strong>{app.appName}</strong>
        <span>{isClassIsland ? `${classIslandTargets.length ? app.description : "未自动找到安装目录，可手动选择"} · 需要配置两端插件` : isSecRandom ? `${secRandomTargets.length ? app.description : "未自动找到安装目录，可手动选择"} · 需要配置两端插件` : isIccce ? `${iccceTargets.length ? app.description : "未自动找到安装目录，可手动选择"} · 需要配置两端插件` : isClassWidgets ? `${cwTargets.length ? app.description : "未自动找到安装目录，可手动选择"} · 需要配置两端插件` : `${app.description} · 已在本机找到`}</span>
      </div>
    </div>
    {(isClassIsland || isSecRandom || isIccce || isClassWidgets) ? <div className="oobe-plugin-side-actions oobe-plugin-side-actions-dual">
      <div className="oobe-plugin-side-action">
        <span className="oobe-plugin-side-label">SecAgent 端</span>
        {installed ? <span className="oobe-plugin-side-state is-installed" aria-label={`SecAgent 端已安装 v${installed.version}`} title={`SecAgent 端已安装 v${installed.version}`}><Check aria-hidden="true" size={17} strokeWidth={2.5} />已安装{installed.version ? ` v${installed.version}` : ""}</span> : market && version ? <button className="primary-button" type="button" disabled={installing} onClick={() => void installPlugin(market)}>{saInstalling ? "安装中…" : "安装 SecAgent 端插件"}</button> : <span className="oobe-plugin-side-state is-unavailable">{market?.releaseError ? "暂不可用" : "暂无可用版本"}</span>}
      </div>
      <div className="oobe-plugin-side-action">
        <span className="oobe-plugin-side-label">{app.appName} 端</span>
        {isClassIsland ? classIslandCompanionInstalled ? <span className="oobe-plugin-side-state is-installed" aria-label={`ClassIsland 端已安装 ${classIslandInstalledTargetCount}/${selectedClassIslandTargets.length}`}><Check aria-hidden="true" size={17} strokeWidth={2.5} />已安装 {classIslandInstalledTargetCount}/{selectedClassIslandTargets.length}</span> : !selectedClassIslandTargets.length ? <span className="oobe-plugin-side-state is-unavailable">未选择安装目标</span> : <button className="primary-button" type="button" disabled={installing || !classIslandCanInstall} onClick={() => void installClassIslandPlugin(market)}>{companionInstalling ? classIslandPhaseLabel : classIslandInstalledTargetCount ? "安装剩余 ClassIsland 端插件" : "安装 ClassIsland 端插件"}</button>
          : isSecRandom ? secRandomCompanionInstalled ? <span className="oobe-plugin-side-state is-installed" aria-label={`SecRandom 端已安装 ${secRandomInstalledTargetCount}/${selectedSecRandomTargets.length}`}><Check aria-hidden="true" size={17} strokeWidth={2.5} />已安装 {secRandomInstalledTargetCount}/{selectedSecRandomTargets.length}</span> : !selectedSecRandomTargets.length ? <span className="oobe-plugin-side-state is-unavailable">未选择安装目标</span> : <button className="primary-button" type="button" disabled={installing || !secRandomCanInstall} onClick={() => void installSecRandomPlugin(market)}>{companionInstalling ? secRandomPhaseLabel : secRandomInstalledTargetCount ? "安装剩余 SecRandom 端插件" : "安装 SecRandom 端插件"}</button>
            : isIccce ? (iccceCompanionInstalled ? <span className="oobe-plugin-side-state is-installed" aria-label={`ICC-CE 端已安装 ${iccceInstalledTargetCount}/${selectedIccceTargets.length}`}><Check aria-hidden="true" size={17} strokeWidth={2.5} />已安装 {iccceInstalledTargetCount}/{selectedIccceTargets.length}</span> : !selectedIccceTargets.length ? <span className="oobe-plugin-side-state is-unavailable">未选择安装目标</span> : <button className="primary-button" type="button" disabled={installing || !iccceCanInstall} onClick={() => void installIcccePlugin(market)}>{companionInstalling ? icccePhaseLabel : iccceInstalledTargetCount ? "安装剩余 ICC-CE 端插件" : "安装 ICC-CE 端插件"}</button>)
              : cwCompanionInstalled ? <span className="oobe-plugin-side-state is-installed" aria-label={`Class Widgets 端已安装 ${cwInstalledTargetCount}/${selectedCwTargets.length}`}><Check aria-hidden="true" size={17} strokeWidth={2.5} />已安装 {cwInstalledTargetCount}/{selectedCwTargets.length}</span> : !selectedCwTargets.length ? <span className="oobe-plugin-side-state is-unavailable">未选择安装目标</span> : <button className="primary-button" type="button" disabled={installing || !cwCanInstall} onClick={() => void installClassWidgetsPlugin(market)}>{companionInstalling ? cwPhaseLabel : cwInstalledTargetCount ? "安装剩余 Class Widgets 端插件" : "安装 Class Widgets 端插件"}</button>}
      </div>
    </div> : <div className="oobe-plugin-side-actions oobe-plugin-side-actions-single">
      <span className="oobe-plugin-side-label">SecAgent 端</span>
      {installed ? <span className="oobe-plugin-side-state is-installed" aria-label={`SecAgent 端已安装 v${installed.version}`} title={`SecAgent 端已安装 v${installed.version}`}><Check aria-hidden="true" size={17} strokeWidth={2.5} />已安装{installed.version ? ` v${installed.version}` : ""}</span> : market && version ? <button className="primary-button" type="button" disabled={installing} onClick={() => void installPlugin(market)}>{saInstalling ? "安装中…" : "安装 SecAgent 端插件"}</button> : <span className="oobe-plugin-side-state is-unavailable">{market?.releaseError ? "暂不可用" : "暂无可用版本"}</span>}
    </div>}
    {isClassIsland && <div className="oobe-classisland-targets">
      <div className="oobe-classisland-target-heading">
        <button className="oobe-target-toggle" type="button" disabled={installing} aria-expanded={classIslandTargetsExpanded} aria-controls="oobe-classisland-target-list" onClick={() => setClassIslandTargetsExpanded((expanded) => !expanded)}><strong>选择 ClassIsland 安装目标</strong>{classIslandTargetsExpanded ? <ChevronDown aria-hidden="true" size={17} /> : <ChevronRight aria-hidden="true" size={17} />}</button>
        {classIslandTargetsExpanded && <button className="secondary-button" type="button" disabled={installing} onClick={() => void pickClassIslandExecutable()}>选择 ClassIsland.exe</button>}
      </div>
      {classIslandTargetsExpanded && <div id="oobe-classisland-target-list">
        {!classIslandTargets.length && <p className="empty-list">未找到 ClassIsland，可选择其可执行文件。</p>}
        {classIslandTargets.map((target) => {
          const result = classIslandResults[target.id];
          return <label className={`oobe-classisland-target${target.compatible ? "" : " is-incompatible"}`} key={target.id}>
            <input type="checkbox" checked={classIslandSelectedIds.includes(target.id)} disabled={!target.compatible || installing} onChange={() => setClassIslandSelectedIds((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id])} />
            <span><strong>ClassIsland {target.version ? `v${target.version}` : "版本未知"}{target.isRunning ? " · 正在运行" : ""}</strong><small>{target.executablePath} · {companionPluginStatus("ClassIsland", target)}</small>{!target.compatible && <em>{target.reason}</em>}{result && <em className={result.ok ? "is-success" : "is-error"}>{result.message}</em>}</span>
          </label>;
        })}
      </div>}
    </div>}
    {isSecRandom && <div className="oobe-classisland-targets">
      <div className="oobe-classisland-target-heading">
        <button className="oobe-target-toggle" type="button" disabled={installing} aria-expanded={secRandomTargetsExpanded} aria-controls="oobe-secrandom-target-list" onClick={() => setSecRandomTargetsExpanded((expanded) => !expanded)}><strong>选择 SecRandom 安装目标</strong>{secRandomTargetsExpanded ? <ChevronDown aria-hidden="true" size={17} /> : <ChevronRight aria-hidden="true" size={17} />}</button>
        {secRandomTargetsExpanded && <button className="secondary-button" type="button" disabled={installing} onClick={() => void pickSecRandomExecutable()}>选择 SecRandom 可执行文件</button>}
      </div>
      {secRandomTargetsExpanded && <div id="oobe-secrandom-target-list">
        {!secRandomTargets.length && <p className="empty-list">未找到 SecRandom，可选择其可执行文件。</p>}
        {secRandomTargets.map((target) => {
          const result = secRandomResults[target.id];
          return <label className={`oobe-classisland-target${target.compatible ? "" : " is-incompatible"}`} key={target.id}>
            <input type="checkbox" checked={secRandomSelectedIds.includes(target.id)} disabled={!target.compatible || installing} onChange={() => setSecRandomSelectedIds((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id])} />
            <span><strong>SecRandom {target.version ? `v${target.version}` : "版本未知"}{target.isRunning ? " · 正在运行" : ""}</strong><small>{target.executablePath} · {companionPluginStatus("SecRandom", target)}</small>{!target.compatible && <em>{target.reason}</em>}{result && <em className={result.ok ? "is-success" : "is-error"}>{result.message}</em>}</span>
          </label>;
        })}
      </div>}
    </div>}
    {isIccce && <div className="oobe-classisland-targets">
      <div className="oobe-classisland-target-heading">
        <button className="oobe-target-toggle" type="button" disabled={installing} aria-expanded={iccceTargetsExpanded} aria-controls="oobe-iccce-target-list" onClick={() => setIccceTargetsExpanded((expanded) => !expanded)}><strong>选择 ICC-CE 安装目标</strong>{iccceTargetsExpanded ? <ChevronDown aria-hidden="true" size={17} /> : <ChevronRight aria-hidden="true" size={17} />}</button>
        {iccceTargetsExpanded && <button className="secondary-button" type="button" disabled={installing} onClick={() => void pickIccceExecutable()}>选择 ICC-CE 可执行文件</button>}
      </div>
      {iccceTargetsExpanded && <div id="oobe-iccce-target-list">
        {!iccceTargets.length && <p className="empty-list">未找到 ICC-CE，可选择其可执行文件。</p>}
        {iccceTargets.map((target) => {
          const result = iccceResults[target.id];
          return <label className={`oobe-classisland-target${target.compatible ? "" : " is-incompatible"}`} key={target.id}>
            <input type="checkbox" checked={iccceSelectedIds.includes(target.id)} disabled={!target.compatible || installing} onChange={() => setIccceSelectedIds((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id])} />
            <span><strong>ICC-CE {target.version ? `v${target.version}` : "版本未知"}{target.isRunning ? " · 正在运行" : ""}</strong><small>{target.executablePath} · {companionPluginStatus("ICC-CE", target)}</small>{!target.compatible && <em>{target.reason}</em>}{result && <em className={result.ok ? "is-success" : "is-error"}>{result.message}</em>}</span>
          </label>;
        })}
      </div>}
    </div>}
    {isClassWidgets && <div className="oobe-classisland-targets">
      <div className="oobe-classisland-target-heading">
        <button className="oobe-target-toggle" type="button" disabled={installing} aria-expanded={cwTargetsExpanded} aria-controls="oobe-cw-target-list" onClick={() => setCwTargetsExpanded((expanded) => !expanded)}><strong>选择 Class Widgets 安装目标</strong>{cwTargetsExpanded ? <ChevronDown aria-hidden="true" size={17} /> : <ChevronRight aria-hidden="true" size={17} />}</button>
        {cwTargetsExpanded && <button className="secondary-button" type="button" disabled={installing} onClick={() => void pickClassWidgetsExecutable()}>选择 Class Widgets 可执行文件</button>}
      </div>
      {cwTargetsExpanded && <div id="oobe-cw-target-list">
        {!cwTargets.length && <p className="empty-list">未找到 Class Widgets，可选择其可执行文件。</p>}
        {cwTargets.map((target) => {
          const result = cwResults[target.id];
          return <label className={`oobe-classisland-target${target.compatible ? "" : " is-incompatible"}`} key={target.id}>
            <input type="checkbox" checked={cwSelectedIds.includes(target.id)} disabled={!target.compatible || installing} onChange={() => setCwSelectedIds((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id])} />
            <span><strong>Class Widgets {target.version ? `v${target.version}` : "版本未知"}{target.isRunning ? " · 正在运行" : ""}</strong><small>{target.executablePath} · {companionPluginStatus("Class Widgets", target)}</small>{!target.compatible && <em>{target.reason}</em>}{result && <em className={result.ok ? "is-success" : "is-error"}>{result.message}</em>}</span>
          </label>;
        })}
      </div>}
    </div>}
  </article>;
}
