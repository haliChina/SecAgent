/**
 * 阿里云百炼 ASR — channel A (non-streaming whole-utterance recognition).
 *
 * 百炼 does not implement OpenAI's `/audio/transcriptions` (it answers 404);
 * its ASR runs on the OpenAI-compatible `chat/completions` endpoint with an
 * `input_audio` payload carrying a `data:audio/wav;base64,…` Data URL.
 * Requests are intentionally non-streaming (`stream: false`); plain HTTP
 * cannot stream, so the session flushes buffered audio as `partial` text
 * roughly every three seconds and as the `final` result on stop.
 *
 * Docs: https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference
 */
import type { AsrEventSink, AsrProvider, AsrSession, AsrTestResult } from "./types.js";
import { encodeWav, mergeSamples, ASR_SAMPLE_RATE } from "./wav.js";
import type { BailianAsrSettings } from "./settings.js";
import { bailianDisplayName, resolveBailianConfig } from "./bailian-config.js";

const PARTIAL_FLUSH_MS = 3_000;
const MIN_CHUNK_MS = 900;
const CONNECT_TIMEOUT_MS = 12_000;
/** Documented cap: the Base64 Data URL must stay within 10MB. */
const MAX_DATA_URL_LENGTH = 10 * 1024 * 1024;
/** Exponential backoff for 429 responses: 3 retries after the first attempt. */
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 500;

interface BailianHttpAsrOptions {
  /** Current 百炼 settings (re-read on each start). */
  getSettings: () => BailianAsrSettings | undefined;
  /** Resolves the API key for an env var name (usually process.env). */
  getApiKey: (envName: string) => string | undefined;
  fetchImpl?: typeof fetch;
  /** Base delay for the 429 exponential backoff (tests shorten this). */
  rateLimitBaseDelayMs?: number;
  log?: (message: string) => void;
}

interface BailianRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  language?: string;
  enableItn: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  error?: { message?: string } | string;
}

function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/**
 * Encode PCM as a WAV Data URL, trimming the oldest audio when the Base64
 * payload would exceed the documented 10MB input limit.
 */
function toWavDataUrl(samples: Float32Array, log?: (message: string) => void): string {
  let wav = encodeWav(samples);
  if (base64Length(wav.length) > MAX_DATA_URL_LENGTH) {
    const maxWavBytes = Math.floor(MAX_DATA_URL_LENGTH / 4) * 3;
    const maxSamples = Math.max(0, Math.floor((maxWavBytes - 44) / 2));
    wav = encodeWav(samples.subarray(samples.length - maxSamples));
    log?.(`[asr:bailian] 音频超过 Base64 10MB 上限，已截断至 ${(maxSamples / ASR_SAMPLE_RATE).toFixed(1)}s`);
  }
  return `data:audio/wav;base64,${Buffer.from(wav).toString("base64")}`;
}

function statusMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return "API Key 无效或额度已耗尽（百炼“用完即停”）：请检查密钥与免费额度，或在设置中切换识别服务";
  if (status === 404) return "接口不存在（404）：请检查 Base URL 是否包含 /compatible-mode/v1";
  if (status === 400) return `请求被拒绝（400）：音频超过 10MB 或格式不支持${body.slice(0, 160) ? `：${body.slice(0, 160)}` : ""}`;
  if (status === 429) return "请求过于频繁（429 限流），已退避重试仍失败，请稍后重试";
  if (status >= 500) return `百炼服务端错误（${status}）：${body.slice(0, 160)}`;
  return `请求失败（${status}）：${body.slice(0, 200)}`;
}

/** `choices[0].message.content` is the transcript (string, or text parts). */
function extractText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("").trim();
  return "";
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class BailianHttpAsrProvider implements AsrProvider {
  readonly id = "bailian";
  readonly label = "阿里云百炼（chat/completions）";
  private readonly options: BailianHttpAsrOptions;

  constructor(options: BailianHttpAsrOptions) {
    this.options = options;
  }

  private displayName(): string {
    return bailianDisplayName(this.options.getSettings(), this.label);
  }

  isConfigured(): boolean {
    return resolveBailianConfig(this.options.getSettings(), this.options.getApiKey) !== null;
  }

  private async postOnce(request: BailianRequest, body: string, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; message: string; rateLimited?: boolean }> {
    const fetchImpl = this.options.fetchImpl || fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${request.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal
      });
      const raw = await response.text();
      if (!response.ok) return { ok: false, message: statusMessage(response.status, raw), ...(response.status === 429 ? { rateLimited: true } : {}) };
      let payload: ChatCompletionResponse;
      try { payload = JSON.parse(raw) as ChatCompletionResponse; }
      catch { return { ok: false, message: "服务返回了无法解析的内容（确认 Base URL 为百炼 /compatible-mode/v1）" }; }
      if (payload.error) return { ok: false, message: typeof payload.error === "string" ? payload.error : payload.error.message || "百炼语音识别返回错误" };
      return { ok: true, text: extractText(payload) };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return { ok: false, message: `连接超时（${timeoutMs / 1000}s）：无法访问 ${request.baseUrl}` };
      return { ok: false, message: `无法连接 ${request.baseUrl}：${error instanceof Error ? error.message : String(error)}` };
    } finally {
      clearTimeout(timer);
    }
  }

  private async transcribe(request: BailianRequest, samples: Float32Array, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
    const body = JSON.stringify({
      model: request.model,
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: toWavDataUrl(samples, this.options.log) } }] }],
      // 百炼 ASR 非流式场景固定 stream=false；asr_options 是百炼扩展参数，放 body 顶层。
      stream: false,
      asr_options: { ...(request.language ? { language: request.language } : {}), enable_itn: request.enableItn }
    });
    for (let attempt = 0; ; attempt += 1) {
      const result = await this.postOnce(request, body, timeoutMs);
      if (result.ok) return result;
      if (!result.rateLimited || attempt >= RATE_LIMIT_RETRIES) return { ok: false, message: result.message };
      const backoff = (this.options.rateLimitBaseDelayMs ?? RATE_LIMIT_BASE_DELAY_MS) * 2 ** attempt;
      this.options.log?.(`[asr:bailian] 429 限流，${backoff}ms 后重试（第 ${attempt + 1}/${RATE_LIMIT_RETRIES} 次）`);
      await delay(backoff);
    }
  }

  private requestFor(config: { baseUrl: string; apiKey: string; model: string; language?: string; enableItn: boolean }): BailianRequest {
    const request: BailianRequest = { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, enableItn: config.enableItn };
    if (config.language) request.language = config.language;
    return request;
  }

  async test(): Promise<AsrTestResult> {
    const config = resolveBailianConfig(this.options.getSettings(), this.options.getApiKey);
    if (!config) return { ok: false, message: `环境变量 ${this.options.getSettings()?.apiKeyEnv || "BAILIAN_API_KEY"} 中没有 API Key（可在下方填写并保存到工作区 .env）` };
    // A 250ms near-silent probe is enough to validate auth, endpoint and model.
    const silence = new Float32Array(Math.round(ASR_SAMPLE_RATE * 0.25));
    const result = await this.transcribe(this.requestFor(config), silence, CONNECT_TIMEOUT_MS);
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, message: `${this.displayName()} 连接成功${result.text ? `（识别：${result.text.slice(0, 40)}）` : ""}` };
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const config = resolveBailianConfig(this.options.getSettings(), this.options.getApiKey);
    if (!config) {
      const settings = this.options.getSettings();
      const envName = settings?.apiKeyEnv?.trim() || "BAILIAN_API_KEY";
      throw new Error(`阿里云百炼语音识别未配置：请在设置中填写 API Key（保存到工作区 .env 的 ${envName}）`);
    }
    // Snapshot the request template: settings may be replaced by a concurrent save.
    const request = this.requestFor(config);
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
        provider.options.log?.(`[asr:bailian] ${result.message}`);
        sink({ type: "error", message: result.message });
        return;
      }
      if (result.text) sink({ type: final ? "final" : "partial", text: result.text, provider: "bailian" });
      else if (final) sink({ type: "final", text: "", provider: "bailian" });
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