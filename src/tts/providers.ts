/**
 * TTS provider implementations — every protocol verified against official docs:
 *
 *  - edge:   Microsoft Edge Read Aloud (free online, via @andresaya/edge-tts).
 *  - windows: Windows 系统朗读 — System.Speech SpeechSynthesizer via PowerShell
 *            (offline, ships with Windows).
 *  - mimo:   小米 MiMo TTS — OpenAI-compatible chat/completions with `audio`.
 *            Docs: https://mimo.mi.com/docs/zh-CN/api/audio/tts
 *            POST https://api.xiaomimimo.com/v1/chat/completions
 *            { model: "mimo-v2.5-tts", messages: [{role:"user",content:语气描述},
 *             {role:"assistant",content:正文}], audio: { format, voice } }
 *            Response: choices[0].message.audio.data (base64).
 *  - bailian: 阿里云百炼 CosyVoice realtime WebSocket.
 *            Docs: https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 *            wss + Bearer → run-task(task:"tts", function:"SpeechSynthesizer",
 *            parameters:{text_type:"PlainText", voice, format, sample_rate})
 *            → task-started → continue-task{text} → finish-task → binary audio
 *            until task-finished. Text ≤ 20000 chars per call, gap < 23 s.
 */
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { EdgeTTS } from "@andresaya/edge-tts";
import type { BailianTtsSettings, MimoTtsSettings, TtsAudioChunk, TtsProvider, TtsSynthesisOptions, TtsTestResult } from "./types.js";

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** "+"→1.0 multiplier, "-"→slower; SAPI Rate is -10..10. */
export function percentRateToSapi(rate: string | undefined): number {
  const parsed = Number((rate || "+0%").replace(/[+%\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-10, Math.min(10, Math.round(parsed / 10)));
}

/* ------------------------------------------------------------------ edge -- */

export class EdgeTtsProvider implements TtsProvider {
  readonly id = "edge" as const;
  readonly label = "Edge TTS（免费在线）";

  isConfigured(): boolean { return true; }
  displayName(): string { return "Edge TTS"; }

  async test(): Promise<TtsTestResult> {
    try {
      const chunk = await this.synthesize("测试");
      return { ok: chunk.data.length > 0, message: chunk.data.length ? "合成正常" : "返回空音频" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async synthesize(text: string, options: TtsSynthesisOptions = {}): Promise<TtsAudioChunk> {
    const clean = cleanText(text);
    if (!clean) return { data: Buffer.alloc(0) };
    let lastError: unknown;
    // Edge TTS occasionally resets the TLS socket before the WebSocket
    // handshake completes; a fresh client per attempt makes it transparent.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const client = new EdgeTTS();
        const audio = await client.synthesize(escapeXml(clean), options.voice || "zh-CN-XiaoxiaoNeural", { rate: options.rate || "+0%" });
        const bytes = Buffer.isBuffer(audio) ? audio : Buffer.from(audio as unknown as ArrayBuffer);
        if (bytes.length) return { data: bytes };
        throw new Error("Edge TTS 返回空音频");
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Edge TTS 合成失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

/* --------------------------------------------------------------- windows -- */

export class WindowsSapiTtsProvider implements TtsProvider {
  readonly id = "windows" as const;
  readonly label = "Windows 系统朗读（SAPI，离线）";

  isConfigured(): boolean { return process.platform === "win32"; }
  displayName(): string { return "Windows 系统朗读"; }

  async test(): Promise<TtsTestResult> {
    if (process.platform !== "win32") return { ok: false, message: "仅在 Windows 上可用" };
    try {
      const chunk = await this.synthesize("测试");
      return { ok: chunk.data.length > 0, message: chunk.data.length ? "合成正常" : "返回空音频" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async synthesize(text: string, options: TtsSynthesisOptions = {}): Promise<TtsAudioChunk> {
    const clean = cleanText(text);
    if (!clean) return { data: Buffer.alloc(0) };
    if (process.platform !== "win32") throw new Error("Windows 系统朗读仅在 Windows 上可用");
    const dir = await mkdtemp(join(tmpdir(), "secagent-sapi-"));
    const textFile = join(dir, "text.txt");
    const outFile = join(dir, "out.wav");
    await writeFile(textFile, clean, "utf16le");
    const voice = (options.voice || "").trim();
    const rate = percentRateToSapi(options.rate);
    const voiceLine = voice ? `$s.SelectVoice(${JSON.stringify(voice)}); ` : "";
    const script = [
      "Add-Type -AssemblyName System.Speech;",
      "$ErrorActionPreference='Stop';",
      "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
      voiceLine,
      `$s.Rate = ${rate};`,
      `$s.SetOutputToWaveFile(${JSON.stringify(outFile)});`,
      `$s.Speak([System.IO.File]::ReadAllText(${JSON.stringify(textFile)}));`,
      "$s.Dispose();"
    ].join(" ");
    try {
      await new Promise<void>((resolve, reject) => {
        execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { timeout: 60000 }, (error) => {
          if (error) reject(new Error(`Windows 朗读失败：${error.message}`));
          else resolve();
        });
      });
      const data = await readFile(outFile);
      if (!data.length) throw new Error("Windows 朗读返回空音频");
      return { data };
    } finally {
      void rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** List installed SAPI voices: `Name | Culture` lines (Windows only). */
export async function listWindowsVoices(): Promise<Array<{ id: string; label: string }>> {
  if (process.platform !== "win32") return [];
  const script = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { \"$($_.VoiceInfo.Name)|$($_.VoiceInfo.Culture)\" }";
  return await new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { timeout: 15000 }, (error, stdout) => {
      if (error) return resolve([]);
      const voices = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        const [name, culture] = line.split("|");
        return { id: name, label: culture ? `${name}（${culture}）` : name };
      });
      resolve(voices);
    });
  });
}

/* ------------------------------------------------------------------ mimo -- */

export interface MimoTtsProviderOptions {
  getSettings(): MimoTtsSettings | undefined;
  getApiKey(name: string): string | undefined;
  log?(message: string): void;
  fetchImpl?: typeof fetch;
}

export interface ResolvedMimoTtsConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
  format: string;
  voiceDescription: string;
}

export const MIMO_TTS_DEFAULTS = {
  apiKeyEnv: "MIMO_API_KEY",
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.5-tts",
  voice: "mimo_default",
  format: "mp3",
  voiceDescription: "默认"
} as const;

export function resolveMimoTtsConfig(settings: MimoTtsSettings | undefined, getApiKey: (name: string) => string | undefined): ResolvedMimoTtsConfig | null {
  const apiKey = (settings?.apiKeyEnv?.trim() && getApiKey(settings.apiKeyEnv.trim())) || process.env.MIMO_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (settings?.baseUrl?.trim() || process.env.MIMO_TTS_BASE_URL || MIMO_TTS_DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: settings?.model?.trim() || process.env.MIMO_TTS_MODEL || MIMO_TTS_DEFAULTS.model,
    voice: settings?.voice?.trim() || MIMO_TTS_DEFAULTS.voice,
    format: settings?.format?.trim() || MIMO_TTS_DEFAULTS.format,
    voiceDescription: settings?.voiceDescription?.trim() || MIMO_TTS_DEFAULTS.voiceDescription
  };
}

export class MimoTtsProvider implements TtsProvider {
  readonly id = "mimo" as const;
  readonly label = "小米 MiMo TTS（云端）";
  private readonly options: MimoTtsProviderOptions;

  constructor(options: MimoTtsProviderOptions) { this.options = options; }

  isConfigured(): boolean { return resolveMimoTtsConfig(this.options.getSettings(), this.options.getApiKey) !== null; }
  displayName(): string { return "小米 MiMo TTS"; }

  async test(): Promise<TtsTestResult> {
    if (!this.isConfigured()) return { ok: false, message: "未配置 API Key / Base URL" };
    try {
      const chunk = await this.synthesize("测试");
      return { ok: chunk.data.length > 0, message: chunk.data.length ? "合成正常" : "返回空音频" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async synthesize(text: string, options: TtsSynthesisOptions = {}): Promise<TtsAudioChunk> {
    const clean = cleanText(text);
    if (!clean) return { data: Buffer.alloc(0) };
    const config = resolveMimoTtsConfig(this.options.getSettings(), this.options.getApiKey);
    if (!config) throw new Error("MiMo TTS 未配置：请在工作区 .env 设置 MIMO_API_KEY");
    const fetchImpl = this.options.fetchImpl || fetch;
    // Docs: user message = 语气描述（voicedesign 必填，其余可选），
    // assistant message = 待合成正文；audio = { format, voice }。
    const body = {
      model: config.model,
      messages: [
        { role: "user", content: options.voice || config.voiceDescription || "默认" },
        { role: "assistant", content: clean }
      ],
      audio: { format: config.format, voice: options.voice || config.voice }
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": config.apiKey, Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`MiMo TTS HTTP ${response.status}${detail ? `：${detail.slice(0, 300)}` : ""}`);
      }
      const json = (await response.json()) as { choices?: Array<{ message?: { audio?: { data?: string }; content?: string } }>; error?: { message?: string } };
      if (json.error?.message) throw new Error(`MiMo TTS：${json.error.message}`);
      const data = json.choices?.[0]?.message?.audio?.data;
      if (!data) throw new Error("MiMo TTS 响应缺少 audio.data");
      return { data: Buffer.from(data, "base64") };
    } finally {
      clearTimeout(timer);
    }
  }
}

/* --------------------------------------------------------------- bailian -- */

export interface BailianTtsProviderOptions {
  getSettings(): BailianTtsSettings | undefined;
  getApiKey(name: string): string | undefined;
  log?(message: string): void;
  WebSocketCtor?: BailianTtsWsConstructor;
}

/** `ws` package constructor shape (headers in handshake). */
export type BailianTtsWsConstructor = new (url: string, options?: { headers?: Record<string, string> }) => { send(data: unknown): void; close(): void; binaryType: string; onopen: (() => void) | null; onmessage: ((event: { data: unknown }) => void) | null; onerror: ((event: unknown) => void) | null; onclose: (() => void) | null; readyState: number };

export const BAILIAN_TTS_DEFAULTS = {
  apiKeyEnv: "BAILIAN_API_KEY",
  wsUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
  model: "cosyvoice-v3-flash",
  voice: "longanyang",
  format: "mp3",
  sampleRate: 22050
} as const;

interface ResolvedBailianTtsConfig {
  apiKey: string;
  wsUrl: string;
  model: string;
  voice: string;
  format: string;
  sampleRate: number;
}

function resolveBailianTtsConfig(settings: BailianTtsSettings | undefined, getApiKey: (name: string) => string | undefined): ResolvedBailianTtsConfig | null {
  const apiKey = (settings?.apiKeyEnv?.trim() && getApiKey(settings.apiKeyEnv.trim())) || process.env.BAILIAN_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    wsUrl: (settings?.baseUrl?.trim() || process.env.BAILIAN_WS_URL || BAILIAN_TTS_DEFAULTS.wsUrl).replace(/\/+$/, ""),
    model: settings?.model?.trim() || BAILIAN_TTS_DEFAULTS.model,
    voice: settings?.voice?.trim() || BAILIAN_TTS_DEFAULTS.voice,
    format: settings?.format?.trim() || BAILIAN_TTS_DEFAULTS.format,
    sampleRate: BAILIAN_TTS_DEFAULTS.sampleRate
  };
}

/** Split long text into chunks under the documented 20000-char limit. */
function splitForCosyvoice(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const char of text) {
    current += char;
    if (current.length >= 15000) {
      chunks.push(current);
      current = "";
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.length ? chunks : [""];
}

export class BailianTtsProvider implements TtsProvider {
  readonly id = "bailian" as const;
  readonly label = "阿里云百炼 CosyVoice（云端）";
  private readonly options: BailianTtsProviderOptions;

  constructor(options: BailianTtsProviderOptions) { this.options = options; }

  isConfigured(): boolean { return resolveBailianTtsConfig(this.options.getSettings(), this.options.getApiKey) !== null; }
  displayName(): string { return "阿里云百炼 CosyVoice"; }

  async test(): Promise<TtsTestResult> {
    if (!this.isConfigured()) return { ok: false, message: "未配置 API Key / Base URL" };
    try {
      const chunk = await this.synthesize("测试");
      return { ok: chunk.data.length > 0, message: chunk.data.length ? "合成正常" : "返回空音频" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async synthesize(text: string, options: TtsSynthesisOptions = {}): Promise<TtsAudioChunk> {
    const clean = cleanText(text);
    if (!clean) return { data: Buffer.alloc(0) };
    const config = resolveBailianTtsConfig(this.options.getSettings(), this.options.getApiKey);
    if (!config) throw new Error("百炼 CosyVoice 未配置：请在工作区 .env 设置 BAILIAN_API_KEY");
    const voice = options.voice || config.voice;
    const chunks = splitForCosyvoice(clean);
    const parts: Buffer[] = [];
    for (const chunk of chunks) parts.push(await this.runTask(config, chunk, voice));
    return { data: Buffer.concat(parts) };
  }

  /** One WebSocket task = run-task → continue-task(text) → finish-task. */
  private async runTask(config: ResolvedBailianTtsConfig, text: string, voice: string): Promise<Buffer> {
    const Ctor = this.options.WebSocketCtor;
    if (!Ctor) throw new Error("当前环境不支持 WebSocket（缺少 ws 依赖）");
    const taskId = randomUUID();
    return await new Promise<Buffer>((resolve, reject) => {
      let settled = false;
      const audio: Buffer[] = [];
      let socket: InstanceType<BailianTtsWsConstructor>;
      try {
        socket = new Ctor(config.wsUrl, { headers: { Authorization: `Bearer ${config.apiKey}`, "user-agent": "SecAgent" } });
      } catch (error) {
        reject(new Error(`CosyVoice 连接创建失败：${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      socket.binaryType = "arraybuffer";
      const finish = (error: Error | null, data?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch { /* already closed */ }
        if (error) reject(error);
        else resolve(Buffer.concat(audio));
      };
      const timer = setTimeout(() => finish(new Error("CosyVoice 合成超时（60s）")), 60000);
      socket.onopen = () => {
        socket.send(JSON.stringify({
          header: { action: "run-task", task_id: taskId, streaming: "duplex" },
          payload: {
            task_group: "audio",
            task: "tts",
            function: "SpeechSynthesizer",
            model: config.model,
            parameters: { text_type: "PlainText", voice, format: config.format, sample_rate: config.sampleRate, volume: 50, rate: 1.0, pitch: 1.0 },
            input: {}
          }
        }));
      };
      socket.onmessage = (event: { data: unknown }) => {
        if (typeof event.data !== "string") {
          // Binary frame = synthesized audio chunk.
          const raw = event.data instanceof ArrayBuffer ? Buffer.from(event.data) : Buffer.from(event.data as ArrayBuffer);
          if (raw.length) audio.push(raw);
          return;
        }
        let message: { header?: { event?: string; error_code?: string; error_message?: string } };
        try { message = JSON.parse(event.data); } catch { return; }
        const header = message.header || {};
        if (header.event === "task-started") {
          socket.send(JSON.stringify({
            header: { action: "continue-task", task_id: taskId, streaming: "duplex" },
            payload: { input: { text } }
          }));
          socket.send(JSON.stringify({
            header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
            payload: { input: {} }
          }));
        } else if (header.event === "task-finished") {
          finish(null);
        } else if (header.event === "task-failed") {
          finish(new Error(`CosyVoice 任务失败：${header.error_code || ""} ${header.error_message || ""}`.trim()));
        }
      };
      socket.onerror = () => finish(new Error("CosyVoice WebSocket 连接失败（请检查 API Key 与网络）"));
      socket.onclose = () => finish(audio.length ? null : new Error("CosyVoice 连接被服务端关闭"));
    });
  }
}
