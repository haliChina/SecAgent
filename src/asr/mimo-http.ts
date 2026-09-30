/**
 * MiMo ASR — OpenAI-compatible chat/completions with input_audio.
 *
 * Official docs: https://mimo.mi.com/docs/zh-CN/api/audio/Speech-Recognition
 *   POST https://api.xiaomimimo.com/v1/chat/completions
 *   Auth (one of): `api-key: $MIMO_API_KEY` or `Authorization: Bearer <key>`
 *   Body: { model, messages: [{ role: "user", content: [{ type: "input_audio",
 *          input_audio: { data: "data:audio/wav;base64,…", format: "wav" | "mp3" } }] }],
 *          asr_options: { language: "auto" | "zh" | "en" } }
 *   Audio: mp3 or wav only (we always send WAV); one-shot per request.
 *   Response: choices[0].message.content holds the transcription.
 *
 * The session buffers audio and flushes every ~3s as a partial, mirroring the
 * OpenAI HTTP provider, then sends the whole utterance on stop for the final
 * text — MiMo is not a streaming API.
 */
import type { AsrEventSink, AsrProvider, AsrSession, AsrTestResult } from "./types.js";
import { encodeWav } from "./wav.js";

export interface MimoAsrSettings {
  name?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  model?: string;
  language?: string;
}

export const MIMO_ASR_DEFAULTS = {
  apiKeyEnv: "MIMO_API_KEY",
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: "MiMo-V2.5-ASR",
  language: "auto"
} as const;

export interface MimoAsrProviderOptions {
  getSettings(): MimoAsrSettings | undefined;
  getApiKey(name: string): string | undefined;
  log?(message: string): void;
  fetchImpl?: typeof fetch;
  uuid?(): string;
}

function text(value: string | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : undefined;
}

export interface ResolvedMimoAsrConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;
}

export function resolveMimoAsrConfig(settings: MimoAsrSettings | undefined, getApiKey: (name: string) => string | undefined, env: NodeJS.ProcessEnv = process.env): ResolvedMimoAsrConfig | null {
  const apiKey = (text(settings?.apiKeyEnv) && getApiKey(text(settings!.apiKeyEnv)!)) || text(env.MIMO_API_KEY);
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (text(settings?.baseUrl) || text(env.MIMO_ASR_BASE_URL) || MIMO_ASR_DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: text(settings?.model) || text(env.MIMO_ASR_MODEL) || MIMO_ASR_DEFAULTS.model,
    language: text(settings?.language) || text(env.MIMO_ASR_LANGUAGE) || MIMO_ASR_DEFAULTS.language
  };
}

interface MimoAsrSessionDeps {
  config: ResolvedMimoAsrConfig;
  sink: AsrEventSink;
  fetchImpl: typeof fetch;
  log(message: string): void;
}

export class MimoAsrSession implements AsrSession {
  readonly providerId = "mimo";
  private readonly deps: MimoAsrSessionDeps;
  private buffer: Float32Array = new Float32Array(0);
  private stopped = false;
  private flushing: Promise<void> = Promise.resolve();

  constructor(deps: MimoAsrSessionDeps) { this.deps = deps; }

  push(samples: Float32Array): void {
    if (this.stopped || samples.length === 0) return;
    const merged = new Float32Array(this.buffer.length + samples.length);
    merged.set(this.buffer, 0);
    merged.set(samples, this.buffer.length);
    this.buffer = merged;
    if (this.buffer.length >= 48000) void this.flush("partial");
  }

  private async transcribe(samples: Float32Array, timeoutMs = 30000): Promise<string | null> {
    const { config, fetchImpl } = this.deps;
    const wav = encodeWav(samples);
    const dataUrl = `data:audio/wav;base64,${Buffer.from(wav).toString("base64")}`;
    const body = {
      model: config.model,
      messages: [{
        role: "user",
        content: [{ type: "input_audio", input_audio: { data: dataUrl, format: "wav" } }]
      }],
      asr_options: { language: config.language },
      stream: false
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": config.apiKey, Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`MiMo ASR HTTP ${response.status}${detail ? `：${detail.slice(0, 300)}` : ""}`);
      }
      const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      if (json.error?.message) throw new Error(`MiMo ASR：${json.error.message}`);
      return json.choices?.[0]?.message?.content?.trim() || null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async flush(reason: "partial" | "final"): Promise<void> {
    if (this.buffer.length === 0) return;
    const samples = this.buffer;
    if (reason === "final") this.buffer = new Float32Array(0);
    this.flushing = this.flushing.then(async () => {
      try {
        const transcript = await this.transcribe(samples);
        if (!transcript) return;
        this.deps.sink({ type: reason === "final" ? "final" : "partial", text: transcript, provider: "mimo" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.log(`[asr:mimo] ${message}`);
        if (reason === "final") this.deps.sink({ type: "error", message });
      }
    });
    await this.flushing;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.flush("final");
  }

  cancel(): void {
    this.stopped = true;
    this.buffer = new Float32Array(0);
    this.deps.sink({ type: "stopped" });
  }
}

export class MimoHttpAsrProvider implements AsrProvider {
  readonly id = "mimo";
  readonly label = "小米 MiMo（chat/completions）";
  private readonly options: MimoAsrProviderOptions;

  constructor(options: MimoAsrProviderOptions) { this.options = options; }

  isConfigured(): boolean {
    return resolveMimoAsrConfig(this.options.getSettings(), this.options.getApiKey) !== null;
  }

  displayName(): string {
    return this.options.getSettings()?.name?.trim() || "小米 MiMo";
  }

  async test(): Promise<AsrTestResult> {
    const config = resolveMimoAsrConfig(this.options.getSettings(), this.options.getApiKey);
    if (!config) return { ok: false, message: `环境变量 ${this.options.getSettings()?.apiKeyEnv || "MIMO_API_KEY"} 中没有 API Key（可在下方填写并保存到工作区 .env）` };
    return { ok: true, message: `${this.displayName()} 已配置（${config.baseUrl}/chat/completions，模型 ${config.model}）` };
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const config = resolveMimoAsrConfig(this.options.getSettings(), this.options.getApiKey);
    if (!config) throw new Error("小米 MiMo 语音识别未配置：请在设置中填写 API Key（保存到工作区 .env 的 MIMO_API_KEY）");
    this.options.log?.(`[asr:mimo] ready ${config.baseUrl} model=${config.model} language=${config.language}`);
    sink({ type: "ready", provider: "mimo" });
    return new MimoAsrSession({
      config,
      sink,
      fetchImpl: this.options.fetchImpl || fetch,
      log: (message) => this.options.log?.(message)
    });
  }
}
