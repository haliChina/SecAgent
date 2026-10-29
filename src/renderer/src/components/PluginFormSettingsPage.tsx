import { useEffect, useState } from "react";
import { SelectCombobox } from "./SelectCombobox.js";
import { SettingsGroup, SettingsSwitchRow } from "./settings/SettingPrimitives.js";

/* R76（升级包 asar 补丁进源码）：通用插件设置表单。
 *
 * 背景：宿主渲染端此前硬编码只有 secscore-connector 渲染真表单，其他
 * 插件设置页只显示「服务状态」卡——插件无法暴露可调参数给用户。
 * 本组件用 describe/set 两个约定动作渲染声明式表单，任何插件经
 * api.registerSettingsHandler 提供即可（桌宠 0.5.7 / ClassIsland联动
 * 1.1.0 已用该协议）。
 *
 * describe 兼容两种返回形态（都返回 values 供回显）：
 *   ① { groups, fields } —— fields 平铺、每个 field 带 group 字段（CIC）
 *   ② { groups } —— groups 内嵌 fields（桌宠）
 * set 传入改动值，返回 { ok, values?, note? }（note 如「以下键已按取值
 * 范围修正」）。
 * 插件专属的附加动作（桌宠 skins / CIC test）不在本表单范围——插件可用
 * 专属工具或后续加自定义区。secscore-connector 保留 SecScoreSettingsPage
 * 专属组件（OAuth 交互通用表单覆盖不了）。 */

type PluginSettingField = {
  key: string;
  group?: string;
  type?: string;
  label?: string;
  hint?: string;
  help?: string;
  placeholder?: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
};

type PluginSettingGroup = { id?: string; title?: string; description?: string; fields?: PluginSettingField[] };
type DescribeResult = { ok?: boolean; groups?: PluginSettingGroup[]; fields?: PluginSettingField[]; values?: Record<string, unknown> };
type Section = { title: string; description: string; fields: PluginSettingField[] };

function normalizeDescribe(raw: DescribeResult | null | undefined): Section[] {
  if (!raw) return [];
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const flat = Array.isArray(raw.fields) ? raw.fields : null;
  if (flat) {
    const buckets = new Map<string, PluginSettingField[]>();
    for (const field of flat) {
      if (!field || !field.key) continue;
      const groupId = field.group || "general";
      const bucket = buckets.get(groupId) || [];
      bucket.push(field);
      buckets.set(groupId, bucket);
    }
    const sections: Section[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
      const fields = buckets.get(group?.id || "") || [];
      seen.add(group?.id || "");
      if (fields.length) sections.push({ title: group?.title || group?.id || "设置", description: group?.description || "", fields });
    }
    for (const [groupId, fields] of buckets) {
      if (!seen.has(groupId)) sections.push({ title: groupId, description: "", fields });
    }
    return sections;
  }
  return groups
    .filter((group) => Array.isArray(group?.fields) && group.fields.length)
    .map((group) => ({ title: group?.title || group?.id || "设置", description: group?.description || "", fields: group.fields! }));
}

export function PluginFormSettingsPage({ pluginId, pageId }: { pluginId: string; pageId: string }) {
  const bridge = window.secagent;
  const [sections, setSections] = useState<Section[] | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setSections(null);
      setError("");
      setSaved(false);
      try {
        const raw = (await bridge.callPluginSettings(pluginId, pageId, "describe", {})) as DescribeResult;
        if (!alive) return;
        setSections(normalizeDescribe(raw));
        setValues(raw?.values && typeof raw.values === "object" ? raw.values : {});
      } catch (reason) {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setSections([]);
      }
    })();
    return () => { alive = false; };
  }, [pluginId, pageId]);

  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    setNote("");
    try {
      /* 数字字段在编辑期保留原始字符串（允许「-」「1.」这类中间态，否则
         受控输入会把它格式化成 NaN 而没法输入负数/小数）；提交前统一归一。 */
      const payload: Record<string, unknown> = { ...values };
      for (const section of sections ?? []) {
        for (const field of section.fields) {
          if (field.type !== "number") continue;
          const raw = payload[field.key];
          if (typeof raw !== "string") continue;
          const parsed = Number(raw.trim());
          if (raw.trim() === "" || !Number.isFinite(parsed)) delete payload[field.key];
          else payload[field.key] = parsed;
        }
      }
      const result = (await bridge.callPluginSettings(pluginId, pageId, "set", payload)) as { ok?: boolean; values?: Record<string, unknown>; note?: string } | null;
      if (result && typeof result.values === "object" && result.values) setValues(result.values);
      if (result && typeof result.note === "string" && result.note) setNote(result.note);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (sections === null) return <article className="settings-card"><p>正在读取插件设置…</p></article>;
  if (!sections.length) return <article className="settings-card"><p className="settings-help">{error ? `该插件设置页不可用：${error}` : "此插件未提供声明式设置（无 describe 协议）。"}</p></article>;

  const setField = (key: string, value: unknown) => {
    setSaved(false);
    setValues((current) => ({ ...current, [key]: value }));
  };

  /* R79：改为与设置页其余分区一致的行式布局（标题/说明在左、控件在右），
     复用 .set-row / .set-group 与 SettingPrimitives，不再自带一套表单样式。 */
  const renderField = (field: PluginSettingField) => {
    const value = values[field.key];
    const label = field.label || field.key;
    const hint = field.hint || field.help;
    // R77：CIC 的 schema 用 "bool"（桌宠用 "boolean"）——两种都认。
    if (field.type === "boolean" || field.type === "bool" || field.type === "toggle") {
      return <SettingsSwitchRow
        key={field.key}
        title={label}
        desc={hint}
        checked={value === true}
        onChange={(next) => setField(field.key, next)}
      />;
    }
    const control = field.type === "select" && Array.isArray(field.options) && field.options.length
      ? <SelectCombobox
        ariaLabel={label}
        value={String(value ?? "")}
        options={field.options.map((option) => ({ value: String(option.value), label: option.label || String(option.value) }))}
        onChange={(next) => setField(field.key, next)}
      />
      : field.type === "number"
        ? <input
          type="number"
          value={String(value ?? "")}
          min={typeof field.min === "number" ? field.min : undefined}
          max={typeof field.max === "number" ? field.max : undefined}
          step={typeof field.step === "number" ? field.step : undefined}
          onChange={(event) => setField(field.key, event.target.value)}
        />
        : <input
          type="text"
          value={String(value ?? "")}
          placeholder={field.placeholder || ""}
          onChange={(event) => setField(field.key, event.target.value)}
        />;
    return <div className="set-row set-row-static" key={field.key}>
      <span className="set-row-main">
        <span className="set-row-title">{label}</span>
        {hint ? <span className="set-row-desc">{hint}</span> : null}
      </span>
      <span className="set-row-right plugin-set-control">{control}</span>
    </div>;
  };

  return <>
    {error && <div className="settings-error">{error}</div>}
    {note && <div className="settings-success">{note}</div>}
    {sections.map((section, index) => <SettingsGroup key={`${section.title}-${index}`} label={section.title} desc={section.description}>
      {section.fields.map(renderField)}
    </SettingsGroup>)}
    <div className="plugin-form-actions">
      <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : saved ? "已保存" : "保存设置"}</button>
    </div>
  </>;
}
