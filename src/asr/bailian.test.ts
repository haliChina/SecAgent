/**
 * 阿里云百炼 ASR 测试 — 通道 A（chat/completions）与通道 B（实时 WebSocket）。
 *
 * 断言严格对齐官方协议（禁止凭记忆编造）：
 *   A: POST {baseUrl}/chat/completions（绝不触碰 /audio/transcriptions），
 *      `stream:false`、`asr_options` 在 body 顶层、音频为 data:audio/wav;base64, Data URL；
 *   B: run-task（streaming=duplex）+ ≤16KB 的 ~100ms PCM 二进制帧 + finish-task。
 *
 * Docs:
 *   https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference
 *   https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BailianHttpAsrProvider } from "./bailian-http.js";
import { BailianWsAsrProvider, type BailianWsConstructor } from "./bailian-ws.js";
import { OpenAiHttpAsrProvider } from "./openai-http.js";
import { resolveBailianConfig } from "./bailian-config.js";
import { AsrManager } from "./manager.js";
import type { AsrEvent, AsrEventSink, AsrProvider, AsrSession } from "./types.js";
import type { BailianAsrSettings } from "./settings.js";

const BAILIAN_SETTINGS: BailianAsrSettings = {
  name: "百炼测试",
  apiKeyEnv: "BAILIAN_API_KEY",
  baseUrl: "https://ws-test123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  wsUrl: "wss://ws-test123.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
  model: "qwen3-asr-flash",
  streamModel: "qwen-audio-3.1-asr-flash-streaming",
  language: "zh",
  enableItn: false
};

/* ------------------------------------------------------------------ */
/* Channel A — non-streaming chat/completions                          */
/* ------------------------------------------------------------------ */

interface CapturedRequest {
  url: string;
  auth: string | null;
  body: Record<string, unknown>;
}

function fakeFetch(responses: Array<{ status: number; body: string }>): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  let call = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>
    });
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

function httpProvider(
  settings: BailianAsrSettings | undefined,
  apiKey: string,
  responses: Array<{ status: number; body: string }>
): { provider: BailianHttpAsrProvider; requests: CapturedRequest[] } {
  const { fetchImpl, requests } = fakeFetch(responses);
  return {
    provider: new BailianHttpAsrProvider({ getSettings: () => settings, getApiKey: () => apiKey || undefined, fetchImpl, rateLimitBaseDelayMs: 1 }),
    requests
  };
}

function audioDataUrl(body: Record<string, unknown>): string {
  const messages = body.messages as Array<{ role: string; content: Array<{ type: string; input_audio: { data: string } }> }>;
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content[0].type, "input_audio");
  return messages[0].content[0].input_audio.data;
}

const CHAT_REPLY = JSON.stringify({ choices: [{ message: { content: "你好世界" }, finish_reason: "stop" }], usage: {} });

test("config resolution prefers settings, then .env, then documented defaults", () => {
  const env = {
    BAILIAN_API_KEY: "sk-env",
    BAILIAN_BASE_URL: "https://env.example.com/compatible-mode/v1",
    BAILIAN_WS_URL: "wss://env.example.com/api-ws/v1/inference",
    BAILIAN_ASR_MODEL: "env-model",
    BAILIAN_STREAM_MODEL: "env-stream-model",
    BAILIAN_LANGUAGE: "en",
    BAILIAN_ENABLE_ITN: "true"
  };
  const getApiKey = (name: string): string | undefined => env[name as keyof typeof env];

  assert.equal(resolveBailianConfig(undefined, () => undefined, {}), null);

  const fromEnv = resolveBailianConfig(undefined, getApiKey, env);
  assert.ok(fromEnv);
  assert.equal(fromEnv.apiKey, "sk-env");
  assert.equal(fromEnv.baseUrl, "https://env.example.com/compatible-mode/v1");
  assert.equal(fromEnv.wsUrl, "wss://env.example.com/api-ws/v1/inference");
  assert.equal(fromEnv.model, "env-model");
  assert.equal(fromEnv.streamModel, "env-stream-model");
  assert.equal(fromEnv.language, "en");
  assert.equal(fromEnv.enableItn, true);

  const fromSettings = resolveBailianConfig(BAILIAN_SETTINGS, getApiKey, env);
  assert.ok(fromSettings);
  assert.equal(fromSettings.baseUrl, BAILIAN_SETTINGS.baseUrl);
  assert.equal(fromSettings.model, "qwen3-asr-flash");
  assert.equal(fromSettings.language, "zh");

  // 空 env 回落到文档默认值（含公共域名回退）。
  const defaults = resolveBailianConfig(undefined, () => "sk-test", {});
  assert.ok(defaults);
  assert.equal(defaults.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(defaults.wsUrl, "wss://dashscope.aliyuncs.com/api-ws/v1/inference");
  assert.equal(defaults.model, "qwen3-asr-flash");
  assert.equal(defaults.streamModel, "qwen-audio-3.1-asr-flash-streaming");
  assert.equal(defaults.enableItn, false);
  assert.equal("language" in defaults, false);
});

test("channel A posts a non-streaming chat/completions request with a WAV Data URL and asr_options", async () => {
  const { provider, requests } = httpProvider(BAILIAN_SETTINGS, "sk-test", [{ status: 200, body: CHAT_REPLY }]);
  const result = await provider.test();

  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, `${BAILIAN_SETTINGS.baseUrl}/chat/completions`);
  // 明确禁止：百炼不支持 OpenAI Whisper 范式的转写端点。
  assert.equal(request.url.includes("/audio/transcriptions"), false);
  assert.equal(request.auth, "Bearer sk-test");
  assert.equal(request.body.model, "qwen3-asr-flash");
  // 非流式场景固定 stream=false。
  assert.equal(request.body.stream, false);
  // asr_options 是百炼扩展参数，直连 HTTP 时放 body 顶层。
  assert.deepEqual(request.body.asr_options, { language: "zh", enable_itn: false });
  assert.equal("asr_options" in ((request.body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content[0]), false);

  const dataUrl = audioDataUrl(request.body);
  assert.ok(dataUrl.startsWith("data:audio/wav;base64,"));
  const wav = Buffer.from(dataUrl.slice("data:audio/wav;base64,".length), "base64");
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.readUInt32LE(24), 16_000); // sample rate
  // 250ms probe → 44-byte header + 16000Hz * 2B * 0.25s。
  assert.equal(wav.length, 44 + 8_000);

  assert.equal(result.ok, true);
  assert.match(result.message, /你好世界/);
});

test("channel A omits the language hint when it is not configured (auto detect)", async () => {
  const { provider, requests } = httpProvider({ ...BAILIAN_SETTINGS, language: undefined }, "sk-test", [{ status: 200, body: CHAT_REPLY }]);
  const previous = process.env.BAILIAN_LANGUAGE;
  process.env.BAILIAN_LANGUAGE = "";
  try {
    await provider.test();
  } finally {
    if (previous === undefined) delete process.env.BAILIAN_LANGUAGE;
    else process.env.BAILIAN_LANGUAGE = previous;
  }
  const options = requests[0].body.asr_options as Record<string, unknown>;
  assert.deepEqual(options, { enable_itn: false });
  assert.equal("language" in options, false);
});

test("a 1-second utterance is sent as one Data URL and yields the final transcript", async () => {
  const { provider, requests } = httpProvider(BAILIAN_SETTINGS, "sk-test", [{ status: 200, body: CHAT_REPLY }]);
  const events: AsrEvent[] = [];
  const session = await provider.start((event) => events.push(event));
  session.push(new Float32Array(16_000)); // exactly 1 second
  await session.stop();

  assert.equal(requests.length, 1);
  const dataUrl = audioDataUrl(requests[0].body);
  assert.ok(dataUrl.startsWith("data:audio/wav;base64,"));
  const wav = Buffer.from(dataUrl.slice("data:audio/wav;base64,".length), "base64");
  assert.equal(wav.length, 44 + 16_000 * 2);
  assert.equal(wav.readUInt32LE(40), 16_000 * 2); // data chunk size

  const final = events.find((event) => event.type === "final");
  assert.equal(final && final.type === "final" ? final.text : "", "你好世界");
  assert.equal(events[events.length - 1].type, "stopped");
});

test("channel A start() rejects with the .env variable name when no key is stored", async () => {
  const { provider } = httpProvider(BAILIAN_SETTINGS, "", []);
  assert.equal(provider.isConfigured(), false);
  await assert.rejects(() => provider.start(() => {}), /BAILIAN_API_KEY/);
});

test("401/403 explains the invalid key or exhausted quota and points at other providers", async () => {
  const { provider } = httpProvider(BAILIAN_SETTINGS, "sk-bad", [{ status: 401, body: JSON.stringify({ error: { message: "invalid api key" } }) }]);
  const result = await provider.test();
  assert.equal(result.ok, false);
  assert.match(result.message, /API Key 无效|额度/);

  const events: AsrEvent[] = [];
  const session = await provider.start((event) => events.push(event));
  session.push(new Float32Array(16_000));
  await session.stop();
  const error = events.find((event) => event.type === "error");
  assert.ok(error && error.type === "error");
  if (error.type === "error") assert.match(error.message, /切换识别服务|API Key 无效/);
});

test("404 points at the missing /compatible-mode/v1 suffix", async () => {
  const { provider } = httpProvider({ ...BAILIAN_SETTINGS, baseUrl: "https://ws-test123.cn-beijing.maas.aliyuncs.com" }, "sk-test", [{ status: 404, body: "" }]);
  const result = await provider.test();
  assert.equal(result.ok, false);
  assert.match(result.message, /compatible-mode\/v1/);
});

test("429 retries with exponential backoff and succeeds within the retry budget", async () => {
  const { provider, requests } = httpProvider(BAILIAN_SETTINGS, "sk-test", [
    { status: 429, body: "" },
    { status: 429, body: "" },
    { status: 200, body: CHAT_REPLY }
  ]);
  const result = await provider.test();
  assert.equal(result.ok, true);
  assert.equal(requests.length, 3);
});

test("429 exhausts three retries and reports the rate limit to the sink", async () => {
  const { provider, requests } = httpProvider(BAILIAN_SETTINGS, "sk-test", [{ status: 429, body: "" }]);
  const events: AsrEvent[] = [];
  const session = await provider.start((event) => events.push(event));
  session.push(new Float32Array(16_000));
  await session.stop();
  assert.equal(requests.length, 4); // initial attempt + 3 retries
  const error = events.find((event) => event.type === "error");
  assert.ok(error && error.type === "error");
  if (error.type === "error") assert.match(error.message, /429|限流/);
});

/* ------------------------------------------------------------------ */
/* Channel B — realtime WebSocket (duplex)                             */
/* ------------------------------------------------------------------ */

interface RunTaskMessage {
  header: { action: string; task_id: string; streaming: string };
  payload: {
    task_group: string;
    task: string;
    function: string;
    model: string;
    parameters: Record<string, unknown>;
    input: Record<string, unknown>;
  };
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  static onOpen: (socket: FakeSocket) => void = (socket) => {
    socket.readyState = 1;
    socket.onopen?.(new Event("open"));
  };
  static onRunTask: (socket: FakeSocket) => void = (socket) => {
    setTimeout(() => socket.emit({ header: { event: "task-started", task_id: "test-task-id" }, payload: {} }), 0);
  };

  static reset(): void {
    FakeSocket.instances = [];
    FakeSocket.onOpen = (socket) => {
      socket.readyState = 1;
      socket.onopen?.(new Event("open"));
    };
    FakeSocket.onRunTask = (socket) => {
      setTimeout(() => socket.emit({ header: { event: "task-started", task_id: "test-task-id" }, payload: {} }), 0);
    };
  }

  readyState = 0;
  binaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly url: string;
  readonly headers: Record<string, string> | undefined;
  readonly sent: Array<string | ArrayBuffer> = [];
  closed = false;

  constructor(url: string, options?: { headers?: Record<string, string> }) {
    this.url = url;
    this.headers = options?.headers;
    FakeSocket.instances.push(this);
    setTimeout(() => { if (!this.closed) FakeSocket.onOpen(this); }, 0);
  }

  send(data: string | ArrayBuffer): void {
    if (this.closed) throw new Error("socket is closed");
    this.sent.push(data);
    if (typeof data !== "string") return;
    if (data.includes("\"run-task\"")) FakeSocket.onRunTask(this);
    else if (data.includes("\"finish-task\"")) {
      setTimeout(() => this.emit({ header: { event: "task-finished", task_id: "test-task-id" }, payload: {} }), 0);
    }
  }

  close(code?: number, reason?: string): void {
    void reason;
    void code;
    this.closed = true;
    this.readyState = 3;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  /** Simulate an unexpected drop (network jitter, 401 handshake……). */
  drop(code = 1006): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }

  binaryFrames(): ArrayBuffer[] {
    return this.sent.filter((item): item is ArrayBuffer => typeof item !== "string");
  }

  textMessages(): string[] {
    return this.sent.filter((item): item is string => typeof item === "string");
  }
}

function wsProvider(settings: BailianAsrSettings | undefined = BAILIAN_SETTINGS, apiKey = "sk-test"): BailianWsAsrProvider {
  return new BailianWsAsrProvider({
    getSettings: () => settings,
    getApiKey: () => apiKey || undefined,
    WebSocketCtor: FakeSocket as unknown as BailianWsConstructor,
    uuid: () => "test-task-id"
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), "condition not met before the timeout");
}

test("channel B runs the documented duplex handshake and streams ~100ms PCM frames", async () => {
  FakeSocket.reset();
  const events: AsrEvent[] = [];
  const session = await wsProvider().start((event) => events.push(event));
  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);

  assert.equal(socket.url, BAILIAN_SETTINGS.wsUrl);
  assert.equal(socket.url.includes("/audio/transcriptions"), false);
  assert.equal(socket.headers?.Authorization, "Bearer sk-test");
  assert.ok(socket.headers?.["user-agent"]);

  const runTask = JSON.parse(socket.textMessages()[0]) as RunTaskMessage;
  assert.equal(runTask.header.action, "run-task");
  assert.equal(runTask.header.task_id, "test-task-id");
  assert.equal(runTask.header.streaming, "duplex"); // 文档固定值（非 "out"）
  assert.equal(runTask.payload.task_group, "audio");
  assert.equal(runTask.payload.task, "asr");
  assert.equal(runTask.payload.function, "recognition");
  assert.equal(runTask.payload.model, "qwen-audio-3.1-asr-flash-streaming");
  assert.deepEqual(runTask.payload.parameters, { format: "pcm", sample_rate: 16_000 });

  session.push(new Float32Array(16_000)); // 1s → ten 3.2KB frames
  const frames = socket.binaryFrames();
  assert.equal(frames.length, 10);
  for (const frame of frames) {
    assert.equal(frame.byteLength, 3_200);
    assert.ok(frame.byteLength <= 16 * 1024, "frame exceeds the 16KB cap");
    assert.ok(frame.byteLength >= 1024, "frame below the 1KB floor was sent mid-stream");
  }

  // 中间结果 → partial，最终结果 → final，心跳包忽略。
  socket.emit({ header: { event: "result-generated", task_id: "test-task-id" }, payload: { output: { sentence: { text: "你好", sentence_end: false } } } });
  socket.emit({ header: { event: "result-generated", task_id: "test-task-id" }, payload: { output: { sentence: { text: "你好世界", sentence_end: true, begin_time: 0, end_time: 900 } } } });
  socket.emit({ header: { event: "result-generated", task_id: "test-task-id" }, payload: { output: { sentence: { text: "心跳", heartbeat: true, sentence_id: 0 } } } });

  await session.stop();
  const types = events.map((event) => event.type);
  assert.deepEqual(types, ["partial", "final", "stopped"]);
  assert.equal(events[0].type === "partial" ? events[0].text : "", "你好");
  assert.equal(events[1].type === "final" ? events[1].text : "", "你好世界");
  assert.equal(events.some((event) => event.type !== "stopped" && "text" in event && event.text === "心跳"), false);

  const finishTask = JSON.parse(socket.textMessages().at(-1) || "{}") as { header: { action: string; task_id: string } };
  assert.equal(finishTask.header.action, "finish-task");
  assert.equal(finishTask.header.task_id, "test-task-id");
  assert.equal(socket.binaryFrames().length, 10); // 无多余尾帧
});

test("channel B buffers sub-100ms tails until stop instead of bursting small frames", async () => {
  FakeSocket.reset();
  const session = await wsProvider().start(() => {});
  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);

  session.push(new Float32Array(1_600)); // 100ms → 1 full frame
  session.push(new Float32Array(400)); // 25ms → buffered
  assert.equal(socket.binaryFrames().length, 1);

  await session.stop();
  const frames = socket.binaryFrames();
  assert.equal(frames.length, 2);
  assert.equal(frames[0].byteLength, 3_200);
  assert.equal(frames[1].byteLength, 800); // 尾帧仅在结束 utterance 时单独发送
  assert.match(socket.textMessages().at(-1) || "", /finish-task/);
});

test("channel B surfaces task-failed with the server error message", async () => {
  FakeSocket.reset();
  FakeSocket.onRunTask = (socket) => {
    setTimeout(() => socket.emit({
      header: { event: "task-failed", task_id: "test-task-id", error_code: "CLIENT_ERROR", error_message: "request timeout after 23 seconds." },
      payload: {}
    }), 0);
  };
  try {
    const events: AsrEvent[] = [];
    await assert.rejects(() => wsProvider().start((event) => events.push(event)), /request timeout after 23 seconds/);
    const error = events.find((event) => event.type === "error");
    assert.ok(error && error.type === "error");
  } finally {
    FakeSocket.reset();
  }
});

test("channel B handshake failures recommend checking key and WS URL", async () => {
  FakeSocket.reset();
  FakeSocket.onOpen = (socket) => { socket.drop(1006); };
  try {
    await assert.rejects(() => wsProvider().start(() => {}), /API Key|连接已断开/);
  } finally {
    FakeSocket.reset();
  }
});

test("channel B reconnects once after a mid-stream drop and replays the buffered audio", async () => {
  FakeSocket.reset();
  const events: AsrEvent[] = [];
  const session = await wsProvider().start((event) => events.push(event));
  const first = FakeSocket.instances.at(-1);
  assert.ok(first);

  session.push(new Float32Array(8_000)); // 0.5s → 5 frames
  assert.equal(first.binaryFrames().length, 5);

  first.drop(1006);
  session.push(new Float32Array(8_000)); // queued while reconnecting
  await waitFor(() => FakeSocket.instances.length === 2 && FakeSocket.instances[1].binaryFrames().length === 10);

  const second = FakeSocket.instances[1];
  const replay = second.binaryFrames();
  assert.equal(replay.length, 10); // 1s of audio (0.5s replayed + 0.5s queued) as ≤16KB frames
  for (const frame of replay) assert.ok(frame.byteLength <= 16 * 1024);

  second.emit({ header: { event: "result-generated", task_id: "test-task-id" }, payload: { output: { sentence: { text: "重连成功", sentence_end: true } } } });
  await session.stop();
  assert.equal(events.some((event) => event.type === "final" && event.text === "重连成功"), true);
  assert.equal(events[events.length - 1].type, "stopped");
  assert.equal(events.some((event) => event.type === "error"), false);
});

test("channel B gives up after a second drop so the manager can fall back", async () => {
  FakeSocket.reset();
  const events: AsrEvent[] = [];
  const session = await wsProvider().start((event) => events.push(event));
  const first = FakeSocket.instances.at(-1);
  assert.ok(first);
  session.push(new Float32Array(3_200));
  first.drop(1006);
  await waitFor(() => FakeSocket.instances.length === 2 && FakeSocket.instances[1].binaryFrames().length > 0);

  FakeSocket.instances[1].drop(1006);
  await waitFor(() => events.some((event) => event.type === "error"));
  const error = events.find((event) => event.type === "error");
  assert.ok(error && error.type === "error");
  if (error.type === "error") assert.match(error.message, /重连失败|改用非流式/);
  session.cancel();
});

test("channel B cancel closes the socket without emitting results", async () => {
  FakeSocket.reset();
  const events: AsrEvent[] = [];
  const session = await wsProvider().start((event) => events.push(event));
  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);
  session.push(new Float32Array(16_000));
  session.cancel();
  assert.equal(socket.closed, true);
  session.push(new Float32Array(16_000)); // ignored after cancel
  await session.stop();
  assert.equal(events.some((event) => event.type === "final" || event.type === "partial" || event.type === "stopped"), false);
});

test("channel B test() reports the endpoint and requires an API key", async () => {
  const ready = await wsProvider().test();
  assert.equal(ready.ok, true);
  assert.match(ready.message, /api-ws\/v1\/inference/);
  const missing = await wsProvider(BAILIAN_SETTINGS, "").test();
  assert.equal(missing.ok, false);
  assert.match(missing.message, /BAILIAN_API_KEY/);
});

/* ------------------------------------------------------------------ */
/* Orchestration — new provider kinds and regressions                  */
/* ------------------------------------------------------------------ */

function fakeProvider(id: string, configured = true): AsrProvider {
  return {
    id,
    label: id,
    isConfigured: () => configured,
    start: async (sink: AsrEventSink): Promise<AsrSession> => ({
      providerId: id,
      push: () => {},
      stop: async () => { sink({ type: "stopped" }); },
      cancel: () => {}
    })
  };
}

test("manager chains the 百炼 channels and leaves existing kinds untouched", () => {
  FakeSocket.reset();
  let kind: "auto" | "bailian" | "bailian-ws" = "auto";
  const manager = new AsrManager({ getProviderKind: () => kind });
  manager.register(fakeProvider("openai"));
  manager.register(fakeProvider("official"));
  manager.register(new BailianHttpAsrProvider({ getSettings: () => BAILIAN_SETTINGS, getApiKey: () => "sk-test" }));
  manager.register(new BailianWsAsrProvider({ getSettings: () => BAILIAN_SETTINGS, getApiKey: () => "sk-test", WebSocketCtor: FakeSocket as unknown as BailianWsConstructor }));
  manager.register(fakeProvider("local"));

  assert.deepEqual(manager.chain(), ["openai", "official", "local"]);
  kind = "bailian";
  assert.deepEqual(manager.chain(), ["bailian", "local"]);
  kind = "bailian-ws";
  assert.deepEqual(manager.chain(), ["bailian-ws", "bailian", "local"]);

  // 未配置 Key 时百炼通道被跳过，本地模型仍然可用。
  const unconfigured = new AsrManager({ getProviderKind: () => "bailian-ws" });
  unconfigured.register(new BailianHttpAsrProvider({ getSettings: () => undefined, getApiKey: () => undefined }));
  unconfigured.register(new BailianWsAsrProvider({ getSettings: () => undefined, getApiKey: () => undefined }));
  unconfigured.register(fakeProvider("local"));
  assert.deepEqual(unconfigured.chain(), ["local"]);
});

test("third-party OpenAI-compatible presets are unchanged (SiliconFlow regression)", async () => {
  const captured = fakeFetch([{ status: 200, body: JSON.stringify({ text: "回归通过" }) }]);
  const provider = new OpenAiHttpAsrProvider({
    getSettings: () => ({ name: "SiliconFlow SenseVoice", baseUrl: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_API_KEY", model: "FunAudioLLM/SenseVoiceSmall" }),
    getApiKey: () => "sk-sf",
    fetchImpl: captured.fetchImpl
  });
  const result = await provider.test();
  assert.equal(result.ok, true);
  assert.equal(captured.requests[0].url, "https://api.siliconflow.cn/v1/audio/transcriptions");
});