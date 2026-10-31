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
export interface PluginSettingsDescribe {
  ok?: boolean;
  groups?: PluginSettingGroup[];
  fields?: PluginSettingField[];
  values?: Record<string, unknown>;
  actions?: PluginSettingAction[];
}
export interface PluginSettingsSection { title: string; description: string; fields: PluginSettingField[] }
export interface NormalizedPluginSettings { sections: PluginSettingsSection[]; actions: PluginSettingAction[]; fields: PluginSettingField[] }

type PluginFieldKind = "boolean" | "select" | "number" | "path" | "password" | "textarea" | "text";

export function normalizePluginSettings(raw: PluginSettingsDescribe | null | undefined): NormalizedPluginSettings {
  if (!raw) return { sections: [], actions: [], fields: [] };
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const actions = normalizeActions(raw.actions);
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
    return { sections, actions, fields: allFields };
  }
  for (const group of groups) {
    const fields = visibleFields(Array.isArray(group?.fields) ? group.fields : []);
    if (fields.length) sections.push({ title: group?.title || group?.id || "设置", description: group?.description || "", fields });
  }
  return { sections, actions, fields: allFields };
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
