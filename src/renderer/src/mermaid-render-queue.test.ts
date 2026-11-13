import test from "node:test";
import assert from "node:assert/strict";
import { createMermaidRenderQueue } from "./mermaid-render-queue.js";

test("配置与渲染串行执行，不在渲染中覆盖共享主题", async () => {
  const enqueue = createMermaidRenderQueue();
  const events: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const dark = enqueue(async () => { events.push("dark:init"); await pending; events.push("dark:rendered"); });
  const light = enqueue(async () => { events.push("light:init"); events.push("light:rendered"); });
  await Promise.resolve();
  assert.deepEqual(events, ["dark:init"]);
  release(); await Promise.all([dark, light]);
  assert.deepEqual(events, ["dark:init", "dark:rendered", "light:init", "light:rendered"]);
});
test("图表错误不会阻断后续图表，取消任务可跳过渲染", async () => {
  const enqueue = createMermaidRenderQueue();
  await assert.rejects(enqueue(async () => { throw new Error("invalid chart"); }), /invalid chart/);
  let rendered = false, cancelled = true;
  await enqueue(async () => { if (cancelled) return; rendered = true; });
  assert.equal(rendered, false);
  cancelled = false;
  await enqueue(async () => { if (cancelled) return; rendered = true; });
  assert.equal(rendered, true);
});
