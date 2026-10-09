// src/model-provider.test.ts
import assert from "node:assert/strict";
import test from "node:test";

// src/tool-content.ts
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function imageFromBlock(value) {
  if (!isRecord(value) || value.type !== "image" || typeof value.data !== "string" || typeof value.mimeType !== "string" || !value.mimeType.startsWith("image/")) return void 0;
  const dataUrl = value.data.match(/^data:[^;,]+;base64,(.*)$/s);
  return { type: "image", data: dataUrl?.[1] || value.data, mimeType: value.mimeType, ...typeof value.name === "string" ? { name: value.name } : {}, ...typeof value.path === "string" ? { path: value.path } : {} };
}
function textFromValue(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function toolResultParts(value) {
  const image = imageFromBlock(value);
  if (image) return { text: "", images: [image] };
  if (Array.isArray(value) && value.every((item) => isRecord(item) && (item.type === "text" || item.type === "image" || item.type === "resource"))) {
    const parts = value.map(toolResultParts);
    return { text: parts.map((item) => item.text).filter(Boolean).join("\n"), images: parts.flatMap((item) => item.images) };
  }
  if (isRecord(value) && Array.isArray(value.content)) {
    const parts = toolResultParts(value.content);
    if (value.structuredContent !== void 0) parts.text = [parts.text, textFromValue(value.structuredContent)].filter(Boolean).join("\n");
    return parts;
  }
  if (isRecord(value) && value.type === "text" && typeof value.text === "string") return { text: value.text, images: [] };
  if (isRecord(value) && value.type === "resource" && isRecord(value.resource)) {
    const resource = value.resource;
    if (typeof resource.blob === "string" && typeof resource.mimeType === "string" && resource.mimeType.startsWith("image/")) return { text: "", images: [{ type: "image", data: resource.blob, mimeType: resource.mimeType }] };
  }
  return { text: textFromValue(value), images: [] };
}
function toolResultText(parts) {
  if (parts.text) return parts.text;
  if (parts.images.length) return `\u5DF2\u8FD4\u56DE ${parts.images.length} \u5F20\u56FE\u7247\u4F9B\u6A21\u578B\u67E5\u770B\u3002`;
  return "\u5DE5\u5177\u672A\u8FD4\u56DE\u5185\u5BB9\u3002";
}

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

// src/model-provider.ts
var WORKSPACE_FILE_OUTPUT_PROMPT = `

## \u5DE5\u4F5C\u533A\u6587\u4EF6\u9884\u89C8\u8F93\u51FA
\u5F53\u672C\u8F6E\u4EFB\u52A1\u751F\u6210\u6216\u4FEE\u6539\u4E86\u53EF\u4F9B\u7528\u6237\u6D4F\u89C8\u7684 HTML\u3001SVG \u6216 Markdown \u6587\u4EF6\uFF08\u4F8B\u5982\u4EA4\u4E92\u6548\u679C\u3001\u9759\u6001\u7F51\u7AD9\u3001\u56FE\u8868\u6216\u6587\u6863\uFF09\u65F6\uFF0C\u8BF7\u5728\u6700\u7EC8\u56DE\u7B54\u7684\u6700\u540E\u8FFD\u52A0\u4E00\u4E2A\u5DE5\u4F5C\u533A\u6587\u4EF6\u6E05\u5355\u3002\u53EA\u5217\u51FA\u786E\u5B9E\u5B58\u5728\u4E8E\u5F53\u524D\u5DE5\u4F5C\u533A\u5185\u7684\u6587\u4EF6\uFF0C\u8DEF\u5F84\u4F7F\u7528\u76F8\u5BF9\u5DE5\u4F5C\u533A\u6839\u76EE\u5F55\u7684\u8DEF\u5F84\uFF0C\u5E76\u4E25\u683C\u4F7F\u7528\u4EE5\u4E0B XML \u683C\u5F0F\uFF1B\u6CA1\u6709\u53EF\u9884\u89C8\u6587\u4EF6\u65F6\u4E0D\u8981\u8F93\u51FA\u8BE5\u6807\u7B7E\uFF1A
<workspace-files>
  <file path="\u76F8\u5BF9\u8DEF\u5F84/index.html" />
</workspace-files>
\u53EF\u4EE5\u5217\u51FA\u4E00\u4E2A\u6216\u591A\u4E2A\u6587\u4EF6\u3002XML \u5FC5\u987B\u653E\u5728\u56DE\u7B54\u672B\u5C3E\uFF0C\u4E0D\u8981\u653E\u8FDB Markdown \u4EE3\u7801\u5757\u3002`;
function dataUrlParts(attachment) {
  const match = attachment.dataUrl.match(/^data:([^;,]+);base64,(.*)$/s);
  return { mediaType: match?.[1] || attachment.mimeType, data: match?.[2] || attachment.dataUrl };
}
function openAIContent(message) {
  if (!message.attachments?.length) return message.content;
  return [
    ...message.content ? [{ type: "text", text: message.content }] : [],
    ...message.attachments.map((attachment) => ({ type: "image_url", image_url: { url: attachment.dataUrl } }))
  ];
}
function responsesContent(message) {
  if (!message.attachments?.length) return message.content;
  return [
    ...message.content ? [{ type: "input_text", text: message.content }] : [],
    ...message.attachments.map((attachment) => ({ type: "input_image", image_url: attachment.dataUrl }))
  ];
}
function toolArgumentsText(args) {
  try {
    return JSON.stringify(args);
  } catch {
    return "{}";
  }
}
function historicalToolResult(call) {
  if (call.result === void 0) return "\u5DE5\u5177\u672A\u8FD4\u56DE\u7ED3\u679C\uFF08\u4E0A\u4E00\u8F6E\u6267\u884C\u88AB\u4E2D\u65AD\uFF09";
  return toolResultText(toolResultParts(call.result));
}
function openAIHistory(message) {
  if (message.role !== "assistant" || !message.toolCalls?.length) {
    return [{ role: message.role, content: openAIContent(message) }];
  }
  const calls = message.toolCalls.map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: toolArgumentsText(call.arguments) }
  }));
  return [
    { role: "assistant", content: null, tool_calls: calls },
    ...message.toolCalls.map((call) => ({ role: "tool", tool_call_id: call.id, content: historicalToolResult(call) })),
    ...message.content ? [{ role: "assistant", content: message.content }] : []
  ];
}
function responsesHistory(message) {
  if (message.role !== "assistant" || !message.toolCalls?.length) {
    return [{ role: message.role, content: responsesContent(message) }];
  }
  return [
    ...message.toolCalls.map((call) => ({ type: "function_call", call_id: call.id, name: call.name, arguments: toolArgumentsText(call.arguments) })),
    ...message.toolCalls.map((call) => ({ type: "function_call_output", call_id: call.id, output: historicalToolResult(call) })),
    ...message.content ? [{ role: "assistant", content: message.content }] : []
  ];
}
function anthropicHistory(message) {
  if (message.role !== "assistant" || !message.toolCalls?.length) {
    return [{ role: message.role, content: message.attachments?.length ? [
      ...message.content ? [{ type: "text", text: message.content }] : [],
      ...(message.attachments || []).map((attachment) => {
        const image = dataUrlParts(attachment);
        return { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } };
      })
    ] : message.content }];
  }
  return [
    { role: "assistant", content: message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments })) },
    { role: "user", content: message.toolCalls.map((call) => ({ type: "tool_result", tool_use_id: call.id, content: historicalToolResult(call) })) },
    ...message.content ? [{ role: "assistant", content: message.content }] : []
  ];
}
function googleHistory(message) {
  if (message.role !== "assistant" || !message.toolCalls?.length) {
    return [{
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        ...message.content ? [{ text: message.content }] : [],
        ...(message.attachments || []).map((attachment) => {
          const image = dataUrlParts(attachment);
          return { inlineData: { mimeType: image.mediaType, data: image.data } };
        })
      ]
    }];
  }
  return [
    { role: "model", parts: message.toolCalls.map((call) => ({ functionCall: { name: call.name, args: call.arguments, id: call.id } })) },
    { role: "user", parts: message.toolCalls.map((call) => ({ functionResponse: { name: call.name, id: call.id, response: { result: historicalToolResult(call) } } })) },
    ...message.content ? [{ role: "model", parts: [{ text: message.content }] }] : []
  ];
}
function toGoogleSchema(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rawType = source.type;
  const typeValue = Array.isArray(rawType) ? rawType.find((item) => item !== "null") : rawType;
  const schema = {};
  if (typeof typeValue === "string") schema.type = typeValue.toUpperCase();
  else if (source.properties && typeof source.properties === "object") schema.type = "OBJECT";
  else if (source.items) schema.type = "ARRAY";
  if (Array.isArray(rawType) && rawType.includes("null")) schema.nullable = true;
  if (typeof source.description === "string") schema.description = source.description;
  if (Array.isArray(source.enum)) schema.enum = source.enum;
  if (source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)) {
    schema.properties = Object.fromEntries(Object.entries(source.properties).map(([key, value]) => [key, toGoogleSchema(value)]));
  }
  if (Array.isArray(source.required)) schema.required = source.required.filter((item) => typeof item === "string");
  if (source.items) schema.items = toGoogleSchema(source.items);
  return schema;
}
var ModelToolAgent = class {
  constructor(config2, _skills, trace, getExtraPrompts, includeRuntimePrompts = true, allowEmptyTools = false) {
    this.trace = trace;
    this.getExtraPrompts = getExtraPrompts;
    this.allowEmptyTools = allowEmptyTools;
    const skillCatalog = includeRuntimePrompts && _skills.length ? `

## \u53EF\u7528 Skills
${_skills.map((skill) => `- ${skill.name}: ${skill.description}\uFF08\u5165\u53E3\u6587\u4EF6\uFF1A${skill.relativePath || skill.path}\uFF09`).join("\n")}` : "";
    this.agent = { ...config2.agent, systemPrompt: includeRuntimePrompts ? `${config2.agent.systemPrompt}${skillCatalog}${WORKSPACE_FILE_OUTPUT_PROMPT}` : config2.agent.systemPrompt };
  }
  trace;
  getExtraPrompts;
  allowEmptyTools;
  agent;
  async run(instruction, tools, execute, reasoningEffort = "high", conversation, signal) {
    if (!tools.length && !this.allowEmptyTools) throw new Error("\u6CA1\u6709\u5DF2\u542F\u7528\u4E14\u53EF\u53D1\u73B0\u7684 MCP \u5DE5\u5177");
    const key = process.env[this.agent.apiKeyEnv];
    if (!key) throw new Error(`\u672A\u914D\u7F6E\u6A21\u578B\u5BC6\u94A5\u73AF\u5883\u53D8\u91CF ${this.agent.apiKeyEnv}\u3002\u8BF7\u8BBE\u7F6E\u540E\u91CD\u8BD5\uFF1B\u5BC6\u94A5\u4E0D\u8981\u5199\u5165 secagent.yaml\u3002`);
    const systemPrompt = await this.resolveSystemPrompt();
    if (this.agent.provider === "anthropic") return this.runAnthropic(instruction, tools, key, execute, reasoningEffort, systemPrompt, conversation, signal);
    if (this.agent.provider === "google") return this.runGoogle(instruction, tools, key, execute, reasoningEffort, systemPrompt, conversation, signal);
    if (this.agent.provider === "openai-responses") return this.runOpenAIResponses(instruction, tools, key, execute, reasoningEffort, systemPrompt, conversation, signal);
    return this.runOpenAICompatible(instruction, tools, key, execute, reasoningEffort, systemPrompt, conversation, signal);
  }
  /** 每次请求前从插件收集提示词并拼接到系统提示词最后；无插件提示词时原样返回。 */
  async resolveSystemPrompt() {
    const contributions = await this.getExtraPrompts?.() || [];
    if (!contributions.length) return this.agent.systemPrompt;
    const catalog = contributions.map(({ pluginId, name, text }) => `[${pluginId}/${name}]
${text}`).join("\n\n");
    return `${this.agent.systemPrompt}

## \u63D2\u4EF6\u6CE8\u5165\u7684\u63D0\u793A\u8BCD
${catalog}`;
  }
  async request(url, headers, body, signal) {
    this.trace?.("model.request", { url, body });
    let response2;
    try {
      response2 = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3e4)]) : AbortSignal.timeout(3e4) });
    } catch (error) {
      throw new Error(`\u65E0\u6CD5\u8FDE\u63A5\u6A21\u578B\u7AEF\u70B9 ${url}\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    const payload = await response2.json();
    this.trace?.("model.response", { url, status: response2.status, body: payload });
    if (!response2.ok) {
      if (response2.status === 401 || response2.status === 403) throw new Error(`\u6A21\u578B\u9274\u6743\u5931\u8D25\uFF08${response2.status}\uFF09\u3002\u8BF7\u68C0\u67E5 ${this.agent.apiKeyEnv}\u3001provider \u548C baseUrl\uFF1B\u5BC6\u94A5\u4E0D\u8981\u5199\u5165 YAML\u3002`);
      if (payload.error?.type === "expired_key" || /expired\s+key/i.test(payload.error?.message ?? "")) throw new Error(`\u6A21\u578B\u5BC6\u94A5\u5DF2\u8FC7\u671F\u3002\u8BF7\u5728\u5DE5\u4F5C\u533A .env \u4E2D\u66F4\u65B0 ${this.agent.apiKeyEnv}\uFF0C\u7136\u540E\u91CD\u8BD5\u3002`);
      throw new Error(`\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\uFF08${response2.status}\uFF09\u3002\u8BF7\u68C0\u67E5\u6A21\u578B\u540D\u3001\u7AEF\u70B9\u548C\u670D\u52A1\u7AEF\u65E5\u5FD7\u3002`);
    }
    return payload;
  }
  /**
   * Keeps the same complete request/response audit trail as JSON responses, while passing each
   * parsed server-sent event to the caller immediately for renderer streaming.
   */
  async streamRequest(url, headers, body, onEvent, completeBody, signal) {
    const maxRetries = 5;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.streamRequestOnce(url, headers, body, onEvent, completeBody, signal);
        return;
      } catch (error) {
        if (signal?.aborted) throw error;
        const retryable = error;
        const message = error instanceof Error ? error.message : String(error);
        const transientConnectionError = /terminated|network|socket|closed|reset|timeout|fetch failed/i.test(message);
        if (!retryable.retryable && !transientConnectionError || attempt >= maxRetries) throw error;
        const waitMs = Math.min(5e3, 350 * 2 ** attempt);
        this.trace?.("model.retry", { url, attempt: attempt + 1, maxRetries, waitMs, error: message });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, waitMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
          }, { once: true });
        });
      }
    }
  }
  async streamRequestOnce(url, headers, body, onEvent, completeBody, signal) {
    this.trace?.("model.request", { url, body });
    let response2;
    try {
      response2 = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...body, stream: true }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(9e4)]) : AbortSignal.timeout(9e4) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`\u65E0\u6CD5\u8FDE\u63A5\u6A21\u578B\u7AEF\u70B9 ${url}\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response2.ok) {
      const payload = await response2.json().catch(() => ({}));
      this.trace?.("model.response", { url, status: response2.status, body: payload });
      const retryableStatus = response2.status === 408 || response2.status === 425 || response2.status === 429 || response2.status >= 500;
      if (retryableStatus) {
        const requestError = new Error(`model API request failed (${response2.status})`);
        requestError.retryable = true;
        throw requestError;
      }
      if (response2.status === 401 || response2.status === 403) throw new Error(`\u6A21\u578B\u9274\u6743\u5931\u8D25\uFF08${response2.status}\uFF09\u3002\u8BF7\u68C0\u67E5 ${this.agent.apiKeyEnv}\u3001provider \u548C baseUrl\uFF1B\u5BC6\u94A5\u4E0D\u8981\u5199\u5165 YAML\u3002`);
      if (payload.error?.type === "expired_key" || /expired\s+key/i.test(payload.error?.message ?? "")) throw new Error(`\u6A21\u578B\u5BC6\u94A5\u5DF2\u8FC7\u671F\u3002\u8BF7\u5728\u5DE5\u4F5C\u533A .env \u4E2D\u66F4\u65B0 ${this.agent.apiKeyEnv}\uFF0C\u7136\u540E\u91CD\u8BD5\u3002`);
      throw new Error(`\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\uFF08${response2.status}\uFF09\u3002\u8BF7\u68C0\u67E5\u6A21\u578B\u540D\u3001\u7AEF\u70B9\u548C\u670D\u52A1\u7AEF\u65E5\u5FD7\u3002`);
    }
    if (!response2.body) throw new Error("\u6A21\u578B\u6D41\u5F0F\u54CD\u5E94\u4E3A\u7A7A");
    const reader = response2.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (packet) => {
      const data = packet.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") return;
      try {
        onEvent(JSON.parse(data));
      } catch {
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const packets = buffer.split(/\r?\n\r?\n/);
      buffer = packets.pop() || "";
      for (const packet of packets) consume(packet);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    this.trace?.("model.response", { url, status: response2.status, body: completeBody() });
  }
  async runOpenAICompatible(instruction, tools, key, execute, reasoningEffort, systemPrompt, conversation, signal) {
    const history = conversation?.length ? conversation : [{ role: "user", content: instruction }];
    const messages = [{ role: "system", content: systemPrompt }, ...history.flatMap(openAIHistory)];
    const definitions = tools.map((tool) => ({ type: "function", function: { name: tool.key, description: tool.description || tool.key, parameters: tool.inputSchema || { type: "object", properties: {} } } }));
    let pendingToolError;
    let emptyResponseRetries = 0;
    for (let turn = 0; ; turn++) {
      let content = "";
      const toolCalls = /* @__PURE__ */ new Map();
      signal?.throwIfAborted();
      await this.streamRequest(`${this.agent.baseUrl}${this.agent.endpoint || "/chat/completions"}`, { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, {
        model: this.agent.model,
        messages,
        tools: definitions,
        max_tokens: this.agent.maxTokens,
        ...reasoningFieldsForChat(this.agent, reasoningEffort)
      }, (chunk) => {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;
        const reasoning = delta.reasoning_content;
        if (typeof reasoning === "string") {
          this.trace?.("model.output.delta", { text: reasoning, kind: "thinking", turn: turn + 1 });
        }
        if (typeof delta.content === "string") {
          content += delta.content;
          this.trace?.("model.output.delta", { text: delta.content, kind: "answer", turn: turn + 1 });
        }
        for (const partial of delta.tool_calls || []) {
          const index = partial.index ?? 0;
          const current = toolCalls.get(index) || { function: { arguments: "" } };
          if (partial.id) current.id = partial.id;
          if (partial.function?.name) current.function.name = partial.function.name;
          if (partial.function?.arguments) current.function.arguments += partial.function.arguments;
          toolCalls.set(index, current);
        }
      }, () => ({ choices: [{ message: { content: content || null, tool_calls: [...toolCalls.values()] } }] }), signal);
      const message = { content, tool_calls: [...toolCalls.values()] };
      const calls = message.tool_calls || [];
      if (!calls.length) {
        if (!message.content.trim() && !pendingToolError && emptyResponseRetries < 1) {
          emptyResponseRetries += 1;
          messages.push({ role: "user", content: "\u8BF7\u76F4\u63A5\u7ED9\u51FA\u6700\u7EC8\u7B54\u590D\uFF0C\u4E0D\u8981\u53EA\u8F93\u51FA\u601D\u8003\u8FC7\u7A0B\uFF1B\u5982\u679C\u9700\u8981\u8C03\u7528\u5DE5\u5177\uFF0C\u8BF7\u8C03\u7528\u5DE5\u5177\u540E\u7EE7\u7EED\u5B8C\u6210\u4EFB\u52A1\u3002" });
          continue;
        }
        return message.content.trim() || (pendingToolError ? `\u5DE5\u5177\u6267\u884C\u5931\u8D25\uFF1A${pendingToolError}` : "\u6A21\u578B\u54CD\u5E94\u4E3A\u7A7A\u3002");
      }
      if (content) this.trace?.("model.output.reset", { turn: turn + 1, reason: "tool_call" });
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls.map((call) => ({ ...call, type: "function" })) });
      let turnToolError;
      const imageFollowups = [];
      for (const call of calls) {
        const name = call.function?.name;
        if (!name || !call.id) continue;
        let args;
        let result;
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          result = { error: "\u5DE5\u5177\u53C2\u6570\u4E0D\u662F\u6709\u6548\u7684 JSON\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u5B8C\u6574\u4E14\u5408\u6CD5\u7684\u5DE5\u5177\u53C2\u6570\u3002" };
        }
        if (!result) {
          signal?.throwIfAborted();
          try {
            result = await execute(name, args);
          } catch (error) {
            const message2 = error instanceof Error ? error.message : String(error);
            turnToolError ??= message2;
            result = { error: message2 };
          }
        }
        const parts = toolResultParts(result);
        messages.push({ role: "tool", tool_call_id: call.id, content: toolResultText(parts) });
        imageFollowups.push(...parts.images);
      }
      if (imageFollowups.length) messages.push({ role: "user", content: [{ type: "text", text: "\u5DE5\u5177\u8FD4\u56DE\u4E86\u56FE\u7247\uFF0C\u8BF7\u76F4\u63A5\u67E5\u770B\u8FD9\u4E9B\u56FE\u7247\u5E76\u7EE7\u7EED\u5B8C\u6210\u4EFB\u52A1\u3002" }, ...imageFollowups.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }))] });
      pendingToolError = turnToolError;
    }
    throw new Error("\u5DE5\u5177\u8C03\u7528\u5FAA\u73AF\u610F\u5916\u7ED3\u675F");
  }
  async runOpenAIResponses(instruction, tools, key, execute, reasoningEffort, systemPrompt, conversation, signal) {
    const history = conversation?.length ? conversation : [{ role: "user", content: instruction }];
    const input = history.flatMap(responsesHistory);
    const definitions = tools.map((tool) => ({ type: "function", name: tool.key, description: tool.description || tool.key, parameters: tool.inputSchema || { type: "object", properties: {} }, strict: false }));
    let pendingToolError;
    let emptyResponseRetries = 0;
    for (let turn = 0; ; turn++) {
      let answer = "";
      let summaryDeltaSeen = false;
      let thinkingDeltaSeen = false;
      let responseOutput = [];
      const calls = /* @__PURE__ */ new Map();
      signal?.throwIfAborted();
      await this.streamRequest(`${this.agent.baseUrl}${this.agent.endpoint || "/responses"}`, { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, {
        model: this.agent.model,
        instructions: systemPrompt,
        input,
        tools: definitions,
        max_output_tokens: this.agent.maxTokens,
        ...reasoningFieldsForResponses(this.agent, reasoningEffort)
      }, (event) => {
        const type = typeof event.type === "string" ? event.type : "";
        if (type === "response.output_text.delta" && typeof event.delta === "string") {
          answer += event.delta;
          this.trace?.("model.output.delta", { text: event.delta, kind: "answer", turn: turn + 1 });
        }
        if (type === "response.output_text.done" && !answer && typeof event.text === "string") {
          answer = event.text;
          this.trace?.("model.output.delta", { text: event.text, kind: "answer", turn: turn + 1 });
        }
        if (type === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
          summaryDeltaSeen = true;
          this.trace?.("model.output.delta", { text: event.delta, kind: "summary", turn: turn + 1 });
        }
        if (type === "response.reasoning_summary_text.done" && !summaryDeltaSeen && typeof event.text === "string") {
          this.trace?.("model.output.delta", { text: event.text, kind: "summary", turn: turn + 1 });
        }
        if (type === "response.reasoning_text.delta" && typeof event.delta === "string") {
          thinkingDeltaSeen = true;
          this.trace?.("model.output.delta", { text: event.delta, kind: "thinking", turn: turn + 1 });
        }
        if (type === "response.reasoning_text.done" && !thinkingDeltaSeen && typeof event.text === "string") {
          this.trace?.("model.output.delta", { text: event.text, kind: "thinking", turn: turn + 1 });
        }
        if (type === "response.output_item.added" || type === "response.output_item.done") {
          const item = event.item;
          if (item?.type === "function_call" && item.call_id) {
            const previous = calls.get(item.call_id);
            calls.set(item.call_id, { callId: item.call_id, itemId: typeof item.id === "string" ? item.id : previous?.itemId, name: item.name || previous?.name || "", arguments: item.arguments || previous?.arguments || "" });
          }
        }
        if (type === "response.function_call_arguments.delta" && typeof event.delta === "string") {
          const call = [...calls.values()].find((candidate) => candidate.itemId === event.item_id) || (typeof event.call_id === "string" ? calls.get(event.call_id) : void 0);
          if (call) {
            call.arguments += event.delta;
            calls.set(call.callId, call);
          }
        }
        if (type === "response.completed") {
          const response2 = event.response;
          responseOutput = response2?.output || [];
          if (!answer) {
            const completedText = response2?.output_text;
            if (typeof completedText === "string") {
              answer = completedText;
            } else {
              const textParts = (response2?.output || []).filter((item) => item.type === "message").flatMap((item) => {
                const content = item.content;
                if (typeof content === "string") return [content];
                if (!Array.isArray(content)) return [];
                return content.flatMap((part) => typeof part === "object" && part !== null && typeof part.text === "string" ? [part.text] : []);
              });
              answer = textParts.join("");
            }
            if (answer) this.trace?.("model.output.delta", { text: answer, kind: "answer", turn: turn + 1 });
          }
          for (const item of response2?.output || []) {
            if (item.type === "function_call" && item.call_id && item.name) calls.set(item.call_id, { callId: item.call_id, name: item.name, arguments: item.arguments || "" });
          }
        }
        if (type === "response.failed") {
          const failed = event.response;
          throw new Error(failed?.error?.message || "\u6A21\u578B\u8BF7\u6C42\u5931\u8D25");
        }
      }, () => ({ output: [{ type: "message", content: answer || void 0 }, ...[...calls.values()].map((call) => ({ type: "function_call", call_id: call.callId, name: call.name, arguments: call.arguments }))] }), signal);
      const functionCalls = [...calls.values()].filter((call) => call.name && call.callId);
      if (!functionCalls.length) {
        if (!answer.trim() && !pendingToolError && emptyResponseRetries < 1) {
          emptyResponseRetries += 1;
          input.push({ role: "user", content: "\u8BF7\u76F4\u63A5\u7ED9\u51FA\u6700\u7EC8\u7B54\u590D\uFF0C\u4E0D\u8981\u53EA\u8F93\u51FA\u601D\u8003\u8FC7\u7A0B\uFF1B\u5982\u679C\u9700\u8981\u8C03\u7528\u5DE5\u5177\uFF0C\u8BF7\u8C03\u7528\u5DE5\u5177\u540E\u7EE7\u7EED\u5B8C\u6210\u4EFB\u52A1\u3002" });
          continue;
        }
        return answer.trim() || (pendingToolError ? `\u5DE5\u5177\u6267\u884C\u5931\u8D25\uFF1A${pendingToolError}` : "\u6A21\u578B\u54CD\u5E94\u4E3A\u7A7A\u3002");
      }
      if (answer) this.trace?.("model.output.reset", { turn: turn + 1, reason: "tool_call" });
      if (responseOutput.length) input.push(...responseOutput);
      let turnToolError;
      for (const call of functionCalls) {
        let args;
        let result;
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          result = { error: "\u5DE5\u5177\u53C2\u6570\u4E0D\u662F\u6709\u6548\u7684 JSON\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u5B8C\u6574\u4E14\u5408\u6CD5\u7684\u5DE5\u5177\u53C2\u6570\u3002" };
        }
        if (!responseOutput.length) input.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: call.arguments });
        if (!result) {
          signal?.throwIfAborted();
          try {
            result = await execute(call.name, args);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            turnToolError ??= message;
            result = { error: message };
          }
        }
        const parts = toolResultParts(result);
        input.push({ type: "function_call_output", call_id: call.callId, output: parts.images.length ? [{ type: "input_text", text: toolResultText(parts) }, ...parts.images.map((image) => ({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}` }))] : toolResultText(parts) });
      }
      pendingToolError = turnToolError;
    }
    throw new Error("\u5DE5\u5177\u8C03\u7528\u5FAA\u73AF\u610F\u5916\u7ED3\u675F");
  }
  async runGoogle(instruction, tools, key, execute, reasoningEffort = "high", systemPrompt, conversation, signal) {
    const history = conversation?.length ? conversation : [{ role: "user", content: instruction }];
    const dynamicSystem = history.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const contents = history.filter((message) => message.role !== "system").flatMap(googleHistory);
    const definitions = tools.map((tool) => ({ name: tool.key, description: tool.description || tool.key, parameters: toGoogleSchema(tool.inputSchema || { type: "object", properties: {} }) }));
    let pendingToolError;
    for (let turn = 0; ; turn++) {
      let text = "";
      const calls = /* @__PURE__ */ new Map();
      const body = {
        systemInstruction: { parts: [{ text: dynamicSystem ? `${systemPrompt}

${dynamicSystem}` : systemPrompt }] },
        contents,
        tools: [{ functionDeclarations: definitions }],
        generationConfig: { maxOutputTokens: this.agent.maxTokens, thinkingConfig: googleThinkingConfig(this.agent, reasoningEffort) }
      };
      signal?.throwIfAborted();
      await this.streamGoogleRequest(`${this.agent.baseUrl}${this.agent.endpoint || `/models/${encodeURIComponent(this.agent.model || "gemini-2.5-flash")}:streamGenerateContent`}`, key, body, (chunk) => {
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (typeof part.text === "string") {
            text += part.text;
            this.trace?.("model.output.delta", { text: part.text, kind: part.thought ? "thinking" : "answer", turn: turn + 1 });
          }
          if (part.functionCall?.name) {
            const name = part.functionCall.name;
            const current = calls.get(name) || { name, args: {} };
            current.args = { ...current.args, ...part.functionCall.args || {} };
            if (part.functionCall.id) current.id = part.functionCall.id;
            const signature = part.thoughtSignature || part.thought_signature;
            if (signature) current.thoughtSignature = signature;
            calls.set(name, current);
          }
        }
      }, () => ({ candidates: [{ content: { parts: [{ text: text || void 0 }, ...[...calls.values()].map((call) => ({ functionCall: call }))] } }] }), signal);
      const functionCalls = [...calls.values()];
      if (!functionCalls.length) return text.trim() || (pendingToolError ? `\u5DE5\u5177\u6267\u884C\u5931\u8D25\uFF1A${pendingToolError}` : "\u6A21\u578B\u54CD\u5E94\u4E3A\u7A7A\u3002");
      if (text) this.trace?.("model.output.reset", { turn: turn + 1, reason: "tool_call" });
      const modelParts = [];
      if (text) modelParts.push({ text });
      modelParts.push(...functionCalls.map((call) => ({
        functionCall: { name: call.name, args: call.args },
        ...call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}
      })));
      contents.push({ role: "model", parts: modelParts });
      let turnToolError;
      const imageFallback = [];
      for (const call of functionCalls) {
        let result;
        signal?.throwIfAborted();
        try {
          result = await execute(call.name, call.args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          turnToolError ??= message;
          result = { error: message };
        }
        const parts = toolResultParts(result);
        if (parts.images.length && this.agent.model.toLowerCase().includes("gemini-3")) {
          const refs = parts.images.map((image, index) => ({ $ref: `${call.name}-${turn}-${index}` }));
          contents.push({ role: "user", parts: [{ functionResponse: { name: call.name, ...call.id ? { id: call.id } : {}, response: { result: parts.text || "\u5DF2\u8FD4\u56DE\u56FE\u7247\u3002", images: refs }, parts: parts.images.map((image, index) => ({ inlineData: { mimeType: image.mimeType, data: image.data, displayName: `${call.name}-${turn}-${index}` } })) } }] });
        } else {
          contents.push({ role: "user", parts: [{ functionResponse: { name: call.name, ...call.id ? { id: call.id } : {}, response: parts.images.length ? { result: toolResultText(parts) } : result } }] });
          imageFallback.push(...parts.images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })));
        }
      }
      if (imageFallback.length) contents.push({ role: "user", parts: [{ text: "\u5DE5\u5177\u8FD4\u56DE\u4E86\u56FE\u7247\uFF0C\u8BF7\u76F4\u63A5\u67E5\u770B\u8FD9\u4E9B\u56FE\u7247\u5E76\u7EE7\u7EED\u5B8C\u6210\u4EFB\u52A1\u3002" }, ...imageFallback] });
      pendingToolError = turnToolError;
    }
    throw new Error("\u5DE5\u5177\u8C03\u7528\u5FAA\u73AF\u610F\u5916\u7ED3\u675F");
  }
  async streamGoogleRequest(url, key, body, onChunk, completeBody, signal) {
    const requestUrl = `${url}${url.includes("?") ? "&" : "?"}alt=sse`;
    this.trace?.("model.request", { url, body });
    let response2;
    try {
      response2 = await fetch(requestUrl, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(9e4)]) : AbortSignal.timeout(9e4) });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`\u65E0\u6CD5\u8FDE\u63A5 Google Gemini \u7AEF\u70B9 ${url}\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response2.ok) {
      const payload = await response2.json().catch(() => ({}));
      this.trace?.("model.response", { url, status: response2.status, body: payload });
      if (response2.status === 401 || response2.status === 403) throw new Error("Google Gemini \u9274\u6743\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 Google AI Studio API Key\u3002");
      throw new Error(`Google Gemini \u8BF7\u6C42\u5931\u8D25\uFF08${response2.status}\uFF09\uFF1A${payload.error?.message || "\u8BF7\u68C0\u67E5\u6A21\u578B\u540D\u79F0\u548C API Key"}`);
    }
    if (!response2.body) throw new Error("Google Gemini \u6D41\u5F0F\u54CD\u5E94\u4E3A\u7A7A");
    const reader = response2.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const consume = (packet) => {
      const data = packet.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (!data) return;
      try {
        onChunk(JSON.parse(data));
      } catch {
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const packets = buffer.split(/\r?\n\r?\n/);
      buffer = packets.pop() || "";
      for (const packet of packets) consume(packet);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    this.trace?.("model.response", { url, status: response2.status, body: completeBody() });
  }
  async runAnthropic(instruction, tools, key, execute, reasoningEffort = "high", systemPrompt, conversation, signal) {
    const dynamicSystem = (conversation || []).filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const messages = conversation?.length ? conversation.filter((message) => message.role !== "system").flatMap(anthropicHistory) : [{ role: "user", content: instruction }];
    const definitions = tools.map((tool) => ({ name: tool.key, description: tool.description || tool.key, input_schema: tool.inputSchema || { type: "object", properties: {} } }));
    let pendingToolError;
    for (let turn = 0; ; turn++) {
      const blocks = /* @__PURE__ */ new Map();
      signal?.throwIfAborted();
      await this.streamRequest(`${this.agent.baseUrl}${this.agent.endpoint || "/v1/messages"}`, {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": this.agent.anthropicVersion || "2023-06-01"
      }, {
        model: this.agent.model,
        max_tokens: this.agent.maxTokens,
        system: dynamicSystem ? `${systemPrompt}

${dynamicSystem}` : systemPrompt,
        messages,
        tools: definitions,
        ...anthropicThinkingConfig(this.agent, reasoningEffort)
      }, (event) => {
        const type = event.type;
        const index = typeof event.index === "number" ? event.index : 0;
        if (type === "content_block_start") {
          const block = event.content_block;
          blocks.set(index, { ...block, inputJson: Object.keys(block?.input || {}).length ? JSON.stringify(block?.input) : "" });
        }
        if (type === "content_block_delta") {
          const current = blocks.get(index) || {};
          const delta = event.delta;
          if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
            this.trace?.("model.output.delta", { text: delta.thinking, kind: "thinking", turn: turn + 1 });
          }
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            current.text = (current.text || "") + delta.text;
            this.trace?.("model.output.delta", { text: delta.text, kind: "answer", turn: turn + 1 });
          }
          if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") current.inputJson = (current.inputJson || "") + delta.partial_json;
          blocks.set(index, current);
        }
      }, () => ({ content: [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => ({
        type: block.type,
        id: block.id,
        name: block.name,
        text: block.text,
        input: block.type === "tool_use" ? this.parseToolInput(block.inputJson) : void 0
      })) }), signal);
      const content = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => ({
        type: block.type,
        id: block.id,
        name: block.name,
        text: block.text,
        input: block.type === "tool_use" ? this.parseToolInput(block.inputJson) : void 0
      }));
      const calls = content.filter((item) => item.type === "tool_use" && item.id && item.name);
      if (!calls.length) {
        const answer = content.filter((item) => item.type === "text").map((item) => item.text).filter(Boolean).join("\n");
        return answer || (pendingToolError ? `\u5DE5\u5177\u6267\u884C\u5931\u8D25\uFF1A${pendingToolError}` : "\u6A21\u578B\u54CD\u5E94\u4E3A\u7A7A\u3002");
      }
      if (content.some((item) => item.type === "text" && item.text)) this.trace?.("model.output.reset", { turn: turn + 1, reason: "tool_call" });
      messages.push({ role: "assistant", content });
      const results = [];
      let turnToolError;
      for (const call of calls) {
        if (call.input && "_error" in call.input) {
          results.push({ type: "tool_result", tool_use_id: call.id, content: String(call.input._error) });
          continue;
        }
        if (call.input && "_error" in call.input) throw new Error("\u6A21\u578B\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684\u5DE5\u5177\u53C2\u6570\uFF0C\u8BF7\u63D0\u9AD8 maxTokens \u6216\u91CD\u8BD5");
        let result;
        signal?.throwIfAborted();
        try {
          result = await execute(call.name, call.input || {});
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          turnToolError ??= message;
          result = { error: message };
        }
        const parts = toolResultParts(result);
        results.push({ type: "tool_result", tool_use_id: call.id, content: parts.images.length ? [{ type: "text", text: toolResultText(parts) }, ...parts.images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } }))] : toolResultText(parts) });
      }
      messages.push({ role: "user", content: results });
      pendingToolError = turnToolError;
    }
    throw new Error("\u5DE5\u5177\u8C03\u7528\u5FAA\u73AF\u610F\u5916\u7ED3\u675F");
  }
  parseToolInput(input) {
    try {
      return JSON.parse(input || "{}");
    } catch {
      return { _error: "\u6A21\u578B\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684\u5DE5\u5177\u53C2\u6570" };
    }
  }
};

// src/model-provider.test.ts
function config() {
  return {
    agent: {
      provider: "openai-compatible",
      model: "test-model",
      apiKeyEnv: "TEST_MODEL_KEY",
      baseUrl: "https://model.test",
      endpoint: "/chat/completions",
      maxTokens: 256,
      systemPrompt: "test"
    }
  };
}
function responsesConfig() {
  return {
    agent: {
      provider: "openai-responses",
      model: "test-model",
      apiKeyEnv: "TEST_MODEL_KEY",
      baseUrl: "https://model.test",
      endpoint: "/responses",
      maxTokens: 256,
      systemPrompt: "test"
    }
  };
}
function anthropicConfig() {
  return {
    agent: {
      provider: "anthropic",
      model: "claude-test",
      apiKeyEnv: "TEST_MODEL_KEY",
      baseUrl: "https://model.test",
      endpoint: "/v1/messages",
      maxTokens: 256,
      systemPrompt: "test"
    }
  };
}
function response(body) {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
test("tool failure is not reported as completed", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) return response('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"bad_tool","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n');
    return response('data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n');
  };
  try {
    const agent = new ModelToolAgent(config(), [], void 0);
    const result = await agent.run("do it", [{ key: "bad_tool", description: "bad", inputSchema: { type: "object" } }], async () => {
      throw new Error("\u5DE5\u5177\u4E0D\u5B58\u5728");
    });
    assert.equal(result, "\u5DE5\u5177\u6267\u884C\u5931\u8D25\uFF1A\u5DE5\u5177\u4E0D\u5B58\u5728");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
test("an empty model response is reported explicitly", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  globalThis.fetch = async () => response('data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n');
  try {
    const agent = new ModelToolAgent(config(), [], void 0);
    const result = await agent.run("say something", [{ key: "unused_tool", description: "unused", inputSchema: { type: "object" } }], async () => ({}));
    assert.equal(result, "\u6A21\u578B\u54CD\u5E94\u4E3A\u7A7A\u3002");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
test("malformed tool arguments are returned to the model for correction", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  let requestCount = 0;
  let executeCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) return response(`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"demo","arguments":"{\\"broken\\":"}}]}}]}

data: [DONE]

`);
    return response(`data: {"choices":[{"delta":{"content":"\u5DF2\u6839\u636E\u9519\u8BEF\u91CD\u65B0\u751F\u6210\u3002"}}]}

data: [DONE]

`);
  };
  try {
    const agent = new ModelToolAgent(config(), [], void 0);
    const result = await agent.run("do it", [{ key: "demo", description: "demo", inputSchema: { type: "object" } }], async () => {
      executeCount += 1;
      return {};
    });
    assert.equal(result, "\u5DF2\u6839\u636E\u9519\u8BEF\u91CD\u65B0\u751F\u6210\u3002");
    assert.equal(requestCount, 2);
    assert.equal(executeCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
test("an empty model response is retried once", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return requestCount === 1 ? response('data: {"choices":[{"delta":{}}]}\n\ndata: [DONE]\n\n') : response('data: {"choices":[{"delta":{"content":"\u91CD\u8BD5\u6210\u529F"}}]}\n\ndata: [DONE]\n\n');
  };
  try {
    const agent = new ModelToolAgent(config(), [], void 0);
    const result = await agent.run("say something", [{ key: "unused_tool", description: "unused", inputSchema: { type: "object" } }], async () => ({}));
    assert.equal(result, "\u91CD\u8BD5\u6210\u529F");
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
test("Responses completed event supplies text when no text delta was sent", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  globalThis.fetch = async () => response('data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"completed fallback"}]}]}}\n\ndata: [DONE]\n\n');
  try {
    const agent = new ModelToolAgent(responsesConfig(), [], void 0);
    const result = await agent.run("say something", [{ key: "unused_tool", description: "unused", inputSchema: { type: "object" } }], async () => ({}));
    assert.equal(result, "completed fallback");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
test("model API connection errors are retried up to recovery", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount < 3) throw new Error("fetch failed: socket reset");
    return response('data: {"choices":[{"delta":{"content":"recovered"}}]}\n\ndata: [DONE]\n\n');
  };
  try {
    const agent = new ModelToolAgent(config(), [], void 0);
    const result = await agent.run("say something", [{ key: "unused_tool", description: "unused", inputSchema: { type: "object" } }], async () => ({}));
    assert.equal(result, "recovered");
    assert.equal(requestCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
test("malformed Anthropic tool arguments are returned as a tool result", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  let requestCount = 0;
  let executeCount = 0;
  let secondRequest = "";
  globalThis.fetch = async (_url, init) => {
    requestCount += 1;
    if (requestCount === 2) secondRequest = String(init?.body || "");
    return requestCount === 1 ? response('data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"demo"}}\n\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"broken\\":"}}\n\n') : response('data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"fixed"}}\n\n');
  };
  try {
    const agent = new ModelToolAgent(anthropicConfig(), [], void 0);
    const result = await agent.run("do it", [{ key: "demo", description: "demo", inputSchema: { type: "object" } }], async () => {
      executeCount += 1;
      return {};
    });
    assert.equal(result, "fixed");
    assert.equal(requestCount, 2);
    assert.equal(executeCount, 0);
    assert.match(secondRequest, /tool_result/);
    assert.match(secondRequest, /模型返回了无法解析的工具参数/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
test("persisted tool calls and results are restored to the next OpenAI request", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || "{}"));
    return response('data: {"choices":[{"delta":{"content":"continued"}}]}\n\ndata: [DONE]\n\n');
  };
  const conversation = [
    { role: "user", content: "inspect it" },
    {
      role: "assistant",
      content: "The inspection is complete.",
      toolCalls: [{ id: "history-call-1", name: "demo", arguments: { path: "a.txt" }, result: { text: "file contents" } }]
    },
    { role: "user", content: "continue" }
  ];
  try {
    const agent = new ModelToolAgent(config(), [], void 0);
    await agent.run("continue", [{ key: "demo", description: "demo", inputSchema: { type: "object" } }], async () => ({}), "high", conversation);
    const messages = requestBody?.messages;
    assert.deepEqual(messages.slice(1).map((message) => message.role), ["user", "assistant", "tool", "assistant", "user"]);
    assert.deepEqual(messages[2]?.tool_calls, [{ id: "history-call-1", type: "function", function: { name: "demo", arguments: '{"path":"a.txt"}' } }]);
    assert.equal(messages[3]?.tool_call_id, "history-call-1");
    assert.equal(messages[3]?.content, '{"text":"file contents"}');
    assert.equal(messages[4]?.content, "The inspection is complete.");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
test("a single-turn sub-agent encodes user attachments as OpenAI image parts", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TEST_MODEL_KEY = "test-key";
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body || "{}"));
    return response('data: {"choices":[{"delta":{"content":"red"}}]}\n\ndata: [DONE]\n\n');
  };
  try {
    const agent = new ModelToolAgent(config(), [], void 0, void 0, false, true);
    const conversation = [
      {
        role: "user",
        content: "\u56FE\u4E2D\u662F\u4EC0\u4E48\u989C\u8272",
        attachments: [{ id: "a1", name: "test.png", mimeType: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgo=", size: 6 }]
      }
    ];
    const result = await agent.run("\u56FE\u4E2D\u662F\u4EC0\u4E48\u989C\u8272", [], async () => {
      throw new Error("\u8BC6\u56FE\u6A21\u578B\u4E0D\u5E94\u8C03\u7528\u5DE5\u5177");
    }, "low", conversation);
    assert.equal(result, "red");
    const messages = requestBody?.messages;
    const content = messages[1]?.content;
    assert.ok(Array.isArray(content));
    assert.deepEqual(content[0], { type: "text", text: "\u56FE\u4E2D\u662F\u4EC0\u4E48\u989C\u8272" });
    assert.deepEqual(content[1], { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_MODEL_KEY;
  }
});
