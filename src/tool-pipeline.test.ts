import assert from "node:assert/strict";
import test from "node:test";
import { resolvePostDecision, resolvePreDecision, type PostToolDecision, type PostToolHook, type PreToolDecision, type PreToolHook, type ToolCallContext } from "./tool-pipeline.js";

const context: ToolCallContext = { tool: "guarded__sh", arguments: { command: "rm -rf /tmp/x" }, request: "清理临时文件", sessionId: "s1" };

test("空钩子默认放行与接受", async () => {
  assert.deepEqual(await resolvePreDecision(context, []), { action: "allow" });
  assert.deepEqual(await resolvePostDecision(context, { ok: true }, []), { action: "accept" });
});

test("后续 allow 不能推翻更早的 deny", async () => {
  const deny: PreToolDecision = { action: "deny", reason: "策略禁止" };
  const hooks: PreToolHook[] = [() => deny, () => ({ action: "allow" })];
  assert.deepEqual(await resolvePreDecision(context, hooks), deny);
});

test("后续 allow 不能覆盖更早的 confirm", async () => {
  const hooks: PreToolHook[] = [() => ({ action: "confirm", reason: "需要确认" }), async () => ({ action: "allow" })];
  assert.deepEqual(await resolvePreDecision(context, hooks), { action: "confirm", reason: "需要确认" });
});

test("post 管道 block 优先于后续 accept，且钩子能看到执行结果", async () => {
  let seen: unknown;
  const block: PostToolDecision = { action: "block", reason: "结果含敏感信息" };
  const hooks: PostToolHook[] = [
    (_context, result) => { seen = result; return { action: "accept" }; },
    () => block,
    () => ({ action: "accept" })
  ];
  assert.deepEqual(await resolvePostDecision(context, { text: "secret" }, hooks), block);
  assert.deepEqual(seen, { text: "secret" });
});
