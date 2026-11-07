import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, FolderOpen, RotateCcw } from "lucide-react";
import { SelectCombobox } from "./SelectCombobox.js";
import { SettingsConfirmDialog, SettingsGroup } from "./settings/SettingPrimitives.js";
import {
  normalizePluginSettings,
  pluginFieldDefault,
  normalizePluginPanelStatus,
  pluginFieldHint,
  pluginFieldKind,
  pluginPhaseLabel,
  pluginPathKind,
  pluginValueMatchesDefault,
  pluginValuesEqual,
  summarizePluginActionResult,
  type PluginPanelAction,
  type PluginPanelStatus,
  type PluginSettingAction,
  type PluginSettingField,
  type PluginSettingPanel,
  type PluginSettingsDescribe,
  type PluginSettingsSection
} from "../plugin-settings.js";

/* R76/R80：通用插件设置表单。
 *
 * 插件经 `api.registerSettingsHandler` 提供 describe/set/action 协议即可在
 * 宿主设置页渲染可调参数；特例（OAuth 等）仍由插件专属组件接管。
 *
 * R80（对照 ClassIsland联动 / 桌宠 / Computer Use 三个仓库补齐）：
 *   - hidden 字段不再误渲染；
 *   - effect=guidance 显示「提示词引导」徽标（immediate 是默认行为，不重复标注）；
 *   - actions 渲染按钮（ClassIsland 的「测试连接」、桌宠的「皮肤列表」），
 *     支持确认弹窗与结果展示；
 *   - path 字段带原生文件/目录选择器，免手输 Windows 路径；
 *   - password 可显隐、textarea 多行、数字保留编辑中间态；
 *   - 每字段「恢复默认值」；保存按钮随 dirty 状态禁用，不再重复提交。 */

type SaveResult = { ok?: boolean; values?: Record<string, unknown>; note?: string; refresh?: boolean } | null;

export function PluginFormSettingsPage({ pluginId, pageId }: { pluginId: string; pageId: string }) {
  const bridge = window.secagent;
  const [sections, setSections] = useState<PluginSettingsSection[] | null>(null);
  const [fields, setFields] = useState<PluginSettingField[]>([]);
  const [actions, setActions] = useState<PluginSettingAction[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [panels, setPanels] = useState<PluginSettingPanel[]>([]);
  const [panelStatuses, setPanelStatuses] = useState<Record<string, PluginPanelStatus>>({});
  const [panelActionBusy, setPanelActionBusy] = useState<string | null>(null);
  const [pendingPanelAction, setPendingPanelAction] = useState<{ panelId: string; action: PluginPanelAction } | null>(null);
  const [panelFeedback, setPanelFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<PluginSettingAction | null>(null);
  const aliveRef = useRef(true);

  const applyDescribe = (raw: PluginSettingsDescribe | null | undefined): void => {
    const normalized = normalizePluginSettings(raw);
    const nextValues = raw?.values && typeof raw.values === "object" && !Array.isArray(raw.values) ? raw.values : {};
    setSections(normalized.sections);
    setFields(normalized.fields);
    setActions(normalized.actions);
    setPanels(normalized.panels);
    setPanelStatuses({});
    setPanelFeedback(null);
    setValues(nextValues);
    setInitialValues(nextValues);
  };

  const load = async (keepFeedback = false): Promise<void> => {
    if (!keepFeedback) {
      setSections(null);
      setFields([]);
      setActions([]);
      setPanels([]);
      setPanelStatuses({});
      setPanelFeedback(null);
      setValues({});
      setInitialValues({});
      setError("");
      setNote("");
      setSaved(false);
    }
    try {
      const raw = (await bridge.callPluginSettings(pluginId, pageId, "describe", {})) as PluginSettingsDescribe;
      if (!aliveRef.current) return;
      applyDescribe(raw);
    } catch (reason) {
      if (!aliveRef.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setSections([]);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => { aliveRef.current = false; };
  }, [pluginId, pageId]);

  /* 服务面板轮询：插件用 statusAction 返回 { phase, label, message,
     progress, facts, actions }，宿主只负责渲染；安装/启动这类耗时操作
     靠轮询把进度推上来，不需要插件推送。 */
  useEffect(() => {
    if (!panels.length) return;
    let disposed = false;
    const timers: number[] = [];
    const poll = async (panel: PluginSettingPanel): Promise<void> => {
      try {
        const raw = await bridge.callPluginSettings(pluginId, pageId, panel.statusAction, {});
        if (disposed) return;
        setPanelStatuses((current) => ({ ...current, [panel.id]: normalizePluginPanelStatus(raw) }));
      } catch {
        // 状态读取失败保持上一次结果，不打断表单编辑。
      }
      if (disposed || !panel.pollMs) return;
      timers.push(window.setTimeout(() => void poll(panel), panel.pollMs));
    };
    panels.forEach((panel) => void poll(panel));
    return () => { disposed = true; timers.forEach((timer) => window.clearTimeout(timer)); };
  }, [panels, pluginId, pageId]);

  const refreshPanel = async (panelId: string): Promise<void> => {
    const panel = panels.find((item) => item.id === panelId);
    if (!panel) return;
    try {
      const raw = await bridge.callPluginSettings(pluginId, pageId, panel.statusAction, {});
      if (!aliveRef.current) return;
      setPanelStatuses((current) => ({ ...current, [panel.id]: normalizePluginPanelStatus(raw) }));
    } catch { /* 操作后刷新失败由轮询兜底 */ }
  };

  const runPanelAction = async (panelId: string, action: PluginPanelAction): Promise<void> => {
    if (panelActionBusy) return;
    setPanelActionBusy(`${panelId}:${action.id}`);
    setPanelFeedback(null);
    try {
      await bridge.callPluginSettings(pluginId, pageId, action.id, {});
      await refreshPanel(panelId);
      if (aliveRef.current) setPanelFeedback({ ok: true, text: `${action.label}：已提交` });
    } catch (reason) {
      if (aliveRef.current) setPanelFeedback({ ok: false, text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      if (aliveRef.current) setPanelActionBusy(null);
    }
  };

  const save = async (): Promise<void> => {
    if (busy || pluginValuesEqual(values, initialValues)) return;
    setBusy(true);
    setError("");
    setSaved(false);
    setNote("");
    try {
      /* 数字字段在编辑期保留原始字符串（允许「-」「1.」这类中间态，否则
         受控输入会把它格式化成 NaN 而没法输入负数/小数）；提交前统一归一。 */
      const payload: Record<string, unknown> = { ...values };
      /* 遍历所有字段（含 hidden）：隐藏的数字字段同样要在提交前归一。 */
      for (const field of fields) {
        if (pluginFieldKind(field) !== "number") continue;
        const raw = payload[field.key];
        if (typeof raw !== "string") continue;
        const parsed = Number(raw.trim());
        if (raw.trim() === "" || !Number.isFinite(parsed)) delete payload[field.key];
        else payload[field.key] = parsed;
      }
      const result = (await bridge.callPluginSettings(pluginId, pageId, "set", payload)) as SaveResult;
      if (result?.values && typeof result.values === "object") {
        setValues(result.values);
        setInitialValues(result.values);
      } else {
        setValues(payload);
        setInitialValues(payload);
      }
      if (result && typeof result.note === "string" && result.note) setNote(result.note);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action: PluginSettingAction): Promise<void> => {
    if (actionBusy) return;
    setActionBusy(action.id);
    setActionResult(null);
    setNote("");
    try {
      const result = (await bridge.callPluginSettings(pluginId, pageId, action.id, {})) as SaveResult;
      if (result?.values && typeof result.values === "object") {
        setValues(result.values);
        setInitialValues(result.values);
      }
      setActionResult({ ok: result?.ok !== false, text: summarizePluginActionResult(result) });
      if (result?.refresh === true) await load(true);
    } catch (reason) {
      setActionResult({ ok: false, text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setActionBusy(null);
    }
  };

  if (sections === null) return <article className="settings-card"><p>正在读取插件设置…</p></article>;
  if (!sections.length && !actions.length && !panels.length) return <article className="settings-card"><p className="settings-help">{error ? `该插件设置页不可用：${error}` : "此插件未提供声明式设置（无 describe 协议）。"}</p></article>;

  const setField = (key: string, value: unknown): void => {
    setSaved(false);
    setValues((current) => ({ ...current, [key]: value }));
  };

  const dirty = !pluginValuesEqual(values, initialValues);

  const pickPath = async (field: PluginSettingField): Promise<void> => {
    try {
      const picked = await bridge.pickPluginPath?.(pluginPathKind(field));
      if (picked) setField(field.key, picked);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const renderControl = (field: PluginSettingField) => {
    const kind = pluginFieldKind(field);
    const value = values[field.key];
    if (kind === "select") {
      const options = (field.options ?? []).map((option) => ({ value: String(option.value), label: option.label || String(option.value) }));
      return <SelectCombobox ariaLabel={field.label || field.key} value={String(value ?? "")} options={options} onChange={(next) => setField(field.key, next)} />;
    }
    if (kind === "number") {
      return <input
        type="number"
        inputMode="decimal"
        value={String(value ?? "")}
        placeholder={field.placeholder || ""}
        min={typeof field.min === "number" ? field.min : undefined}
        max={typeof field.max === "number" ? field.max : undefined}
        step={typeof field.step === "number" ? field.step : undefined}
        onChange={(event) => setField(field.key, event.target.value)}
      />;
    }
    if (kind === "textarea") {
      return <textarea
        rows={3}
        value={String(value ?? "")}
        placeholder={field.placeholder || ""}
        onChange={(event) => setField(field.key, event.target.value)}
      />;
    }
    if (kind === "password") {
      const revealed = revealedKey === field.key;
      return <div className="plugin-secret-field">
        <input
          type={revealed ? "text" : "password"}
          autoComplete="off"
          value={String(value ?? "")}
          placeholder={field.placeholder || ""}
          onChange={(event) => setField(field.key, event.target.value)}
        />
        <button
          type="button"
          className="plugin-set-inline-button"
          aria-label={revealed ? "隐藏内容" : "显示内容"}
          title={revealed ? "隐藏" : "显示"}
          onClick={() => setRevealedKey(revealed ? null : field.key)}
        >{revealed ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}</button>
      </div>;
    }
    if (kind === "path" && typeof bridge.pickPluginPath === "function") {
      return <div className="plugin-path-field">
        <input type="text" value={String(value ?? "")} placeholder={field.placeholder || ""} onChange={(event) => setField(field.key, event.target.value)} />
        <button type="button" className="plugin-set-inline-button" onClick={() => void pickPath(field)} title={pluginPathKind(field) === "file" ? "选择文件" : "选择目录"}><FolderOpen size={14} aria-hidden /> 浏览</button>
      </div>;
    }
    return <input
      type="text"
      value={String(value ?? "")}
      placeholder={field.placeholder || ""}
      onChange={(event) => setField(field.key, event.target.value)}
    />;
  };

  /* R81：字段改为「标题在上、控件在下」的网格单元；布尔项整行开关，
     路径/多行文本独占整行。 */
  const renderField = (field: PluginSettingField) => {
    const kind = pluginFieldKind(field);
    const label = field.label || field.key;
    const hint = pluginFieldHint(field);
    /* 「立即生效」是默认行为，不再逐字段贴徽标；只标注需要解释的「提示词引导」。 */
    const badge = field.effect === "guidance" ? <span
      className="plugin-effect-badge"
      title="通过提示词引导模型行为，引擎不强制"
    >提示词引导</span> : null;
    if (kind === "boolean") {
      return <div className="plugin-field plugin-field-wide plugin-field-boolean" key={field.key}>
        <label className="plugin-field-head">
          <span className="plugin-field-label">{label}{badge}</span>
          <input
            type="checkbox"
            className="set-switch"
            checked={values[field.key] === true}
            onChange={(event) => setField(field.key, event.target.checked)}
          />
        </label>
        {hint ? <p className="plugin-field-hint">{hint}</p> : null}
      </div>;
    }
    const fallback = pluginFieldDefault(field);
    const canReset = fallback !== undefined && !pluginValueMatchesDefault(field, values[field.key]);
    const wide = kind === "textarea" || kind === "path";
    return <div className={wide ? "plugin-field plugin-field-wide" : "plugin-field"} key={field.key}>
      <div className="plugin-field-head">
        <span className="plugin-field-label">{label}{badge}</span>
        {canReset ? <button
          type="button"
          className="plugin-set-reset"
          title="恢复默认值"
          aria-label={`恢复 ${label} 的默认值`}
          onClick={() => setField(field.key, fallback)}
        ><RotateCcw size={13} aria-hidden /></button> : null}
      </div>
      <div className="plugin-field-control">{renderControl(field)}</div>
      {hint ? <p className="plugin-field-hint">{hint}</p> : null}
    </div>;
  };

  return <>
    {error && <div className="settings-error">{error}</div>}
    {note && <div className="settings-success">{note}</div>}
    {panels.length > 0 && <div className="plugin-service-panels">
      {panels.map((panel) => {
        const status = panelStatuses[panel.id];
        const phase = status?.phase || "unknown";
        const panelActions = status?.actions || [];
        return <article className={`plugin-service-panel phase-${phase}`} key={panel.id}>
          <header className="plugin-service-head">
            <div className="plugin-service-copy">
              <strong>{panel.title}</strong>
              {panel.description ? <p>{panel.description}</p> : null}
            </div>
            <span className={`plugin-phase-pill phase-${phase}`}>{status?.label || pluginPhaseLabel(phase)}</span>
          </header>
          {typeof status?.progress === "number" ? <div className="plugin-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.progress}>
            <i style={{ width: `${status.progress}%` }} />
          </div> : null}
          {status?.message ? <p className="plugin-service-message">{status.message}</p> : null}
          {status?.facts?.length ? <dl className="plugin-service-facts">
            {status.facts.map((fact, index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
          </dl> : null}
          {panelActions.length > 0 && <div className="plugin-service-actions">
            {panelActions.map((action) => {
              const key = `${panel.id}:${action.id}`;
              return <button
                key={action.id}
                type="button"
                className={action.primary ? "primary-button plugin-panel-action" : action.danger ? "secondary-button plugin-panel-action danger" : "secondary-button plugin-panel-action"}
                disabled={panelActionBusy !== null || action.disabled === true}
                onClick={() => { if (action.confirm) setPendingPanelAction({ panelId: panel.id, action }); else void runPanelAction(panel.id, action); }}
              >{panelActionBusy === key ? "执行中…" : action.label}</button>;
            })}
          </div>}
        </article>;
      })}
    </div>}
    {panelFeedback ? <div className={panelFeedback.ok ? "settings-success plugin-action-result" : "settings-error plugin-action-result"} role="status">{panelFeedback.text}</div> : null}
    {sections.map((section, index) => <SettingsGroup key={`${section.title}-${index}`} label={section.title} desc={section.description}>
      <div className="plugin-fields">{section.fields.map(renderField)}</div>
    </SettingsGroup>)}
    {actions.length > 0 && <SettingsGroup label="插件操作" desc="由插件提供的即时操作，结果会在下方显示。">
      <div className="plugin-actions-row">
        {actions.map((action) => <button
          key={action.id}
          type="button"
          className={action.danger ? "secondary-button plugin-action-button danger" : "secondary-button plugin-action-button"}
          disabled={actionBusy !== null}
          title={action.description || action.label}
          onClick={() => { if (action.confirm) setPendingAction(action); else void runAction(action); }}
        >{actionBusy === action.id ? "执行中…" : action.label}</button>)}
      </div>
      {actionResult ? <div className={actionResult.ok ? "settings-success plugin-action-result" : "settings-error plugin-action-result"} role="status">{actionResult.text}</div> : null}
    </SettingsGroup>}
    <div className="plugin-form-actions">
      <button className="primary-button" type="button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "保存中…" : saved ? "已保存" : dirty ? "保存设置" : "已是最新"}</button>
      {dirty ? <span className="plugin-form-state">有未保存的改动</span> : null}
    </div>
    <SettingsConfirmDialog
      open={pendingAction !== null}
      title={pendingAction ? `执行「${pendingAction.label}」` : ""}
      message={pendingAction?.confirm || ""}
      confirmLabel={pendingAction?.label || "执行"}
      danger={pendingAction?.danger === true}
      onCancel={() => setPendingAction(null)}
      onConfirm={() => { const action = pendingAction; setPendingAction(null); if (action) void runAction(action); }}
    />
    <SettingsConfirmDialog
      open={pendingPanelAction !== null}
      title={pendingPanelAction ? `执行「${pendingPanelAction.action.label}」` : ""}
      message={pendingPanelAction?.action.confirm || ""}
      confirmLabel={pendingPanelAction?.action.label || "执行"}
      danger={pendingPanelAction?.action.danger === true}
      onCancel={() => setPendingPanelAction(null)}
      onConfirm={() => { const pending = pendingPanelAction; setPendingPanelAction(null); if (pending) void runPanelAction(pending.panelId, pending.action); }}
    />
  </>;
}
