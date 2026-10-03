import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { AuditStore } from "./audit.js";
import { PluginManager } from "./plugin-manager.js";
import { SecAgentRuntime } from "./runtime.js";
import type { SecAgentConfig } from "./types.js";
import type { ActivityEvent } from "./activity.js";

interface ExposedApi {
  onActivity(handler: (event: ActivityEvent) => void): () => void;
  getActivity(): { phase: string; last: ActivityEvent | null };
}

function temp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `secagent-${prefix}-`));
}

function baseConfig(workspace: string, overrides: Record<string, unknown> = {}): SecAgentConfig {
  return {
    workspace,
    agent: {
      provider: "openai-compatible", model: "unused", apiKeyEnv: "UNUSED",
      baseUrl: "http://127.0.0.1:1", endpoint: "/chat/completions", maxTokens: 100, systemPrompt: "unused",
    },
    mcp: { servers: {} },
    version: 1,
    ...overrides,
  } as SecAgentConfig;
}

function exposeApi(): ExposedApi {
  return (globalThis as unknown as { __api: ExposedApi }).__api;
}

/** 装一个只把 api 暴露到 globalThis 的插件，让测试直接订阅。 */
async function withApi(name: string, body: (api: ExposedApi, manager: PluginManager, workspace: string) => Promise<void>): Promise<void> {
  const workspace = temp(name);
  const archivePath = path.join(workspace, "observer.zip");
  const archive = new AdmZip() as unknown as { addFile(n: string, d: Buffer): void; writeZip(f: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({
    apiVersion: 1, id: "observer", name: "Observer", version: "1.0.0", main: "main.mjs",
    permissions: ["agent.tools", "agent.pre_rules", "agent.activity"],
  })));
  archive.addFile("main.mjs", Buffer.from("export function activate(api) { globalThis.__api = api; }"));
  archive.writeZip(archivePath);
  const manager = new PluginManager(workspace);
  await manager.initialize();
  await manager.install(archivePath);
  try {
    await body(exposeApi(), manager, workspace);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

test("回合经前置规则短路时派发完整序列，且不泄露提示词与工具结果", async () => {
  const seen: ActivityEvent[] = [];
  await withApi("activity-prerule", async (api, manager, workspace) => {
    const archivePath = path.join(workspace, "pre.zip");
    const archive = new AdmZip() as unknown as { addFile(n: string, d: Buffer): void; writeZip(f: string): void };
    archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "prerule", name: "PR", version: "1.0.0", main: "main.mjs", permissions: ["agent.tools", "agent.pre_rules"] })));
    archive.addFile("main.mjs", Buffer.from(`
export function activate(api) {
  api.registerTool({ name: "noop", description: "noop", hidden: true, inputSchema: { type: "object" } }, async () => ({ secret: "结果不该外泄" }));
  api.registerPreRule("noop_rule", (input) => input === "用户私密的提示词" ? { tool: "noop", arguments: {}, render: () => "模型回复也不该外泄" } : undefined);
}
`));
    archive.writeZip(archivePath);
    await manager.install(archivePath);
    api.onActivity((event) => { seen.push(event); });

    const runtime = new SecAgentRuntime(baseConfig(workspace), new AuditStore(workspace), [], undefined, manager);
    await runtime.run("用户私密的提示词", "high", [{ role: "user", content: "用户私密的提示词" }], undefined, { sessionId: "sess-7" });

    const kinds = seen.map((e) => e.kind);
    assert.ok(kinds.includes("turn_started"), `缺少 turn_started：${kinds.join(",")}`);
    assert.ok(kinds.includes("tool_started"));
    assert.ok(kinds.includes("turn_completed"));
    assert.ok(kinds.indexOf("turn_started") < kinds.indexOf("turn_completed"));
    assert.ok(seen.every((e) => e.sessionId === "sess-7"), "会话 id 没透传");

    const serialized = JSON.stringify(seen);
    assert.equal(serialized.includes("用户私密的提示词"), false, "事件里泄露了用户提示词");
    assert.equal(serialized.includes("结果不该外泄"), false, "事件里泄露了工具结果");
    assert.equal(serialized.includes("模型回复也不该外泄"), false, "事件里泄露了模型回复");
  });
});

test("工具走审批闸门时派发 approval_requested / approval_resolved", async () => {
  const seen: ActivityEvent[] = [];
  await withApi("activity-approval", async (api, manager, workspace) => {
    const archivePath = path.join(workspace, "tool.zip");
    const archive = new AdmZip() as unknown as { addFile(n: string, d: Buffer): void; writeZip(f: string): void };
    archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "guarded", name: "G", version: "1.0.0", main: "main.mjs", permissions: ["agent.tools", "agent.pre_rules"] })));
    archive.addFile("main.mjs", Buffer.from(`
export function activate(api) {
  api.registerTool({ name: "sh", description: "sh", hidden: true, inputSchema: { type: "object" } }, async () => ({ ok: true }));
  api.registerPreRule("run_danger", (input) => input === "危险" ? { tool: "sh", arguments: { command: "rm -rf /tmp/x", note: "不该外泄" } } : undefined);
}
`));
    archive.writeZip(archivePath);
    await manager.install(archivePath);
    api.onActivity((event) => { seen.push(event); });

    const runtime = new SecAgentRuntime(
      baseConfig(workspace, { guard: { enabled: true, approved: [] } }),
      new AuditStore(workspace),
      [],
      undefined,
      manager,
      { confirmToolCall: async () => true }, // 用户点了「同意」
    );
    const result = await runtime.run("危险", "high", [{ role: "user", content: "危险" }], undefined, { sessionId: "s1" });
    const kinds = seen.map((e) => e.kind);
    assert.ok(kinds.includes("approval_requested"), `缺少 approval_requested：${kinds.join(",")}`);
    assert.ok(kinds.includes("approval_resolved"), `缺少 approval_resolved：${kinds.join(",")}`);
    assert.ok(kinds.includes("tool_started"));
    assert.ok(kinds.includes("tool_finished"));
    assert.ok(kinds.includes("turn_completed"));
    assert.ok(result.message);
    assert.equal(seen.find((e) => e.kind === "approval_requested")?.label, "guarded__sh");
    assert.equal(JSON.stringify(seen).includes("不该外泄"), false, "审批事件泄露了工具参数");
  });
});

test("中断派发 turn_blocked(aborted)，真实异常派发 turn_failed(error)", async (t) => {
  const seen: ActivityEvent[] = [];
  // 走真实网络分支需要密钥环境变量；不给会在请求发出前就失败，测不到 abort
  t.after(() => { delete process.env.SECAGENT_ACTIVITY_TEST_KEY; });
  process.env.SECAGENT_ACTIVITY_TEST_KEY = "test-key";
  await withApi("activity-terminal", async (api, manager, workspace) => {
    api.onActivity((event) => { seen.push(event); });

    // 入口就 abort：不构成一个回合，不应有任何事件
    const dry = new SecAgentRuntime(baseConfig(workspace), new AuditStore(workspace), [], undefined, manager);
    const preAborted = new AbortController();
    preAborted.abort();
    await assert.rejects(() => dry.run("停", "high", undefined, preAborted.signal, { sessionId: "s2" }));
    assert.equal(seen.length, 0, `入口 abort 不该派发任何事件：${seen.map((e) => e.kind).join(",")}`);

    // 挂起的服务：连接建立但不响应，只有 abort 能让请求结束 → 可确定地测到中断
    const hanging = http.createServer(() => { /* 故意不响应 */ });
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const port = (hanging.address() as { port: number }).port;
    try {
      const hangingConfig = baseConfig(workspace, {
        agent: {
          provider: "openai-compatible", model: "unused", apiKeyEnv: "SECAGENT_ACTIVITY_TEST_KEY",
          baseUrl: `http://127.0.0.1:${port}`, endpoint: "/chat/completions",
          maxTokens: 100, systemPrompt: "unused",
        },
      });
      const runtime = new SecAgentRuntime(hangingConfig, new AuditStore(workspace), [], undefined, manager);
      const aborting = new AbortController();
      setTimeout(() => aborting.abort(), 40);
      await assert.rejects(() => runtime.run("再试", "high", undefined, aborting.signal, { sessionId: "s2" }));
      const blocked = seen.filter((e) => e.kind === "turn_blocked");
      assert.ok(blocked.length >= 1, `缺少 turn_blocked：${seen.map((e) => e.kind).join(",")}`);
      assert.equal(blocked.at(-1)?.reason, "aborted");
      // 中断不是失败：伴生 UI 对两者反应不同（用户自己停掉的 ≠ 出错了）
      assert.equal(seen.some((e) => e.kind === "turn_failed"), false, "中断被误报成失败");

      seen.length = 0;
      const refused = new SecAgentRuntime(
        baseConfig(workspace, { agent: { ...(baseConfig(workspace).agent as unknown as Record<string, unknown>), apiKeyEnv: "SECAGENT_ACTIVITY_TEST_KEY" } }),
        new AuditStore(workspace), [], undefined, manager,
      );
      await assert.rejects(() => refused.run("失败", "high", undefined, undefined, { sessionId: "s3" }));
      const failed = seen.filter((e) => e.kind === "turn_failed");
      assert.ok(failed.length >= 1, `缺少 turn_failed：${seen.map((e) => e.kind).join(",")}`);
      assert.equal(failed.at(-1)?.reason, "error");
      assert.equal(seen.at(-1)?.sessionId, "s3");
      // 异常原文不外泄
      assert.equal(JSON.stringify(seen).includes("ECONNREFUSED"), false, "事件里泄露了错误原文");
    } finally {
      hanging.close();
    }
  });
});

test("没有订阅者时派发不影响回合行为，快照仍记录最终状态", async () => {
  const workspace = temp("activity-nosub");
  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    const runtime = new SecAgentRuntime(baseConfig(workspace), new AuditStore(workspace), [], undefined, manager);
    await assert.rejects(() => runtime.run("嗨", "high", undefined, undefined, { sessionId: "s4" }));
    assert.equal(manager.getActivity().phase, "failed");
    assert.equal(manager.getActivity().last?.sessionId, "s4");
    await manager.shutdown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});