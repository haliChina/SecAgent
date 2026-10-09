// src/reasoning.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/reasoning.ts
var ALL_RESPONSES_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
var GENERIC_CHAT_EFFORTS = ["none", "low", "medium", "high"];
function normalized(target) {
  return {
    model: (target.model || "").trim().toLowerCase(),
    provider: (target.provider || "").trim().toLowerCase(),
    endpoint: (target.endpoint || "").trim().toLowerCase(),
    baseUrl: (target.baseUrl || "").trim().toLowerCase()
  };
}
function reasoningFamily(target) {
  const { model, provider, endpoint } = normalized(target);
  if (provider === "google") return "google";
  if (provider === "anthropic") return "anthropic";
  if (/^(?:doubao|seed)[-_.]/.test(model)) return "doubao";
  if (/^deepseek(?:[-_.]|$)/.test(model)) return "deepseek";
  if (/^qwen(?:[-_.\d]|$)/.test(model)) return "qwen";
  if (/^glm(?:[-_.]|$)/.test(model)) return "glm";
  if (/^step(?:[-_.]|$)/.test(model)) return "step";
  if (provider === "openai-responses" || endpoint.includes("/responses")) return "openai-responses";
  if (/^(?:gpt[-_.]|o\d)/.test(model)) return "openai-chat";
  return "generic-chat";
}
function isFreeDeepSeekAlias(target) {
  const { model, provider, baseUrl } = normalized(target);
  return /^(?:deepseek-default|deepseek-reasoner|deepseek-v4-pro)$/.test(model) && (provider === "openai-compatible" || /proxy|free-deepseek/.test(baseUrl));
}
function reasoningEffortsForTarget(target) {
  if (!target) return [...GENERIC_CHAT_EFFORTS];
  const family = reasoningFamily(target);
  const model = (target.model || "").toLowerCase();
  if (isFreeDeepSeekAlias(target)) return ["high"];
  if (model === "gpt-5.6-luna") return [...ALL_RESPONSES_EFFORTS.slice(1)];
  if (family === "deepseek") return ["none", "high", "max"];
  if (family === "doubao") return ["none", "low", "medium", "high"];
  if (family === "qwen") return ["none", "low", "medium", "high"];
  if (family === "glm") return /^glm-(?:5|5\.)/.test(model) ? [...ALL_RESPONSES_EFFORTS] : ["high"];
  if (family === "step") return model.includes("3.5") ? ["low", "high"] : ["low", "medium", "high"];
  if (family === "google") {
    if (/gemini-3\.7/.test(model)) return ["low", "medium", "high"];
    if (/gemini-3(?:\.|-|$)/.test(model)) return ["minimal", "low", "medium", "high"];
    if (/gemini-2\.5-(?:pro|thinking)/.test(model)) return ["minimal", "low", "medium", "high"];
    return ["none", "minimal", "low", "medium", "high"];
  }
  if (family === "anthropic") return ["none", "low", "medium", "high", "xhigh", "max"];
  if (family === "openai-responses") return [...ALL_RESPONSES_EFFORTS];
  return [...GENERIC_CHAT_EFFORTS];
}
function normalizeReasoningEffort(target, requested, fallback = "high") {
  const supported = reasoningEffortsForTarget(target);
  if (supported.includes(requested)) return requested;
  if (requested === "none" && supported[0]) return supported[0];
  if (supported.includes(fallback)) return fallback;
  return supported[0] || "high";
}
function deepSeekChatEffort(effort) {
  return effort === "max" || effort === "xhigh" ? "max" : "high";
}
function qwenThinkingBudget(effort) {
  if (effort === "minimal") return 512;
  if (effort === "low") return 1024;
  if (effort === "medium") return 4096;
  if (effort === "high") return 16384;
  return 32768;
}
function reasoningFieldsForChat(target, requested) {
  const effort = normalizeReasoningEffort(target, requested);
  const family = reasoningFamily(target);
  if (family === "deepseek") {
    return effort === "none" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning_effort: deepSeekChatEffort(effort) };
  }
  if (family === "doubao") {
    return { reasoning_effort: effort === "none" ? "minimal" : effort === "xhigh" || effort === "max" ? "high" : effort };
  }
  if (family === "qwen") {
    return effort === "none" ? { enable_thinking: false } : { enable_thinking: true, thinking_budget: qwenThinkingBudget(effort) };
  }
  if (family === "glm") {
    if (/^glm-(?:5|5\.)/.test((target.model || "").toLowerCase())) {
      return { reasoning_effort: effort };
    }
    return { thinking: { type: effort === "none" ? "disabled" : "enabled" } };
  }
  if (family === "step") {
    return { reasoning_effort: effort === "xhigh" || effort === "max" ? "high" : effort };
  }
  if (family === "openai-chat" || family === "generic-chat") {
    return effort === "none" ? {} : { reasoning_effort: effort };
  }
  return {};
}
function reasoningFieldsForResponses(target, requested) {
  const effort = normalizeReasoningEffort(target, requested);
  const family = reasoningFamily(target);
  if (family === "doubao") {
    return effort === "none" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" }, reasoning: { effort, summary: "auto" } };
  }
  const normalizedEffort = family === "deepseek" ? effort === "max" || effort === "xhigh" ? "max" : effort === "none" ? "none" : "high" : effort;
  return { reasoning: { effort: normalizedEffort, summary: "auto" } };
}
function googleThinkingConfig(target, requested) {
  const effort = normalizeReasoningEffort(target, requested);
  const model = (target.model || "").toLowerCase();
  if (/gemini-3\.7/.test(model)) {
    return { thinkingLevel: effort === "high" || effort === "xhigh" || effort === "max" ? "high" : effort === "medium" ? "medium" : "low" };
  }
  if (/gemini-3(?:\.|-|$)/.test(model)) {
    return { thinkingLevel: effort === "max" || effort === "xhigh" ? "high" : effort === "none" ? "minimal" : effort };
  }
  const budget = effort === "none" ? 0 : effort === "minimal" ? 512 : effort === "low" ? 1024 : effort === "medium" ? 4096 : effort === "max" || effort === "xhigh" ? 16384 : 8192;
  return { thinkingBudget: budget, includeThoughts: true };
}
function anthropicThinkingConfig(target, requested) {
  const effort = normalizeReasoningEffort(target, requested);
  if (effort === "none") return { thinking: { type: "disabled" } };
  const model = (target.model || "").toLowerCase();
  const adaptive = /claude-(?:opus|sonnet|haiku)-(?:4(?:[-.]\d+)?|5)/.test(model);
  if (adaptive) {
    return { thinking: { type: "adaptive" }, output_config: { effort: effort === "minimal" ? "low" : effort } };
  }
  const requestedBudget = effort === "minimal" ? 1024 : effort === "low" ? 2048 : effort === "medium" ? 4096 : effort === "max" || effort === "xhigh" ? 16384 : 8192;
  const maxTokens = target.maxTokens || 16384;
  if (maxTokens <= 1024) return { thinking: { type: "disabled" } };
  return { thinking: { type: "enabled", budget_tokens: Math.min(requestedBudget, maxTokens - 1) } };
}

// src/reasoning.test.ts
test("DeepSeek uses official Chat thinking fields", () => {
  const target = { provider: "openai-compatible", model: "deepseek-v4-flash" };
  assert.deepEqual(reasoningEffortsForTarget(target), ["none", "high", "max"]);
  assert.deepEqual(reasoningFieldsForChat(target, "none"), { thinking: { type: "disabled" } });
  assert.deepEqual(reasoningFieldsForChat(target, "high"), { thinking: { type: "enabled" }, reasoning_effort: "high" });
});
test("Doubao maps none to minimal and preserves official levels", () => {
  const target = { provider: "openai-compatible", model: "doubao-seed-2-0-mini-260428" };
  assert.deepEqual(reasoningEffortsForTarget(target), ["none", "low", "medium", "high"]);
  assert.deepEqual(reasoningFieldsForChat(target, "none"), { reasoning_effort: "minimal" });
  assert.deepEqual(reasoningFieldsForChat(target, "medium"), { reasoning_effort: "medium" });
});
test("Qwen uses thinking_budget instead of reasoning_effort", () => {
  const target = { provider: "openai-compatible", model: "qwen3.7-flash" };
  assert.deepEqual(reasoningFieldsForChat(target, "none"), { enable_thinking: false });
  assert.deepEqual(reasoningFieldsForChat(target, "medium"), { enable_thinking: true, thinking_budget: 4096 });
});
test("GLM 4.7 exposes only the protocol it supports", () => {
  const target = { provider: "openai-compatible", model: "glm-4.7-flash" };
  assert.deepEqual(reasoningEffortsForTarget(target), ["high"]);
  assert.deepEqual(reasoningFieldsForChat(target, "high"), { thinking: { type: "enabled" } });
});
test("Step exposes only documented effort levels", () => {
  assert.deepEqual(reasoningEffortsForTarget({ provider: "openai-compatible", model: "step-3.5-flash" }), ["low", "high"]);
  assert.deepEqual(reasoningEffortsForTarget({ provider: "openai-compatible", model: "step-3.7-flash" }), ["low", "medium", "high"]);
});
test("Responses and native providers use their own field shapes", () => {
  assert.deepEqual(reasoningFieldsForResponses({ provider: "openai-responses", model: "gpt-5.2" }, "medium"), { reasoning: { effort: "medium", summary: "auto" } });
  assert.deepEqual(reasoningEffortsForTarget({ provider: "openai-responses", model: "gpt-5.6-luna" }), ["minimal", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(reasoningFieldsForResponses({ provider: "openai-responses", model: "gpt-5.6-luna" }, "none"), { reasoning: { effort: "minimal", summary: "auto" } });
  assert.deepEqual(googleThinkingConfig({ provider: "google", model: "gemini-3.7-flash" }, "none"), { thinkingLevel: "low" });
  assert.deepEqual(anthropicThinkingConfig({ provider: "anthropic", model: "claude-sonnet-4-6", maxTokens: 16384 }, "none"), { thinking: { type: "disabled" } });
});
