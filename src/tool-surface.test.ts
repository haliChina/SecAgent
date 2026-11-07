import assert from "node:assert/strict";
import test from "node:test";
import { buildToolGroups, executeToolSurfaceAction, filterToolSurface, parkedGroups, resetSurface, toolSurfaceTool } from "./tool-surface.js";

const mcpTool = (server: string, name: string, hidden = false) => ({ key: `mcp__${server}__${name}`, server, name, description: `${name} 工具。第一句。第二句。`, inputSchema: {}, hidden });

const pluginTool = (name: string, hidden = false) => ({ key: `plug__${name}`, description: `${name} 插件工具。第一句。`, inputSchema: {}, hidden });

const pluginGroups = [
  { id: "computer-use", name: "电脑控制", tools: [pluginTool("click"), pluginTool("type"), pluginTool("act")] },
  { id: "desktop-pet", name: "桌宠", tools: [pluginTool("skin")] }
];

const mcpTools = [mcpTool("github", "create_issue"), mcpTool("github", "list_prs"), mcpTool("weather", "forecast")];

test("buildToolGroups：MCP 按服务器、插件按 id 分组，hidden 不计入", () => {
  const hiddenIn = [mcpTool("github", "secret_admin", true)];
  const groups = buildToolGroups([...mcpTools, ...hiddenIn], pluginGroups);
  const byId = new Map(groups.map((g) => [g.id, g]));
  assert.equal(byId.get("mcp:github")?.tools.length, 2); // hidden 不进目录
  assert.equal(byId.get("mcp:weather")?.tools.length, 1);
  assert.equal(byId.get("plugin:computer-use")?.tools.length, 3);
  assert.equal(byId.get("plugin:desktop-pet")?.name, "桌宠");
});

test("filterToolSurface：未收起时全量透出", () => {
  const s = filterToolSurface("s1", mcpTools, pluginGroups);
  assert.equal(s.mcp.length, 3);
  assert.equal(s.plugin.length, 4);
});

test("park 后 schema 过滤、dispatch 不受影响；mount 恢复", () => {
  const s1 = filterToolSurface("s2", mcpTools, pluginGroups);
  assert.equal(s1.mcp.length, 3);
  executeToolSurfaceAction("s2", buildToolGroups(mcpTools, pluginGroups), { action: "park", groups: ["mcp:github"] });
  const s2 = filterToolSurface("s2", mcpTools, pluginGroups);
  assert.equal(s2.mcp.length, 1); // 只剩 weather
  assert.equal(s2.mcp[0].server, "weather");
  assert.equal(s2.plugin.length, 4); // 插件未动
  executeToolSurfaceAction("s2", buildToolGroups(mcpTools, pluginGroups), { action: "mount", groups: ["mcp:github"] });
  const s3 = filterToolSurface("s2", mcpTools, pluginGroups);
  assert.equal(s3.mcp.length, 3);
});

test("park 会话隔离：另一会话不受影响", () => {
  executeToolSurfaceAction("s3", buildToolGroups(mcpTools, pluginGroups), { action: "park", groups: ["mcp:github", "plugin:computer-use"] });
  const other = filterToolSurface("s4", mcpTools, pluginGroups);
  assert.equal(other.mcp.length, 3);
  assert.equal(other.plugin.length, 4);
  const mine = filterToolSurface("s3", mcpTools, pluginGroups);
  assert.equal(mine.mcp.length, 1);
  assert.equal(mine.plugin.length, 1); // 只剩 desktop-pet 的 skin
  assert.equal(mine.plugin[0].key, "plug__skin");
});

test("list 目录含组 id/工具名/首句描述与收起标记；未知 id 报错列出可用组", async () => {
  executeToolSurfaceAction("s5", buildToolGroups(mcpTools, pluginGroups), { action: "park", groups: ["mcp:github"] });
  const r = (executeToolSurfaceAction("s5", buildToolGroups(mcpTools, pluginGroups), { action: "list" })).result as string;
  assert.match(r, /mcp:github/);
  assert.match(r, /create_issue/);
  assert.match(r, /已收起/);
  assert.match(r, /第一句/);
  // 未知 id：park 不报错但结果里列出未识别项（容错设计）
  const pr = executeToolSurfaceAction("s5", buildToolGroups(mcpTools, pluginGroups), { action: "park", groups: ["mcp:nosuch"] });
  assert.match(String(pr.result), /未识别/);
});

test("reset 清空收起状态；返回的是快照副本", () => {
  executeToolSurfaceAction("s6", buildToolGroups(mcpTools, pluginGroups), { action: "park", groups: ["mcp:github"] });
  const snap = parkedGroups("s6");
  assert.deepEqual(snap, ["mcp:github"]);
  snap.push("mcp:weather"); // 不应影响内部状态
  const after = filterToolSurface("s6", mcpTools, pluginGroups);
  assert.equal(after.mcp.length, 1, "外部改动返回数组不影响真实过滤");
  executeToolSurfaceAction("s6", buildToolGroups(mcpTools, pluginGroups), { action: "reset" });
  assert.deepEqual(parkedGroups("s6"), []);
  const restored = filterToolSurface("s6", mcpTools, pluginGroups);
  assert.equal(restored.mcp.length, 3);
});

test("meta 工具定义：四个动作枚举、组参数可选", () => {
  assert.equal(toolSurfaceTool.key, "secagent__tool_surface");
  const schema = toolSurfaceTool.inputSchema as { properties: Record<string, unknown>; required: string[] };
  assert.equal(schema.required[0], "action");
  assert.ok("groups" in schema.properties);
  const action = schema.properties.action as { enum: string[] };
  assert.deepEqual(action.enum, ["list", "park", "mount", "reset"]);
});

test("缺 groups 报错；非法 action 报错", async () => {
  assert.throws(() => executeToolSurfaceAction("s7", [], { action: "park", groups: [] }), /groups/);
  assert.throws(() => executeToolSurfaceAction("s7", [], { action: "explode" }), /action/);
});
