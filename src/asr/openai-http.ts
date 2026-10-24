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

function statusMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return "API Key 无效或无权限（检查密钥是否正确、是否有语音模型权限）";
  if (status === 404) return "接口不存在：请检查 Base URL 是否为 OpenAI 兼容地址（一般以 /v1 结尾）";
  if (status === 422 || status === 400) return `请求被拒绝（${status}）：${body.slice(0, 200) || "请检查模型名称"} `;
  if (status === 429) return "请求过于频繁（429 限流），请稍后重试";
  if (status >= 500) return `服务端错误（${status}）`;
  return `请求失败（${status}）：${body.slice(0, 200)}`;
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

  private async transcribe(request: { baseUrl: string; apiKey: string; model: string; language?: string }, samples: Float32Array, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
    const fetchImpl = this.options.fetchImpl || fetch;
    const form = new FormData();
    const wav = encodeWav(samples);
    // Copy into a plain ArrayBuffer-backed Blob part: TS 5.7 rejects the
    // `ArrayBufferLike` union in Blob constructors.
    form.append("file", new Blob([wav.slice().buffer as ArrayBuffer], { type: "audio/wav" }), "speech.wav");
    form.append("model", request.model);
    if (request.language) form.append("language", request.language);
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

  async test(): Promise<AsrTestResult> {
    const config = this.config();
    if (!config) {
      const settings = this.options.getSettings();
      if (!settings?.baseUrl || !settings.model || !settings.apiKeyEnv) return { ok: false, message: "请先填写 Base URL、模型名称和 API Key 环境变量名" };
      return { ok: false, message: `环境变量 ${settings.apiKeyEnv} 中没有 API Key（保存设置后填写密钥再测试）` };
    }
    // A 250ms near-silent probe is enough to validate auth, endpoint and model.
    const silence = new Float32Array(Math.round(ASR_SAMPLE_RATE * 0.25));
    const result = await this.transcribe({ baseUrl: config.settings.baseUrl, apiKey: config.apiKey, model: config.settings.model, language: config.settings.language }, silence, CONNECT_TIMEOUT_MS);
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
    const request = { baseUrl: config.settings.baseUrl, apiKey: config.apiKey, model: config.settings.model, language: config.settings.language };
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
