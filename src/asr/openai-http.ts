/**
 * Third-party cloud ASR through an OpenAI-compatible `/audio/transcriptions`
 * endpoint — works with 小米 MiMo ASR、SiliconFlow SenseVoice、Groq Whisper and
 * any other provider that implements the same multipart protocol.
 *
 * Plain HTTP cannot stream, so the session chunks the utterance: buffered
 * audio is flushed as a WAV roughly every three seconds and surfaced as
 * `partial` text, and the stop() flush emits the `final` result.
 */
import type { AsrEventSink, AsrProvider, AsrSession, AsrTestResult } from "./types.js";
import { encodeWav, mergeSamples, ASR_SAMPLE_RATE } from "./wav.js";
import type { OpenAiAsrSettings } from "./settings.js";

const PARTIAL_FLUSH_MS = 3_000;
const MIN_CHUNK_MS = 900;
const CONNECT_TIMEOUT_MS = 12_000;

interface OpenAiAsrOptions {
  /** Current provider settings (re-read on each start). */
  getSettings: () => OpenAiAsrSettings | undefined;
  /** Resolves the API key for an env var name (usually process.env). */
  getApiKey: (envName: string) => string | undefined;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

interface TranscriptionResponse { text?: string; error?: { message?: string } | string }

/**
 * 厂商错误信封透传（学习自 OpenMinis）：OpenAI 兼容服务的错误响应几乎都带
 * 自己的 message——`{"error":{"message":"Incorrect API key provided"}}`（OpenAI/
 * Groq/SiliconFlow）或 `{"message":"..."}` / `{"msg":"..."}`（部分中继）。把这条
 * 真实原因拼进用户可见的报错，比按状态码猜一通有用得多（对照 MiniMax
 * base_resp.status_msg 直抛的做法）。
 */
function extractApiErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown; msg?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
    if (parsed.error && typeof parsed.error === "object" && typeof parsed.error.message === "string" && parsed.error.message.trim()) return parsed.error.message.trim();
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
    if (typeof parsed.msg === "string" && parsed.msg.trim()) return parsed.msg.trim();
  } catch { /* body 不是 JSON——按原样截断 */ }
  return "";
}

function statusMessage(status: number, body: string): string {
  const detail = extractApiErrorDetail(body) || body.slice(0, 200).trim();
  const suffix = detail ? `：${detail.slice(0, 200)}` : "";
  if (status === 401 || status === 403) return `API Key 无效或无权限（检查密钥是否正确、是否有语音模型权限）${suffix}`;
  if (status === 404) return `接口不存在：请检查 Base URL 是否为 OpenAI 兼容地址（一般以 /v1 结尾）${suffix}`;
  if (status === 422 || status === 400) return `请求被拒绝（${status}）${suffix || "：请检查模型名称"}`;
  if (status === 429) return `请求过于频繁（429 限流），请稍后重试${suffix}`;
  if (status >= 500) return `服务端错误（${status}）${suffix}`;
  return `请求失败（${status}）${suffix}`;
}

/**
 * Chat-based ASR 路由（学习自 OpenMinis 的 usesChatBasedASR）：
 * 能听音频的多模态 **chat** 模型是一个小而可枚举的闭集（gpt-4o-audio* /
 * gpt-audio* / qwen*-omni*），OpenAI 兼容服务只经 chat/completions 服务它们；
 * 专用 ASR 模型（whisper 变体、SenseVoice、Paraformer、Speaches/LocalAI 上的
 * 任意本地名）是**开集**，必须留在 /audio/transcriptions 默认路径——方向不能反。
 */
export function usesChatBasedAsr(model: string): boolean {
  const id = model.toLowerCase();
  if (id.includes("omni")) return true;                  // qwen*-omni、*-omni-*
  if (!id.includes("audio")) return false;               // whisper、sensevoice、paraformer…
  return id.includes("gpt") || id.includes("qwen");      // gpt*audio*、qwen*audio*
}

/** Chat 路径的系统提示词：强迫模型像专用 ASR 引擎一样只输出逐字转写。 */
const CHAT_ASR_SYSTEM_PROMPT = "你是语音转写引擎。逐字转写用户音频，只输出转写文本本身——不要注释、不要 Markdown、不要思考过程、不要任何额外说明。";

interface ChatTranscriptionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: string } | string;
}

export class OpenAiHttpAsrProvider implements AsrProvider {
  readonly id = "openai";
  readonly label = "第三方云端语音识别";
  private readonly options: OpenAiAsrOptions;

  constructor(options: OpenAiAsrOptions) {
    this.options = options;
  }

  private config(): { settings: OpenAiAsrSettings; apiKey: string } | null {
    const settings = this.options.getSettings();
    if (!settings || !settings.baseUrl?.trim() || !settings.model?.trim() || !settings.apiKeyEnv?.trim()) return null;
    const apiKey = (this.options.getApiKey(settings.apiKeyEnv) || "").trim();
    if (!apiKey) return null;
    return { settings, apiKey };
  }

  private displayName(): string {
    return this.options.getSettings()?.name?.trim() || this.label;
  }

  isConfigured(): boolean {
    return this.config() !== null;
  }

  private async transcribe(request: { baseUrl: string; apiKey: string; model: string; language?: string; prompt?: string }, samples: Float32Array, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
    if (usesChatBasedAsr(request.model)) return this.transcribeViaChat(request, samples, timeoutMs);
    const fetchImpl = this.options.fetchImpl || fetch;
    const form = new FormData();
    const wav = encodeWav(samples);
    // Copy into a plain ArrayBuffer-backed Blob part: TS 5.7 rejects the
    // `ArrayBufferLike` union in Blob constructors.
    form.append("file", new Blob([wav.slice().buffer as ArrayBuffer], { type: "audio/wav" }), "speech.wav");
    form.append("model", request.model);
    if (request.language) form.append("language", request.language);
    // Whisper prompt 热词（学习自 OpenMinis）：专有名词偏置，提高命中率。
    if (request.prompt) form.append("prompt", request.prompt);
    form.append("response_format", "json");
    const url = `${request.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${request.apiKey}` },
        body: form,
        signal: controller.signal
      });
      const body = await response.text();
      if (!response.ok) return { ok: false, message: statusMessage(response.status, body) };
      let payload: TranscriptionResponse;
      try { payload = JSON.parse(body) as TranscriptionResponse; }
      catch { return { ok: false, message: "服务返回了无法解析的内容（确认接口为 OpenAI 兼容的 /audio/transcriptions）" }; }
      if (payload.error) return { ok: false, message: typeof payload.error === "string" ? payload.error : payload.error.message || "第三方语音识别返回错误" };
      return { ok: true, text: (payload.text || "").trim() };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { ok: false, message: `连接超时（${timeoutMs / 1000}s）：无法访问 ${request.baseUrl}` };
      return { ok: false, message: `无法连接 ${request.baseUrl}：${error instanceof Error ? error.message : String(error)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Chat-based ASR（学习自 OpenMinis transcribeChatBased）：音频多模态 chat
   * 模型走 `POST {base}/chat/completions`，音频作为 `input_audio` 内容分片
   * （raw base64，OpenAI 规范格式），系统提示词强迫逐字转写；语言提示与
   * 热词提示拼进系统提示词（chat 接口没有 prompt 字段）。
   */
  private async transcribeViaChat(request: { baseUrl: string; apiKey: string; model: string; language?: string; prompt?: string }, samples: Float32Array, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
    const fetchImpl = this.options.fetchImpl || fetch;
    const wav = encodeWav(samples);
    const audioBase64 = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength).toString("base64");
    let system = CHAT_ASR_SYSTEM_PROMPT;
    if (request.language) system += `\n音频语言：${request.language}。`;
    if (request.prompt) system += `\n转写时优先采用这些专有名词/热词：${request.prompt}`;
    const body = JSON.stringify({
      model: request.model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "input_audio", input_audio: { data: audioBase64, format: "wav" } }] }
      ]
    });
    const url = `${request.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) return { ok: false, message: statusMessage(response.status, text) };
      let payload: ChatTranscriptionResponse;
      try { payload = JSON.parse(text) as ChatTranscriptionResponse; }
      catch { return { ok: false, message: "服务返回了无法解析的内容（确认该模型支持音频输入的 chat/completions）" }; }
      if (payload.error) return { ok: false, message: typeof payload.error === "string" ? payload.error : payload.error.message || "第三方语音识别返回错误" };
      const content = payload.choices?.[0]?.message?.content;
      // message.content 可能是字符串，也可能是多模态分片数组（qwen-omni 实测）。
      const transcript = typeof content === "string"
        ? content
        : Array.isArray(content) ? content.filter((part) => part && typeof part === "object" && (part as { type?: string }).type === "text").map((part) => String((part as { text?: string }).text ?? "")).join("") : "";
      return { ok: true, text: transcript.trim() };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { ok: false, message: `连接超时（${timeoutMs / 1000}s）：无法访问 ${request.baseUrl}` };
      return { ok: false, message: `无法连接 ${request.baseUrl}：${error instanceof Error ? error.message : String(error)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  async test(): Promise<AsrTestResult> {
    const config = this.config();
    if (!config) {
      const settings = this.options.getSettings();
      if (!settings?.baseUrl || !settings.model || !settings.apiKeyEnv) return { ok: false, message: "请先填写 Base URL、模型名称和 API Key 环境变量名" };
      return { ok: false, message: `环境变量 ${settings.apiKeyEnv} 中没有 API Key（保存设置后填写密钥再测试）` };
    }
    // A 250ms near-silent probe is enough to validate auth, endpoint and model.
    const silence = new Float32Array(Math.round(ASR_SAMPLE_RATE * 0.25));
    const result = await this.transcribe({ baseUrl: config.settings.baseUrl, apiKey: config.apiKey, model: config.settings.model, language: config.settings.language, prompt: config.settings.prompt }, silence, CONNECT_TIMEOUT_MS);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: `${this.displayName()} 连接成功${result.text ? `（识别：${result.text.slice(0, 40)}）` : ""}` };
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const config = this.config();
    if (!config) {
      const settings = this.options.getSettings();
      if (!settings || !settings.baseUrl?.trim() || !settings.model?.trim() || !settings.apiKeyEnv?.trim()) throw new Error("第三方语音识别未配置：请在设置中填写 Base URL、模型和 API Key");
      throw new Error(`环境变量 ${settings.apiKeyEnv} 缺少 API Key，无法使用第三方语音识别`);
    }
    // Snapshot the request template: the settings object may be replaced by a
    // concurrent save while this utterance is running.
    const request = { baseUrl: config.settings.baseUrl, apiKey: config.apiKey, model: config.settings.model, language: config.settings.language, prompt: config.settings.prompt };
    const provider = this;
    let buffer: Float32Array[] = [];
    let bufferedMs = 0;
    let inFlight = false;
    let cancelled = false;
    let stopped = false;
    const flushTimer = setInterval(() => { void maybeFlush(false); }, PARTIAL_FLUSH_MS);

    async function maybeFlush(final: boolean): Promise<void> {
      if (cancelled || inFlight) return;
      if (!final && (stopped || bufferedMs < MIN_CHUNK_MS)) return;
      const samples = mergeSamples(buffer);
      buffer = [];
      bufferedMs = 0;
      if (!samples.length) return;
      inFlight = true;
      const result = await provider.transcribe(request, samples, CONNECT_TIMEOUT_MS);
      inFlight = false;
      if (cancelled) return;
      if (!result.ok) {
        provider.options.log?.(`[asr:openai] ${result.message}`);
        sink({ type: "error", message: result.message });
        return;
      }
      if (result.text) sink({ type: final ? "final" : "partial", text: result.text, provider: "openai" });
      else if (final) sink({ type: "final", text: "", provider: "openai" });
    }

    return {
      providerId: this.id,
      push: (samples: Float32Array): void => {
        if (cancelled || stopped) return;
        buffer.push(samples);
        bufferedMs += (samples.length / ASR_SAMPLE_RATE) * 1_000;
      },
      stop: async (): Promise<void> => {
        if (stopped || cancelled) return;
        stopped = true;
        clearInterval(flushTimer);
        try {
          // Wait for an in-flight partial flush so the final request is ordered.
          const deadline = Date.now() + CONNECT_TIMEOUT_MS;
          while (inFlight && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
          await maybeFlush(true);
        } finally {
          clearInterval(flushTimer);
          sink({ type: "stopped" });
        }
      },
      cancel: (): void => {
        cancelled = true;
        clearInterval(flushTimer);
        buffer = [];
        bufferedMs = 0;
      }
    };
  }
}
