import test from "node:test";
import assert from "node:assert/strict";
import { OpenAiHttpAsrProvider, usesChatBasedAsr } from "./openai-http.js";
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

// ---- OpenMinis 学习三件套：热词 prompt / 错误信封透传 / chat-based ASR 路由 ----

test("usesChatBasedAsr：音频多模态 chat 模型走 chat，专用 ASR 一律留 transcriptions", () => {
  // 闭集白名单（学习自 OpenMinis usesChatBasedASR）
  assert.equal(usesChatBasedAsr("gpt-4o-audio-preview"), true);
  assert.equal(usesChatBasedAsr("gpt-audio-mini"), true);
  assert.equal(usesChatBasedAsr("qwen3-omni"), true);
  assert.equal(usesChatBasedAsr("Qwen2.5-Omni-7B"), true);
  // 开集默认（方向不能反——专用 ASR 是开集，必须留在 transcriptions）
  assert.equal(usesChatBasedAsr("whisper-1"), false);
  assert.equal(usesChatBasedAsr("whisper-large-v3"), false);
  assert.equal(usesChatBasedAsr("FunAudioLLM/SenseVoiceSmall"), false);
  assert.equal(usesChatBasedAsr("qwen3-asr-flash"), false);
  assert.equal(usesChatBasedAsr("MiMo-ASR"), false);
  assert.equal(usesChatBasedAsr("paraformer-zh"), false);
});

test("prompt 热词作为 Whisper prompt 字段透传（transcriptions 路径）", async () => {
  const { provider, requests } = setup({ ...validSettings, prompt: "SecAgent GLM 知行" }, "sk-test", [{ status: 200, body: JSON.stringify({ text: "你好" }) }]);
  await provider.test();
  assert.equal(requests[0].body.get("prompt"), "SecAgent GLM 知行");
});

test("chat 模型路由到 chat/completions：input_audio raw base64 + 系统提示词逐字转写", async () => {
  const chatSettings: OpenAiAsrSettings = { ...validSettings, model: "gpt-4o-audio-preview", prompt: "SecAgent" };
  const { provider, requests } = setup(chatSettings, "sk-test", [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: "你好世界" } }] }) }]);
  const result = await provider.test();
  assert.equal(result.ok, true);
  assert.equal(requests[0].url, "https://token-plan-cn.xiaomimimo.com/v1/chat/completions");
  const body = JSON.parse(String(requests[0].body)) as { model: string; stream: boolean; messages: Array<{ role: string; content: unknown }> };
  assert.equal(body.model, "gpt-4o-audio-preview");
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, "system");
  assert.match(String(body.messages[0].content), /逐字转写/);
  assert.match(String(body.messages[0].content), /SecAgent/);
  const userContent = body.messages[1].content as Array<{ type: string; input_audio: { data: string; format: string } }>;
  assert.equal(userContent[0].type, "input_audio");
  assert.equal(userContent[0].input_audio.format, "wav");
  assert.ok(userContent[0].input_audio.data.length > 100, "base64 音频非空");
  assert.ok(!userContent[0].input_audio.data.startsWith("data:"), "raw base64（OpenAI 规范），不是 Data URL");
  assert.match(result.message, /你好世界|连接成功/);
});

test("chat 路径兼容 content 为文本分片数组（qwen-omni 实测形态）", async () => {
  const chatSettings: OpenAiAsrSettings = { ...validSettings, model: "qwen3-omni" };
  const { provider } = setup(chatSettings, "sk-test", [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "分段" }, { type: "text", text: "转写" }] } }] }) }]);
  const events: AsrEvent[] = [];
  const session = await provider.start((event) => events.push(event));
  session.push(new Float32Array(16_000));
  await session.stop();
  const final = events.find((event) => event.type === "final");
  assert.equal(final && final.type === "final" ? final.text : "", "分段转写");
});

test("错误信封透传：厂商自己的 error.message 拼进用户可见报错", async () => {
  const { provider } = setup(validSettings, "sk-bad", [{ status: 401, body: JSON.stringify({ error: { message: "Incorrect API key provided by you" } }) }]);
  const result = await provider.test();
  assert.equal(result.ok, false);
  assert.match(result.message, /Incorrect API key provided/);
  // 5xx 同样透传（此前只报状态码）
  const server = setup(validSettings, "sk-test", [{ status: 503, body: JSON.stringify({ message: "model overloaded" }) }]);
  const serverResult = await server.provider.test();
  assert.equal(serverResult.ok, false);
  assert.match(serverResult.message, /model overloaded/);
});

test("chat 路径的厂商错误信封同样透传", async () => {
  const chatSettings: OpenAiAsrSettings = { ...validSettings, model: "gpt-4o-audio-preview" };
  const { provider } = setup(chatSettings, "sk-bad", [{ status: 500, body: JSON.stringify({ error: { message: "audio token limit exceeded" } }) }]);
  const result = await provider.test();
  assert.equal(result.ok, false);
  assert.match(result.message, /audio token limit exceeded/);
});
