/**
 * 插件声明式设置页协议（describe → 表单）的纯逻辑层。
 *
 * 插件（ClassIsland联动 / 桌宠 / Computer Use）通过
 * `registerSettingsHandler(pageId, handler)` 返回 describe 结构，宿主不再硬编码
 * 各插件表单。本模块只负责归一化与字段语义判断，方便单测；渲染在
 * PluginFormSettingsPage。
 *
 * 支持两种 describe 形态：
 *   ① { groups, fields } —— 字段平铺、每个 field 带 group（ClassIsland联动）
 *   ② { groups: [{ fields }] } —— 分组内嵌字段（桌宠 / Computer Use）
 *
 * 字段扩展（相对 R76 初版）：
 *   - hidden: 只参与 values/payload，不在表单渲染
 *   - effect: immediate / guidance，用于「立即生效 / 提示词引导」标识
 *   - type: text / number / boolean / select / password / textarea / path
 *   - pathKind: file / directory（type=path 时决定文件选择框）
 *   - actions: [{ id, label, description?, confirm?, danger? }]，宿主渲染按钮并
 *     调用 `action`，插件返回 note/items 即可直接展示。
 */

export interface PluginSettingOption { value: string; label?: string }
export interface PluginSettingField {
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
  options?: PluginSettingOption[];
  hidden?: boolean;
  effect?: string;
  pathKind?: string;
  multiline?: boolean;
}
export interface PluginSettingGroup { id?: string; title?: string; description?: string; fields?: PluginSettingField[] }
export interface PluginSettingAction { id: string; label: string; description?: string; confirm?: string; danger?: boolean }
/** 带实时状态的服务面板（Computer Use 的 OmniParser / 浏览器扩展桥）。 */
export interface PluginSettingPanel {
  id: string;
  title: string;
  description?: string;
  /** 每次轮询调用的插件设置 action。 */
  statusAction: string;
  /** 轮询间隔；0 表示只在打开页面和操作后刷新。 */
  pollMs?: number;
}
export interface PluginPanelAction { id: string; label: string; primary?: boolean; danger?: boolean; disabled?: boolean; confirm?: string }
interface PluginPanelFact { label: string; value: string }
export interface PluginPanelStatus {
  phase?: string;
  label?: string;
  message?: string;
  progress?: number | null;
  facts?: PluginPanelFact[];
  actions?: PluginPanelAction[];
}
export interface PluginSettingsDescribe {
  ok?: boolean;
  groups?: PluginSettingGroup[];
  fields?: PluginSettingField[];
  values?: Record<string, unknown>;
  actions?: PluginSettingAction[];
  panels?: PluginSettingPanel[];
}
export interface PluginSettingsSection { title: string; description: string; fields: PluginSettingField[] }
export interface NormalizedPluginSettings { sections: PluginSettingsSection[]; actions: PluginSettingAction[]; fields: PluginSettingField[]; panels: PluginSettingPanel[] }

type PluginFieldKind = "boolean" | "select" | "number" | "path" | "password" | "textarea" | "text";

export function normalizePluginSettings(raw: PluginSettingsDescribe | null | undefined): NormalizedPluginSettings {
  if (!raw) return { sections: [], actions: [], fields: [], panels: [] };
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const actions = normalizeActions(raw.actions);
  const panels = normalizePanels(raw.panels);
  const sections: PluginSettingsSection[] = [];
  const flat = Array.isArray(raw.fields) ? raw.fields : null;
  const allFields = flat
    ? flat.filter((field) => Boolean(field?.key))
    : groups.flatMap((group) => Array.isArray(group?.fields) ? group.fields.filter((field) => Boolean(field?.key)) : []);
  if (flat) {
    const buckets = new Map<string, PluginSettingField[]>();
    for (const field of flat) {
      if (!field || typeof field.key !== "string" || !field.key) continue;
      const groupId = field.group || "general";
      const bucket = buckets.get(groupId) || [];
      bucket.push(field);
      buckets.set(groupId, bucket);
    }
    const seen = new Set<string>();
    for (const group of groups) {
      const fields = visibleFields(buckets.get(group?.id || "") || []);
      seen.add(group?.id || "");
      if (fields.length) sections.push({ title: group?.title || group?.id || "设置", description: group?.description || "", fields });
    }
    for (const [groupId, fields] of buckets) {
      if (!seen.has(groupId)) {
        const visible = visibleFields(fields);
        if (visible.length) sections.push({ title: groupId, description: "", fields: visible });
      }
    }
    return { sections, actions, fields: allFields, panels };
  }
  for (const group of groups) {
    const fields = visibleFields(Array.isArray(group?.fields) ? group.fields : []);
    if (fields.length) sections.push({ title: group?.title || group?.id || "设置", description: group?.description || "", fields });
  }
  return { sections, actions, fields: allFields, panels };
}

function visibleFields(fields: PluginSettingField[]): PluginSettingField[] {
  return fields.filter((field) => Boolean(field?.key) && field.hidden !== true);
}

function normalizeActions(input: PluginSettingAction[] | undefined): PluginSettingAction[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: PluginSettingAction[] = [];
  for (const action of input) {
    if (!action || typeof action.id !== "string" || !action.id || typeof action.label !== "string" || !action.label) continue;
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    out.push({
      id: action.id,
      label: action.label,
      ...(typeof action.description === "string" && action.description ? { description: action.description } : {}),
      ...(typeof action.confirm === "string" && action.confirm ? { confirm: action.confirm } : {}),
      ...(action.danger === true ? { danger: true } : {}),
    });
  }
  return out;
}

function normalizePanels(input: PluginSettingPanel[] | undefined): PluginSettingPanel[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: PluginSettingPanel[] = [];
  for (const panel of input) {
    if (!panel || typeof panel.id !== "string" || !panel.id || typeof panel.title !== "string" || !panel.title) continue;
    if (typeof panel.statusAction !== "string" || !panel.statusAction) continue;
    if (seen.has(panel.id)) continue;
    seen.add(panel.id);
    const pollMs = typeof panel.pollMs === "number" && Number.isFinite(panel.pollMs) && panel.pollMs >= 0
      ? Math.min(Math.round(panel.pollMs), 30000)
      : 2000;
    out.push({
      id: panel.id,
      title: panel.title,
      statusAction: panel.statusAction,
      pollMs,
      ...(typeof panel.description === "string" && panel.description ? { description: panel.description } : {})
    });
  }
  return out;
}

/** 插件状态响应的保守归一：缺失字段直接省略，进度夹到 0–100。 */
export function normalizePluginPanelStatus(raw: unknown): PluginPanelStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const status: PluginPanelStatus = {};
  if (typeof source.phase === "string" && source.phase) status.phase = source.phase;
  if (typeof source.label === "string" && source.label) status.label = source.label;
  if (typeof source.message === "string" && source.message) status.message = source.message;
  if (typeof source.progress === "number" && Number.isFinite(source.progress)) {
    status.progress = Math.max(0, Math.min(100, Math.round(source.progress)));
  }
  if (Array.isArray(source.facts)) {
    const facts = source.facts.flatMap((fact) => {
      if (!fact || typeof fact !== "object") return [];
      const item = fact as Record<string, unknown>;
      if (typeof item.label !== "string" || !item.label) return [];
      const value = typeof item.value === "string" ? item.value : typeof item.value === "number" ? String(item.value) : "";
      return value ? [{ label: item.label, value }] : [];
    });
    if (facts.length) status.facts = facts;
  }
  if (Array.isArray(source.actions)) {
    const actions = source.actions.flatMap((action) => {
      if (!action || typeof action !== "object") return [];
      const item = action as Record<string, unknown>;
      if (typeof item.id !== "string" || !item.id || typeof item.label !== "string" || !item.label) return [];
      return [{
        id: item.id,
        label: item.label,
        ...(item.primary === true ? { primary: true } : {}),
        ...(item.danger === true ? { danger: true } : {}),
        ...(item.disabled === true ? { disabled: true } : {}),
        ...(typeof item.confirm === "string" && item.confirm ? { confirm: item.confirm } : {})
      }];
    });
    if (actions.length) status.actions = actions;
  }
  return status;
}

const PANEL_PHASE_LABELS: Record<string, string> = {
  "not-installed": "未安装",
  installing: "安装中",
  installed: "已安装",
  starting: "启动中",
  running: "运行中",
  stopped: "已停止",
  error: "错误",
  connected: "已连接",
  pending: "等待允许",
  waiting: "等待连接",
  ready: "就绪"
};

export function pluginPhaseLabel(phase: string | undefined): string {
  return phase ? PANEL_PHASE_LABELS[phase] || phase : "未连接";
}

export function pluginFieldKind(field: PluginSettingField): PluginFieldKind {
  const type = (field.type || "").toLowerCase();
  if (type === "boolean" || type === "bool" || type === "toggle") return "boolean";
  if (type === "select" && Array.isArray(field.options) && field.options.length) return "select";
  if (type === "number") return "number";
  if (type === "password" || type === "secret") return "password";
  if (type === "textarea" || field.multiline === true) return "textarea";
  if (type === "path" || type === "file" || type === "folder" || type === "directory" || field.pathKind) return "path";
  return "text";
}

export function pluginPathKind(field: PluginSettingField): "file" | "directory" {
  return field.pathKind === "file" || (field.type || "").toLowerCase() === "file" ? "file" : "directory";
}

export function pluginFieldHint(field: PluginSettingField): string {
  return field.hint || field.help || "";
}

/** 布尔/数字/字符串按字段类型归一成可编辑值；数字保持字符串以支持中间态。 */
export function pluginFieldDefault(field: PluginSettingField): unknown {
  if (field.default === undefined || field.default === null) return undefined;
  const kind = pluginFieldKind(field);
  if (kind === "boolean") return Boolean(field.default);
  if (kind === "number") {
    const parsed = Number(field.default);
    return Number.isFinite(parsed) ? String(parsed) : String(field.default);
  }
  return String(field.default);
}

export function pluginValueMatchesDefault(field: PluginSettingField, value: unknown): boolean {
  const fallback = pluginFieldDefault(field);
  if (fallback === undefined) return true;
  if (typeof fallback === "boolean") return value === fallback;
  return String(value ?? "") === String(fallback);
}

/** 顶层键排序后比较，避免服务端返回对象顺序不同导致误判“有未保存改动”。 */
export function pluginValuesEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
}

/** action 返回值 → 一行可读结果；优先 note/message，其次 skins/items 列表，最后 JSON。 */
export function summarizePluginActionResult(result: unknown): string {
  if (result === undefined || result === null) return "操作完成";
  if (typeof result !== "object") return String(result);
  const record = result as Record<string, unknown>;
  for (const key of ["note", "message", "error"]) {
    const text = record[key];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  for (const key of ["skins", "items"]) {
    const list = record[key];
    if (Array.isArray(list)) {
      const labels = list.flatMap((item) => {
        if (typeof item === "string") return [item];
        if (item && typeof item === "object") {
          const label = (item as Record<string, unknown>).displayName ?? (item as Record<string, unknown>).label ?? (item as Record<string, unknown>).id;
          if (typeof label === "string") return [label];
        }
        return [];
      });
      if (labels.length) return labels.join("、");
    }
  }
  /* 插件 action 的返回结构各不同（ClassIsland 的 companion/local、Computer Use
     的 ext-status），把两层以内的标量压成 `key: value` 行，比整段 JSON 好读。 */
  const lines = flattenSummary(record);
  if (lines.length) return lines.join("\n");
  try {
    const text = JSON.stringify(result);
    return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
  } catch {
    return "操作完成";
  }
}

function flattenSummary(record: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const format = (value: unknown): string => Array.isArray(value)
    ? value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join("、")
    : String(value);
  for (const [key, value] of Object.entries(record)) {
    if (lines.length >= 16) { lines.push("…"); break; }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      lines.push(`${key}: ${format(value)}`);
      continue;
    }
    for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
      if (lines.length >= 16) { lines.push("…"); return lines; }
      if (subValue !== null && typeof subValue === "object" && !Array.isArray(subValue)) continue;
      lines.push(`${key}.${subKey}: ${format(subValue)}`);
    }
  }
  return lines;
}
