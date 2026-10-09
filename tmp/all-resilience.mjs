// src/resilience.test.ts
import assert from "node:assert/strict";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import test from "node:test";

// src/resilience.ts
import fs from "node:fs";
import path from "node:path";
var DEFAULT_RESILIENCE = {
  autoRetry: true,
  fallbackEnabled: true,
  rememberFailures: true,
  cooldownBaseMinutes: 5,
  quotaCooldownMinutes: 60
};
function normalizeResilienceSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const clampNumber = (value, fallback, min, max) => {
    const parsed = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  };
  return {
    autoRetry: input.autoRetry !== false,
    fallbackEnabled: input.fallbackEnabled !== false,
    ...Array.isArray(input.fallbackModelIds) ? { fallbackModelIds: input.fallbackModelIds.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()).slice(0, 20) } : {},
    rememberFailures: input.rememberFailures !== false,
    cooldownBaseMinutes: clampNumber(input.cooldownBaseMinutes, DEFAULT_RESILIENCE.cooldownBaseMinutes, 1, 720),
    quotaCooldownMinutes: clampNumber(input.quotaCooldownMinutes, DEFAULT_RESILIENCE.quotaCooldownMinutes, 1, 10080)
  };
}
var MAX_RECORDED_FAILURES = 5;
function classifyFailure(error) {
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  const text = `${error instanceof Error ? `${error.message} ${error.name}` : String(error)}`.toLowerCase();
  if (/(abort|用户中止|已停止)/.test(text)) return "aborted";
  if (/(quota|billing|arrears|insufficient[_ ]balance|balance.*insufficient|欠费|余额不足|资源包.*用完|免费额度|402)/.test(text)) return "quota";
  if (/(invalid[_ ]api[_ ]key|authentication|unauthorized|api key|401|403|forbidden)/.test(text)) return "auth";
  if (/(rate[_ ]?limit|too many requests|429|throttl|请求过于频繁|频率)/.test(text)) return "rate_limit";
  if (/(timeout|etimedout|econnreset|econnrefused|enotfound|eai_again|fetch failed|network|暂时无法|unreachable|502|503|504)/.test(text)) return "network";
  if (/(internal[_ ]?server|500|bad[_ ]?gateway|server error|服务(器)?(错误|繁忙))/.test(text)) return "server";
  return "unknown";
}
function isFallbackable(kind) {
  return kind !== "aborted";
}
var ModelHealthStore = class _ModelHealthStore {
  constructor(file) {
    this.file = file;
  }
  file;
  state = /* @__PURE__ */ new Map();
  static load(workspace) {
    if (!workspace) return new _ModelHealthStore(void 0);
    const file = path.join(workspace, ".model-health.json");
    const store = new _ModelHealthStore(file);
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        const source = parsed && typeof parsed === "object" && "models" in parsed && parsed.models && typeof parsed.models === "object" ? parsed.models : parsed;
        for (const [id, health] of Object.entries(source || {})) {
          if (health && Array.isArray(health.failures)) store.state.set(id, health);
        }
      }
    } catch {
    }
    return store;
  }
  persist() {
    if (!this.file) return;
    try {
      const entries = [...this.state.entries()].filter(([, health]) => health.failures.length > 0);
      const payload = {};
      for (const [id, health] of entries.slice(-64)) payload[id] = health;
      fs.writeFileSync(this.file, JSON.stringify({ version: 1, models: payload }, null, 2), "utf8");
    } catch {
    }
  }
  entry(id) {
    let health = this.state.get(id);
    if (!health) {
      health = { failures: [], consecutiveFailures: 0, disabledUntil: void 0, lastKind: void 0 };
      this.state.set(id, health);
    }
    return health;
  }
  reportFailure(id, kind, message, settings) {
    const health = this.entry(id);
    health.failures.push({ at: (/* @__PURE__ */ new Date()).toISOString(), kind, message: message.slice(0, 300) });
    if (health.failures.length > MAX_RECORDED_FAILURES) health.failures.shift();
    health.consecutiveFailures += 1;
    health.lastKind = kind;
    let cooldownMinutes;
    if (kind === "quota") {
      cooldownMinutes = settings.quotaCooldownMinutes * Math.min(4, health.consecutiveFailures);
    } else if (kind === "auth") {
      cooldownMinutes = 24 * 60;
    } else if (kind === "rate_limit") {
      cooldownMinutes = Math.min(15, settings.cooldownBaseMinutes * health.consecutiveFailures);
    } else {
      cooldownMinutes = Math.min(60, settings.cooldownBaseMinutes * 2 ** (health.consecutiveFailures - 1));
    }
    health.disabledUntil = new Date(Date.now() + cooldownMinutes * 6e4).toISOString();
    this.persist();
    return { cooldownMinutes };
  }
  reportSuccess(id) {
    const health = this.state.get(id);
    if (!health) return;
    health.failures = [];
    health.consecutiveFailures = 0;
    health.disabledUntil = void 0;
    health.lastKind = void 0;
    this.persist();
  }
  isCoolingDown(id, settings) {
    if (!settings.rememberFailures) return false;
    const health = this.state.get(id);
    if (!health?.disabledUntil) return false;
    return new Date(health.disabledUntil).getTime() > Date.now();
  }
  summary() {
    const result = {};
    for (const [id, health] of this.state) {
      result[id] = {
        coolingDown: Boolean(health.disabledUntil && new Date(health.disabledUntil).getTime() > Date.now()),
        consecutiveFailures: health.consecutiveFailures,
        lastKind: health.lastKind,
        disabledUntil: health.disabledUntil
      };
    }
    return result;
  }
  clear(id) {
    if (id) this.state.delete(id);
    else this.state.clear();
    this.persist();
  }
};
function planModelChain(requested, candidates, idOf, settings, health) {
  const custom = settings.fallbackModelIds?.filter(Boolean) ?? [];
  if (custom.length) {
    const byId = new Map(candidates.map((model) => [idOf(model), model]));
    const ordered = custom.map((id) => byId.get(id)).filter((model) => Boolean(model));
    if (ordered.length) {
      const ready2 = ordered.filter((model) => !health.isCoolingDown(idOf(model), settings));
      const cooling2 = ordered.filter((model) => health.isCoolingDown(idOf(model), settings));
      return [...ready2, ...cooling2];
    }
  }
  const pool = [...candidates];
  if (requested !== void 0) {
    const index = pool.findIndex((model) => idOf(model) === idOf(requested));
    if (index >= 0) pool.splice(index, 1);
    pool.unshift(requested);
  }
  if (!settings.fallbackEnabled) return pool.slice(0, 1);
  const ready = pool.filter((model) => !health.isCoolingDown(idOf(model), settings));
  const cooling = pool.filter((model) => health.isCoolingDown(idOf(model), settings));
  return [...ready, ...cooling];
}

// src/resilience.test.ts
function tempWorkspace() {
  return fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-resilience-"));
}
test("classifyFailure recognises Aliyun Bailian style quota errors", () => {
  assert.equal(classifyFailure(new Error("AllocateQuotaFailed: free quota exhausted, please pay")), "quota");
  assert.equal(classifyFailure(new Error("\u6B20\u8D39\uFF1A\u8D44\u6E90\u5305\u5DF2\u7528\u5B8C")), "quota");
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
  const defaults = normalizeResilienceSettings(void 0);
  assert.equal(defaults.autoRetry, true);
  assert.equal(defaults.quotaCooldownMinutes, 60);
  const clamped = normalizeResilienceSettings({ cooldownBaseMinutes: 9999, autoRetry: false });
  assert.equal(clamped.cooldownBaseMinutes, 720);
  assert.equal(clamped.autoRetry, false);
});
