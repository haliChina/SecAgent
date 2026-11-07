import type { AgentTool } from "./model-provider.js";
import type { PluginToolDefinition } from "./types.js";

/**
 * 工具面管理（借鉴 dsh-ctx-gate / dsh-ops 动态目录）：按「工具组」收起/挂载工具定义，
 * 省掉每轮固定重发的 schema 字节。分组单位=MCP 服务器（mcp:<server>）或插件（plugin:<id>）。
 *
 * 语义（诚实边界，对齐 dsh-ops "next-step activation"）：
 * - park 立即生效于后续轮次（当前轮 schema 已发出，无法撤回）；
 * - mount 于下一轮对话生效（当前轮 schema 固定）；
 * - 收起的只是「可见 schema」：工具仍可按名直接调用（dispatch 与 schema 分离）。
 * - 状态按会话隔离，进程重启即复位；上限 64 会话防泄漏。
 */

export interface ToolGroup {
  /** 组标识：mcp:<server> 或 plugin:<pluginId>。 */
  id: string;
  /** 展示名：服务器名或插件名。 */
  name: string;
  /** 可见（非 hidden）工具。 */
  tools: Array<{ key: string; description: string }>;
}

const MAX_TRACKED_SESSIONS = 64;

const sessionParked = new Map<string, Set<string>>();

function parkedFor(sessionId: string): Set<string> {
  return sessionParked.get(sessionId) ?? new Set<string>();
}

function saveParked(sessionId: string, next: Set<string>): void {
  if (next.size === 0) sessionParked.delete(sessionId);
  else {
    if (sessionParked.size >= MAX_TRACKED_SESSIONS && !sessionParked.has(sessionId)) {
      const oldest = sessionParked.keys().next().value;
      if (oldest) sessionParked.delete(oldest);
    }
    sessionParked.set(sessionId, next);
  }
}

export function parkedGroups(sessionId: string): string[] {
  return [...parkedFor(sessionId)];
}

function parkGroups(sessionId: string, groupIds: string[]): { parked: string[] } {
  const next = parkedFor(sessionId);
  for (const id of groupIds) next.add(id);
  saveParked(sessionId, next);
  return { parked: [...next] };
}

function mountGroups(sessionId: string, groupIds: string[]): { mounted: string[]; parked: string[] } {
  const next = parkedFor(sessionId);
  for (const id of groupIds) next.delete(id);
  saveParked(sessionId, next);
  return { mounted: groupIds, parked: [...next] };
}

export function resetSurface(sessionId: string): void {
  sessionParked.delete(sessionId);
}

/** 由 MCP 工具（带 server 字段）+ 插件分组构建组清单。 */
export function buildToolGroups(
  mcpTools: Array<{ key: string; description?: string; server: string; hidden?: boolean }>,
  pluginGroups: Array<{ id: string; name: string; tools: PluginToolDefinition[] }>
): ToolGroup[] {
  const byServer = new Map<string, ToolGroup>();
  for (const tool of mcpTools) {
    if (tool.hidden) continue;
    const id = `mcp:${tool.server}`;
    let group = byServer.get(id);
    if (!group) {
      group = { id, name: tool.server, tools: [] };
      byServer.set(id, group);
    }
    group.tools.push({ key: tool.key, description: tool.description ?? "" });
  }
  const pluginResult = pluginGroups
    .filter((g) => g.tools.some((t) => !t.hidden))
    .map((g) => ({
      id: `plugin:${g.id}`,
      name: g.name || g.id,
      tools: g.tools.filter((t) => !t.hidden).map((t) => ({ key: t.key, description: t.description }))
    }));
  return [...byServer.values(), ...pluginResult];
}

/** 过滤工具面：收起组的可见工具不再下发 schema（hidden 工具本就不下发，跳过）。 */
export function filterToolSurface<T extends { key: string; server?: string; hidden?: boolean }>(
  sessionId: string,
  mcpTools: T[],
  pluginGroups: Array<{ id: string; tools: PluginToolDefinition[] }>
): { mcp: T[]; plugin: PluginToolDefinition[] } {
  const parked = parkedFor(sessionId);
  if (parked.size === 0) return { mcp: mcpTools, plugin: pluginGroups.flatMap((g) => g.tools) };
  const mcp = mcpTools.filter((tool) => !tool.hidden && parked.has(`mcp:${tool.server}`) ? false : true);
  const plugin = pluginGroups
    .filter((g) => !parked.has(`plugin:${g.id}`))
    .flatMap((g) => g.tools);
  return { mcp, plugin };
}

/** 目录文本：给模型看的组清单（收起组的工具名列出，供其决定挂载或按名直调）。 */
function describeGroups(groups: ToolGroup[], parked: string[], maxToolsPerGroup = 30): string {
  if (!groups.length) return "当前没有可管理的工具组（无 MCP 服务器与插件工具）。";
  const lines: string[] = [];
  for (const group of groups) {
    const isParked = parked.includes(group.id);
    const head = `- ${group.id}（${group.name}，${group.tools.length} 个工具）${isParked ? "【已收起】" : "【已挂载】"}`;
    const tools = group.tools.slice(0, maxToolsPerGroup).map((t) => `  · ${t.key} — ${firstSentence(t.description)}`);
    const more = group.tools.length > maxToolsPerGroup ? [`  · …另有 ${group.tools.length - maxToolsPerGroup} 个工具`] : [];
    lines.push([head, ...tools, ...more].join("\n"));
  }
  lines.push("");
  lines.push("park 后组内工具 schema 不再随每轮请求下发（省 token）；工具仍可按名直接调用（参数以你已知的契约为准）。mount 挂载后下一轮对话恢复完整 schema。");
  return lines.join("\n");
}

function firstSentence(text: string): string {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "（无描述）";
  const cut = clean.slice(0, 60);
  return cut.length < clean.length ? `${cut}…` : cut;
}

const TOOL_SURFACE_KEY = "secagent__tool_surface";

export const toolSurfaceTool: AgentTool = {
  key: TOOL_SURFACE_KEY,
  description:
    "管理本会话的工具面（收起不用的工具组省 token，需要时再挂载）。action=list 列出全部工具组及收起状态；action=park 收起指定组（groups 传组 id，如 mcp:github、plugin:computer-use），此后每轮请求不再重发其 schema，工具仍可按名直接调用；action=mount 挂回指定组，下一轮对话生效；action=reset 全部挂载。长会话里发现某组工具与任务无关时主动收起，能显著降低上下文占用。",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["list", "park", "mount", "reset"], description: "list=查看工具组；park=收起（省 token）；mount=挂回；reset=全部挂载" },
      groups: { type: "array", items: { type: "string" }, description: "组 id 列表（park/mount 用），如 mcp:github、plugin:computer-use" }
    }
  }
};

/** 元工具执行器：返回给模型的说明文本。 */
export function executeToolSurfaceAction(
  sessionId: string,
  groups: ToolGroup[],
  args: Record<string, unknown>
): { result: string; parked: string[] } {
  const action = String(args.action ?? "list");
  const ids = Array.isArray(args.groups) ? args.groups.map((g) => String(g)) : [];
  if (action === "list") {
    return { result: describeGroups(groups, parkedGroups(sessionId)), parked: parkedGroups(sessionId) };
  }
  if (action === "park") {
    if (!ids.length) throw new Error("park 需要 groups（组 id 列表，先用 action=list 查看）");
    const known = new Set(groups.map((g) => g.id));
    const unknown = ids.filter((id) => !known.has(id));
    const { parked } = parkGroups(sessionId, ids.filter((id) => known.has(id)));
    let result = `已收起 ${ids.filter((id) => known.has(id)).length} 个组，从下一轮起不再下发其 schema。收起的工具仍可按名直接调用。当前已收起：${parked.length ? parked.join("、") : "（无）"}`;
    if (unknown.length) result += `；未识别的组 id：${unknown.join("、")}（用 action=list 查看全部组）`;
    return { result, parked };
  }
  if (action === "mount") {
    if (!ids.length) throw new Error("mount 需要 groups（组 id 列表）");
    const { parked } = mountGroups(sessionId, ids);
    return { result: `已挂载 ${ids.length} 个组，下一轮对话起恢复完整 schema。当前仍收起：${parked.length ? parked.join("、") : "（无）"}`, parked };
  }
  if (action === "reset") {
    resetSurface(sessionId);
    return { result: "已恢复全部工具组，下一轮对话起生效。", parked: [] };
  }
  throw new Error("action 必须是 list / park / mount / reset");
}
