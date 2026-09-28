import test from "node:test";
import assert from "node:assert/strict";
import { ASR_OPENAI_PRESETS, isOpenAiAsrConfigured, normalizeSpeechSettings, type SpeechAsrSettings } from "./settings.js";

test("presets include Xiaomi MiMo ASR with an OpenAI-compatible base URL", () => {
  const mimo = ASR_OPENAI_PRESETS.find((preset) => preset.id === "mimo");
  assert.ok(mimo, "MiMo preset exists");
  assert.match(mimo!.baseUrl, /^https:\/\/.+\/v1$/);
  assert.ok(mimo!.model);
  assert.ok(mimo!.apiKeyEnv);
});

test("presets are unique by id and base URL", () => {
  const ids = ASR_OPENAI_PRESETS.map((preset) => preset.id);
  const urls = ASR_OPENAI_PRESETS.map((preset) => preset.baseUrl);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(urls).size, urls.length);
});

test("normalizeSpeechSettings accepts undefined and garbage", () => {
  assert.deepEqual(normalizeSpeechSettings(undefined), { betterRecognition: false, provider: "auto" });
  assert.deepEqual(normalizeSpeechSettings("nonsense"), { betterRecognition: false, provider: "auto" });
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
