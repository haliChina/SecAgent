import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiHttpAsrProvider } from "./openai-http.js";
import type { AsrEvent } from "./types.js";
import type { OpenAiAsrSettings } from "./settings.js";

function setup(settings: OpenAiAsrSettings | undefined, apiKey: string, responses: Array<{ status: number; body: string }>): { provider: OpenAiHttpAsrProvider; requests: Array<{ url: string; auth: string | null; body: FormData }> } {
  const requests: Array<{ url: string; auth: string | null; body: FormData }> = [];
  let call = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = init?.headers ? (init.headers as Record<string, string>).Authorization ?? null : null;
    requests.push({ url, auth, body: init?.body as FormData });
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const provider = new OpenAiHttpAsrProvider({
    getSettings: () => settings,
    getApiKey: () => apiKey,
    fetchImpl
  });
  return { provider, requests };
}

const validSettings: OpenAiAsrSettings = { name: "小米 MiMo ASR", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1", apiKeyEnv: "MIMO_API_KEY", model: "MiMo-ASR" };

test("isConfigured requires settings, key and endpoint fields", () => {
  const { provider } = setup(undefined, "", []);
  assert.equal(provider.isConfigured(), false);
  const missingKey = setup(validSettings, "", []);
  assert.equal(missingKey.provider.isConfigured(), false);
  const ready = setup(validSettings, "sk-test", []);
  assert.equal(ready.provider.isConfigured(), true);
});

test("test() posts a WAV to the OpenAI-compatible transcriptions endpoint", async () => {
  const { provider, requests } = setup(validSettings, "sk-test", [{ status: 200, body: JSON.stringify({ text: "你好" }) }]);
  const result = await provider.test();
  assert.equal(result.ok, true);
  assert.match(result.message, /MiMo-ASR|连接成功/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://token-plan-cn.xiaomimimo.com/v1/audio/transcriptions");
  assert.equal(requests[0].auth, "Bearer sk-test");
  assert.equal(requests[0].body.get("model"), "MiMo-ASR");
  const file = requests[0].body.get("file");
  assert.ok(file instanceof File);
  assert.equal((file as File).type, "audio/wav");
});

test("test() reports auth failures in plain language", async () => {
  const { provider } = setup(validSettings, "sk-bad", [{ status: 401, body: JSON.stringify({ error: { message: "bad key" } }) }]);
  const result = await provider.test();
  assert.equal(result.ok, false);
  assert.match(result.message, /API Key 无效或无权限/);
});

test("test() explains a wrong base URL", async () => {
  const { provider } = setup(validSettings, "sk-test", [{ status: 404, body: "" }]);
  const result = await provider.test();
  assert.equal(result.ok, false);
  assert.match(result.message, /接口不存在/);
});

test("start() rejects with guidance when the key is missing", async () => {
  const { provider } = setup(validSettings, "", []);
  await assert.rejects(() => provider.start(() => {}), /MIMO_API_KEY/);
});

test("a session emits final text on stop, then a stopped event", async () => {
  const { provider } = setup(validSettings, "sk-test", [{ status: 200, body: JSON.stringify({ text: "你好世界" }) }]);
  const events: AsrEvent[] = [];
  const session = await provider.start((event) => events.push(event));
  session.push(new Float32Array(16_000)); // 1 second
  await session.stop();
  const types = events.map((event) => event.type);
  // The provider emits final + stopped; the manager adds "ready" itself.
  assert.ok(types.includes("final"));
  assert.equal(types[types.length - 1], "stopped");
  const final = events.find((event) => event.type === "final");
  assert.equal(final && final.type === "final" ? final.text : "", "你好世界");
});

test("cancel drops buffered audio without emitting results", async () => {
  const { provider } = setup(validSettings, "sk-test", [{ status: 200, body: JSON.stringify({ text: "你好" }) }]);
  const events: AsrEvent[] = [];
  const session = await provider.start((event) => events.push(event));
  session.push(new Float32Array(16_000));
  session.cancel();
  await session.stop();
  assert.equal(events.some((event) => event.type === "final" || event.type === "partial"), false);
});
