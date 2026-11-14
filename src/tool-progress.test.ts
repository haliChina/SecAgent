import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolProgressGuard, stallNoticeFor, toolCallSignature, STALL_NOTICE, type ToolProgressVerdict } from "./tool-progress.js";

test("签名：键序不同内容相同视为同一调用", () => {
  assert.equal(toolCallSignature("click", { x: 1, y: 2 }), toolCallSignature("click", { y: 2, x: 1 }));
  assert.notEqual(toolCallSignature("click", { x: 1 }), toolCallSignature("click", { x: 2 }));
  assert.notEqual(toolCallSignature("click", { x: 1 }), toolCallSignature("move", { x: 1 }));
  /* undefined args 与空对象同签名（两者等价）。 */
  assert.equal(toolCallSignature("screenshot", undefined), toolCallSignature("screenshot", {}));
});

test("熔断：连续相同调用第 3 次起拦截，换调用即复位", () => {
  const guard = createToolProgressGuard(3);
  assert.deepEqual(guard.observe("click", { x: 1, y: 1 }), { blocked: false, repeat: 1 });
  assert.deepEqual(guard.observe("click", { x: 1, y: 1 }), { blocked: false, repeat: 2 });
  assert.deepEqual(guard.observe("click", { x: 1, y: 1 }), { blocked: true, repeat: 3 });
  assert.deepEqual(guard.observe("click", { x: 1, y: 1 }), { blocked: true, repeat: 4 });
  /* 换了调用（不同参数）——计数立即复位。 */
  assert.deepEqual(guard.observe("click", { x: 2, y: 2 }), { blocked: false, repeat: 1 });
  assert.deepEqual(guard.observe("click", { x: 2, y: 2 }), { blocked: false, repeat: 2 });
});

test("熔断：交替调用不误伤（A-B-A-B 序列每次 repeat=1）", () => {
  const guard = createToolProgressGuard(3);
  for (const [name, args] of [["a", {}], ["b", {}], ["a", {}], ["b", {}]] as Array<[string, Record<string, unknown>]>) {
    /* ToolProgressVerdict 显式注解：类型被外部真引用（死导出扫描）。 */
    const verdict: ToolProgressVerdict = guard.observe(name, args);
    assert.equal(verdict.repeat, 1, `${name} 不应累计——交替场景不是停滞`);
    assert.equal(verdict.blocked, false);
  }
});

test("提示：截图类附加 wait 引导，其他工具用基础提示", () => {
  assert.match(stallNoticeFor("screenshot"), /wait 条件等待/);
  assert.match(stallNoticeFor("computer-use__screenshot"), /wait 条件等待/);
  assert.equal(stallNoticeFor("click"), STALL_NOTICE);
  /* 带前缀的工具名取后半段匹配（宿主工具带插件前缀）。 */
  assert.match(stallNoticeFor("computer-use__screenshot"), /截图轮询/);
});

test("签名：循环引用等异常输入不抛错", () => {
  const weird: Record<string, unknown> = {};
  weird.self = weird;
  const s = toolCallSignature("act", weird);
  assert.ok(typeof s === "string" && s.startsWith("act:"), "退化签名仍可用");
});
