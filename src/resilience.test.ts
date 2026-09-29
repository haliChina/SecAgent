import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_RESILIENCE, ModelHealthStore, classifyFailure, isFallbackable, normalizeResilienceSettings, planModelChain } from "./resilience.js";

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "secagent-resilience-"));
}

test("classifyFailure recognises Aliyun Bailian style quota errors", () => {
  assert.equal(classifyFailure(new Error("AllocateQuotaFailed: free quota exhausted, please pay")), "quota");
  assert.equal(classifyFailure(new Error("欠费：资源包已用完")), "quota");
  assert.equal(classifyFailure(new Error("402 Payment Required")), "quota");
});

test("classifyFailure separates auth, rate limit, network and aborts", () => {
  assert.equal(classifyFailure(new Error("Invalid API key provided")), "auth");
  assert.equal(classifyFailure(new Error("429 Too Many Requests")), "rate_limit");
  assert.equal(classifyFailure(new Error("fetch failed: ECONNRESET")), "network");
  const abort = new Error("The operation was aborted");
  abort.name = "AbortError";
  assert.equal(classifyFailure(abort), "aborted");
  assert.equal(isFallbackable("aborted"), false);
  assert.equal(isFallbackable("quota"), true);
});

test("quota failures earn a long cooldown, aborts none", () => {
  const workspace = tempWorkspace();
  const store = ModelHealthStore.load(workspace);
  const quota = store.reportFailure("m1", "quota", "free quota exhausted", DEFAULT_RESILIENCE);
  assert.ok(quota.cooldownMinutes >= DEFAULT_RESILIENCE.quotaCooldownMinutes);
  const network = store.reportFailure("m2", "network", "timeout", DEFAULT_RESILIENCE);
  assert.ok(network.cooldownMinutes < DEFAULT_RESILIENCE.quotaCooldownMinutes);
  assert.equal(store.isCoolingDown("m1", DEFAULT_RESILIENCE), true);
  assert.equal(store.isCoolingDown("m2", DEFAULT_RESILIENCE), true);
  assert.equal(store.isCoolingDown("m3", DEFAULT_RESILIENCE), false);
});

test("health state persists across store instances and success clears it", () => {
  const workspace = tempWorkspace();
  const first = ModelHealthStore.load(workspace);
  first.reportFailure("m1", "quota", "arrears", DEFAULT_RESILIENCE);
  const second = ModelHealthStore.load(workspace);
  assert.equal(second.isCoolingDown("m1", DEFAULT_RESILIENCE), true);
  second.reportSuccess("m1");
  assert.equal(second.isCoolingDown("m1", DEFAULT_RESILIENCE), false);
});

test("rememberFailures=false ignores cooldowns", () => {
  const workspace = tempWorkspace();
  const store = ModelHealthStore.load(workspace);
  store.reportFailure("m1", "quota", "arrears", DEFAULT_RESILIENCE);
  const permissive = { ...DEFAULT_RESILIENCE, rememberFailures: false };
  assert.equal(store.isCoolingDown("m1", permissive), false);
});

test("planModelChain keeps the requested model first and demotes cooling models", () => {
  const workspace = tempWorkspace();
  const store = ModelHealthStore.load(workspace);
  store.reportFailure("b", "quota", "arrears", DEFAULT_RESILIENCE);
  const chain = planModelChain({ id: "a" }, [{ id: "a" }, { id: "b" }, { id: "c" }], (model) => model.id, DEFAULT_RESILIENCE, store);
  assert.deepEqual(chain.map((model) => model.id), ["a", "c", "b"]);

  const noFallback = planModelChain({ id: "a" }, [{ id: "a" }, { id: "b" }], (model) => model.id, { ...DEFAULT_RESILIENCE, fallbackEnabled: false }, store);
  assert.deepEqual(noFallback.map((model) => model.id), ["a"]);
});

test("planModelChain falls back to other models when the requested one is cooling", () => {
  const workspace = tempWorkspace();
  const store = ModelHealthStore.load(workspace);
  store.reportFailure("a", "quota", "arrears", DEFAULT_RESILIENCE);
  const chain = planModelChain({ id: "a" }, [{ id: "a" }, { id: "b" }], (model) => model.id, DEFAULT_RESILIENCE, store);
  assert.deepEqual(chain.map((model) => model.id), ["b", "a"]);
});

test("normalizeResilienceSettings applies defaults and clamps", () => {
  const defaults = normalizeResilienceSettings(undefined);
  assert.equal(defaults.autoRetry, true);
  assert.equal(defaults.quotaCooldownMinutes, 60);
  const clamped = normalizeResilienceSettings({ cooldownBaseMinutes: 9999, autoRetry: false });
  assert.equal(clamped.cooldownBaseMinutes, 720);
  assert.equal(clamped.autoRetry, false);
});
