import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { PluginManager } from "./plugin-manager.js";
import { isTerminal, phaseOf, sanitizeActivityEvent, type ActivityEvent, type ActivityKind } from "./activity.js";

interface Harness {
  workspace: string;
  archive(name: string, body: string, permissions: string[]): string;
  cleanup(): void;
}

function harness(name: string): Harness {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `secagent-${name}-`));
  return {
    workspace,
    archive(file: string, body: string, permissions: string[]) {
      const archivePath = path.join(workspace, `${file}.zip`);
      const zip = new AdmZip() as unknown as { addFile(n: string, d: Buffer): void; writeZip(f: string): void };
      zip.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({
        apiVersion: 1, id: file, name: file, version: "1.0.0", main: "main.mjs", permissions,
      })));
      zip.addFile("main.mjs", Buffer.from(body));
      zip.writeZip(archivePath);
      return archivePath;
    },
    cleanup() { fs.rmSync(workspace, { recursive: true, force: true }); },
  };
}

/** 取出测试插件的内部订阅集合，用于直接验证扇出/清理语义。 */
function handlersOf(manager: PluginManager, pluginId: string): Set<(event: ActivityEvent) => void> {
  const active = (manager as unknown as { active: Map<string, { activityHandlers: Set<(event: ActivityEvent) => void> }> }).active.get(pluginId);
  assert.ok(active, `插件 ${pluginId} 未激活`);
  return active.activityHandlers;
}

test("phaseOf 映射符合社区约定（工具返回后回到思考，不是停在 running）", () => {
  assert.equal(phaseOf("turn_started"), "thinking");
  assert.equal(phaseOf("tool_started"), "running");
  assert.equal(phaseOf("tool_finished"), "thinking");
  assert.equal(phaseOf("approval_requested"), "waiting");
  assert.equal(phaseOf("approval_resolved"), "running");
  assert.equal(phaseOf("turn_completed"), "done");
  assert.equal(phaseOf("turn_failed"), "failed");
  // 中断/耗尽额度归到「需要注意」，不是「失败」
  assert.equal(phaseOf("turn_blocked"), "waiting");
  const kinds: ActivityKind[] = ["turn_completed", "turn_failed", "turn_blocked"];
  assert.deepEqual(kinds.filter((kind) => isTerminal(kind)), kinds);
  assert.equal(isTerminal("tool_started"), false);
});

test("sanitizeActivityEvent 只留白名单字段，label 剥控制字符并截断", () => {
  const event = sanitizeActivityEvent({
    kind: "tool_started",
    sessionId: "s".repeat(300),
    at: 1.7,
    label: "  my_tool\nname\r\n注入\t尝试  ",
    // 越权字段必须被丢掉：事件是无内容投影
    ...({ arguments: { secret: "x" }, result: "y", prompt: "z" } as unknown as Record<string, never>),
  });
  assert.equal(event.sessionId.length, 128);
  assert.equal(event.at, 1);
  assert.equal(event.label, "my_tool name  注入 尝试"); // \r\n 各自替换成一个空格
  assert.equal((event as unknown as Record<string, unknown>).arguments, undefined);
  assert.equal((event as unknown as Record<string, unknown>).result, undefined);
  assert.equal((event as unknown as Record<string, unknown>).prompt, undefined);
  assert.equal(sanitizeActivityEvent({ kind: "tool_started", sessionId: "", at: 0, label: "x".repeat(500) }).label?.length, 120);
  assert.throws(() => sanitizeActivityEvent({ kind: "nope" as never, sessionId: "", at: 0 }), /未知活动事件类型/);
  // reason 只在失败/中断类事件上生效
  assert.equal(sanitizeActivityEvent({ kind: "tool_started", sessionId: "", at: 0, reason: "error" }).reason, undefined);
  assert.equal(sanitizeActivityEvent({ kind: "turn_failed", sessionId: "", at: 0, reason: "error" }).reason, "error");
  // R2：事件被冻结——写错的插件不能污染别人看到的事件与后续快照
  const frozen = sanitizeActivityEvent({ kind: "tool_started", sessionId: "s", at: 1, label: "x" });
  assert.equal(Object.isFrozen(frozen), true);
  assert.throws(() => { (frozen as { label: string }).label = "hijacked"; }, TypeError);
  assert.equal(frozen.label, "x");
});

test("onActivity 需要 agent.activity 权限", async () => {
  const h = harness("activity-perm");
  try {
    const manager = new PluginManager(h.workspace);
    await manager.initialize();
    await manager.install(h.archive("no-perm", `
export function activate(api) {
  try { api.onActivity(() => {}); api.setStatus("意外成功"); }
  catch (error) { api.setStatus(String(error.message)); }
}
`, []));
    const status = manager.list().find((item) => item.id === "no-perm");
    assert.match(status?.message || "", /未声明权限：agent\.activity/);
    await manager.shutdown();
  } finally { h.cleanup(); }
});

test("getActivity 同样需要 agent.activity 权限（快照与事件同一敏感级别）", async () => {
  const h = harness("activity-snapshot-perm");
  try {
    const manager = new PluginManager(h.workspace);
    await manager.initialize();
    await manager.install(h.archive("snap-no-perm", `
export function activate(api) {
  try { const s = api.getActivity(); api.setStatus("意外成功 " + s.phase); }
  catch (error) { api.setStatus(String(error.message)); }
}
`, []));
    assert.match(manager.list().find((item) => item.id === "snap-no-perm")?.message || "", /未声明权限：agent\.activity/);
    await manager.shutdown();
  } finally { h.cleanup(); }
});

test("有权限时快照可直接读取", async () => {
  const h = harness("activity-snapshot-ok");
  try {
    const manager = new PluginManager(h.workspace);
    await manager.initialize();
    await manager.install(h.archive("snap-perm", `
export function activate(api) { const s = api.getActivity(); api.setStatus(s.phase); }
`, ["agent.activity"]));
    assert.equal(manager.list().find((item) => item.id === "snap-perm")?.message, "idle");
    await manager.shutdown();
  } finally { h.cleanup(); }
});

test("订阅扇出、退订、停用插件自动解除订阅", async () => {
  const h = harness("activity-lifecycle");
  try {
    const manager = new PluginManager(h.workspace);
    await manager.initialize();
    await manager.install(h.archive("watcher", `
export function activate(api) {
  api.onActivity(() => {});
  api.setStatus("已就绪");
}
`, ["agent.activity"]));

    const seen: ActivityEvent[] = [];
    const handlers = handlersOf(manager, "watcher");
    assert.equal(handlers.size, 1);
    handlers.add((event) => { seen.push(event); });

    // 用真实时钟：终态 TTL 按 Date.now() 判定，假的 epoch 会立刻过期
    const now = Date.now();
    manager.emitActivity({ kind: "turn_started", sessionId: "s1", at: now, label: "gpt-x" });
    manager.emitActivity({ kind: "tool_started", sessionId: "s1", at: now + 1, label: "read_file" });
    manager.emitActivity({ kind: "tool_finished", sessionId: "s1", at: now + 2, label: "read_file" });
    assert.deepEqual(seen.map((e) => e.kind), ["turn_started", "tool_started", "tool_finished"]);
    // 派发不消费：每次都能看到完整序列
    assert.equal(manager.getActivity().phase, "thinking");
    assert.equal(manager.getActivity().last?.label, "read_file");

    manager.emitActivity({ kind: "turn_completed", sessionId: "s1", at: now + 3 });
    assert.equal(manager.getActivity().phase, "done");

    await manager.shutdown();
    // shutdown 后插件停用，订阅必须被清空（与 overlay 同一套生命周期）
    assert.equal(handlers.size, 0);
  } finally { h.cleanup(); }
});

test("单个订阅者抛错不影响其他订阅者，也不影响派发本身", async () => {
  const h = harness("activity-throw");
  try {
    const manager = new PluginManager(h.workspace);
    await manager.initialize();
    await manager.install(h.archive("boom", "export function activate(api) { api.onActivity(() => {}); }", ["agent.activity"]));
    const handlers = handlersOf(manager, "boom");
    const seen: ActivityEvent[] = [];
    handlers.add(() => { throw new Error("第一个订阅者炸了"); });
    handlers.add((event) => { seen.push(event); });
    assert.doesNotThrow(() => manager.emitActivity({ kind: "turn_started", sessionId: "s", at: 1 }));
    assert.equal(seen.length, 1);
    await manager.shutdown();
  } finally { h.cleanup(); }
});

test("getActivity 初始为 idle，终态 TTL 后回落 idle 但保留可查事件", async () => {
  const h = harness("activity-snapshot");
  try {
    const manager = new PluginManager(h.workspace);
    await manager.initialize();
    assert.deepEqual(manager.getActivity(), { phase: "idle", last: null });
    manager.emitActivity({ kind: "turn_started", sessionId: "s", at: Date.now() });
    assert.equal(manager.getActivity().phase, "thinking");
    manager.emitActivity({ kind: "turn_completed", sessionId: "s", at: Date.now() });
    assert.equal(manager.getActivity().phase, "done");
    const internals = manager as unknown as { activityTerminalAt: number };
    internals.activityTerminalAt = Date.now() - 60_000;
    const snapshot = manager.getActivity();
    assert.equal(snapshot.phase, "idle");
    assert.equal(snapshot.last?.kind, "turn_completed");
    await manager.shutdown();
  } finally { h.cleanup(); }
});

test("getActivity 供晚订阅的插件补齐状态（浮窗在回合中途才打开的场景）", async () => {
  const h = harness("activity-late");
  try {
    const manager = new PluginManager(h.workspace);
    await manager.initialize();
    manager.emitActivity({ kind: "turn_started", sessionId: "s9", at: Date.now() });
    manager.emitActivity({ kind: "tool_started", sessionId: "s9", at: Date.now(), label: "grep" });
    await manager.install(h.archive("late", `
export function activate(api) {
  const snapshot = api.getActivity();
  api.setStatus(snapshot.phase + "/" + (snapshot.last ? snapshot.last.label : "none"));
}
`, ["agent.activity"]));
    const status = manager.list().find((item) => item.id === "late");
    // 插件在回合进行中才激活，也能立刻知道「现在正在跑 grep」
    assert.equal(status?.message, "running/grep");
    await manager.shutdown();
  } finally { h.cleanup(); }
});