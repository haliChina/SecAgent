import test from "node:test";
import assert from "node:assert/strict";
import { createPanelStatusReader } from "./plugin-panel-requests.js";

const panel = { id: "service", title: "服务", statusAction: "status" };
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => { resolve = done; });
  return { promise, resolve };
};

test("面板操作刷新后，较早轮询返回不能覆盖新状态", async () => {
  const old = deferred(), fresh = deferred();
  let calls = 0;
  const phases: string[] = [];
  const reader = createPanelStatusReader(() => ++calls === 1 ? old.promise : fresh.promise, (_, status) => phases.push(status.phase || ""));
  const first = reader.read(panel), second = reader.read(panel);
  fresh.resolve({ phase: "running" }); await second;
  old.resolve({ phase: "stopped" }); await first;
  assert.deepEqual(phases, ["running"]);
});

test("面板卸载后丢弃响应且不再发起读取", async () => {
  const pending = deferred(); let calls = 0, published = 0;
  const reader = createPanelStatusReader(() => { calls++; return pending.promise; }, () => { published++; });
  const run = reader.read(panel); reader.dispose(); pending.resolve({ phase: "ready" }); await run;
  await reader.read(panel);
  assert.equal(calls, 1); assert.equal(published, 0);
});

test("多个面板各自跟踪最新请求", async () => {
  const a = deferred(), b = deferred(); const ids: string[] = [];
  const reader = createPanelStatusReader((item) => item.id === "a" ? a.promise : b.promise, (id) => ids.push(id));
  const runs = [reader.read({ ...panel, id: "a" }), reader.read({ ...panel, id: "b" })];
  b.resolve({ phase: "ready" }); a.resolve({ phase: "stopped" }); await Promise.all(runs);
  assert.deepEqual(ids.sort(), ["a", "b"]);
});

test("状态读取异常由调用方处理，不发布失败伪状态", async () => {
  let published = false;
  const reader = createPanelStatusReader(async () => { throw new Error("断开"); }, () => { published = true; });
  await assert.rejects(reader.read(panel), /断开/); assert.equal(published, false);
});
