import test from "node:test";
import assert from "node:assert/strict";
import { ASR_OPENAI_PRESETS, MIMO_ASR_DEFAULTS, isOpenAiAsrConfigured, normalizeSpeechSettings, type SpeechAsrSettings } from "./settings.js";

test("MiMo ASR ships dedicated chat/completions defaults (not /audio/transcriptions)", () => {
  // 小米 MiMo 走专用 chat/completions + input_audio 协议（mimo-http.ts），
  // 不在 ASR_OPENAI_PRESETS 里，但必须提供开箱默认端点。
  assert.equal(ASR_OPENAI_PRESETS.some((preset) => preset.id === "mimo"), false);
  assert.match(MIMO_ASR_DEFAULTS.baseUrl, /^https:\/\/.+\/v1$/);
  assert.ok(MIMO_ASR_DEFAULTS.model);
  assert.ok(MIMO_ASR_DEFAULTS.apiKeyEnv);
});

test("presets are unique by id and base URL", () => {
  const ids = ASR_OPENAI_PRESETS.map((preset) => preset.id);
  const urls = ASR_OPENAI_PRESETS.map((preset) => preset.baseUrl);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(urls).size, urls.length);
});

test("normalizeSpeechSettings accepts undefined and garbage", () => {
  // MiMo 默认块始终带出（有官方默认端点，设置页开箱即用）。
  const defaults = { betterRecognition: false, provider: "auto", mimo: { apiKeyEnv: "MIMO_API_KEY", baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2.5-asr" } };
  assert.deepEqual(normalizeSpeechSettings(undefined), defaults);
  assert.deepEqual(normalizeSpeechSettings("nonsense"), defaults);
});

test("normalizeSpeechSettings keeps a valid provider and trims endpoint fields", () => {
  const normalized = normalizeSpeechSettings({ provider: "openai", openai: { baseUrl: " https://api.example.com/v1/ ", apiKeyEnv: "MIMO_API_KEY", model: " MiMo-ASR " } });
  assert.equal(normalized.provider, "openai");
  assert.equal(normalized.openai?.baseUrl, "https://api.example.com/v1");
  assert.equal(normalized.openai?.model, "MiMo-ASR");
});

test("normalizeSpeechSettings rejects malformed env var names", () => {
  const normalized = normalizeSpeechSettings({ openai: { baseUrl: "https://x.example.com/v1", apiKeyEnv: "not a name!", model: "m" } });
  assert.equal(normalized.openai?.apiKeyEnv, "");
});

test("isOpenAiAsrConfigured requires endpoint, model and key name", () => {
  const base: SpeechAsrSettings = { provider: "openai", openai: { baseUrl: "https://x/v1", apiKeyEnv: "K", model: "m" } };
  assert.equal(isOpenAiAsrConfigured(base), true);
  assert.equal(isOpenAiAsrConfigured({ ...base, openai: { ...base.openai!, model: "" } }), false);
  assert.equal(isOpenAiAsrConfigured(undefined), false);
});

test("openai prompt 热词：trim 后保留、上限 1000、空值丢弃（OpenMinis 学习项）", () => {
  const kept = normalizeSpeechSettings({ provider: "openai", openai: { baseUrl: "https://api.example.com/v1/", model: "whisper-1", apiKeyEnv: "K", prompt: "  SecAgent GLM  " } });
  assert.equal(kept.openai?.prompt, "SecAgent GLM");
  const dropped = normalizeSpeechSettings({ provider: "openai", openai: { baseUrl: "https://api.example.com/v1", model: "whisper-1", apiKeyEnv: "K", prompt: "   " } });
  assert.equal("prompt" in (dropped.openai || {}), false);
  const capped = normalizeSpeechSettings({ provider: "openai", openai: { baseUrl: "https://api.example.com/v1", model: "whisper-1", apiKeyEnv: "K", prompt: "词".repeat(1500) } });
  assert.equal(capped.openai?.prompt?.length, 1000);
});
