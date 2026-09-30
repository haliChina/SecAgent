/**
 * Local ASR upgrade pack — SenseVoice (offline, sherpa-onnx).
 *
 * The bundled streaming zipformer is tiny and fast, but its accuracy drops in
 * noisy classrooms. SenseVoice-small is the optional "本地增强包": a larger
 * offline model (中/英/日/韩/粤) that recognises the whole utterance after the
 * user stops talking. It is NOT bundled — `scripts/fetch-sensevoice-pack.mjs`
 * downloads it (~230 MB int8) into `models/sense-voice/`.
 *
 * sherpa-onnx Node API (official examples):
 *   const recognizer = new sherpa.OnlineRecognizer… — offline variant:
 *   recognizer = new sherpa.OfflineRecognizer({ modelConfig: { senseVoice:
 *     { model, useInverseTextNormalization }, tokens, numThreads, provider } })
 *   stream = recognizer.createStream(); stream.acceptWaveform(16000, samples);
 *   recognizer.decode(stream); recognizer.getResult(stream).text
 */
import fs from "node:fs";
import path from "node:path";
import type { AsrEventSink, AsrProvider, AsrSession, AsrTestResult } from "./types.js";
import { loadSherpaOnnx } from "./sherpa-loader.js";
import { mergeSamples } from "./wav.js";

const PACK_DIR = "sense-voice";
const MODEL_FILES = ["model.int8.onnx", "tokens.txt"] as const;

export interface LocalSenseVoiceOptions {
  /** Extra directories that may contain `models/sense-voice`. */
  extraRoots?: string[];
  language?: string; // "" (auto) | zh | en | ja | ko | yue
  numThreads?: number;
  /** Partial decode cadence in ms; 0 disables interim results. Default 3500. */
  partialIntervalMs?: number;
  log?(message: string): void;
}

function electronResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

/** Directories that may hold the optional SenseVoice pack. */
function candidateRoots(options: LocalSenseVoiceOptions): string[] {
  const resourcesPath = electronResourcesPath();
  return [
    ...(process.env.SECAGENT_ASR_MODELS_ROOT ? [process.env.SECAGENT_ASR_MODELS_ROOT] : []),
    ...(resourcesPath ? [resourcesPath] : []),
    ...(options.extraRoots || []),
    process.cwd()
  ];
}

export function resolveSenseVoicePack(options: LocalSenseVoiceOptions = {}): string | undefined {
  for (const root of candidateRoots(options)) {
    const dir = path.join(root, "models", PACK_DIR);
    if (MODEL_FILES.every((file) => fs.existsSync(path.join(dir, file)))) return dir;
  }
  return undefined;
}

interface SenseVoiceRecognizerLike {
  createStream(): { acceptWaveform(sampleRate: number, samples: Float32Array): void };
  decode(stream: unknown): void;
  getResult(stream: unknown): { text: string };
}

export class LocalSenseVoiceProvider implements AsrProvider {
  readonly id = "local-pro";
  readonly label = "本地增强（SenseVoice 附加包）";
  private readonly options: LocalSenseVoiceOptions;

  constructor(options: LocalSenseVoiceOptions = {}) { this.options = options; }

  isConfigured(): boolean { return Boolean(resolveSenseVoicePack(this.options)); }

  displayName(): string { return this.options.language ? `${this.label} · ${this.options.language}` : this.label; }

  async test(): Promise<AsrTestResult> {
    const dir = resolveSenseVoicePack(this.options);
    if (!dir) return { ok: false, message: "未安装附加包：在设备上运行 scripts/fetch-sensevoice-pack.mjs 下载（约 230 MB，含 model.int8.onnx 与 tokens.txt）" };
    return { ok: true, message: `SenseVoice 附加包已就绪（${dir}；整句离线识别，嘈杂环境准确率显著高于默认小模型）` };
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const dir = resolveSenseVoicePack(this.options);
    if (!dir) throw new Error("SenseVoice 附加包未安装：请先运行 scripts/fetch-sensevoice-pack.mjs");
    const sherpa = await loadSherpaOnnx();
    // sherpa-onnx 的类型声明未覆盖 OfflineRecognizer（SenseVoice），运行时存在。
    const OfflineRecognizer = (sherpa as unknown as { OfflineRecognizer: new (config: unknown) => unknown }).OfflineRecognizer;
    const recognizer = new OfflineRecognizer({
      modelConfig: {
        senseVoice: { model: path.join(dir, "model.int8.onnx"), useInverseTextNormalization: 1 },
        tokens: path.join(dir, "tokens.txt"),
        numThreads: this.options.numThreads ?? 2,
        debug: 0,
        provider: "cpu"
      }
    }) as unknown as SenseVoiceRecognizerLike;
    this.options.log?.("[asr:local-pro] sensevoice ready");
    sink({ type: "ready", provider: "local-pro" });
    return new SenseVoiceSession(recognizer, sink, this.options);
  }
}

class SenseVoiceSession implements AsrSession {
  readonly providerId = "local-pro";
  private readonly recognizer: SenseVoiceRecognizerLike;
  private readonly sink: AsrEventSink;
  private readonly options: LocalSenseVoiceOptions;
  private readonly buffers: Float32Array[] = [];
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(recognizer: SenseVoiceRecognizerLike, sink: AsrEventSink, options: LocalSenseVoiceOptions) {
    this.recognizer = recognizer;
    this.sink = sink;
    this.options = options;
    const interval = options.partialIntervalMs ?? 3500;
    if (interval > 0) this.timer = setInterval(() => this.decode(false), interval);
  }

  push(samples: Float32Array): void { if (!this.stopped) this.buffers.push(samples); }

  private decode(final: boolean): void {
    const merged = mergeSamples(this.buffers);
    if (!merged.length) return;
    if (!final && merged.length < 16000) return; // wait for ≥1s of audio for interim decodes
    try {
      const stream = this.recognizer.createStream();
      stream.acceptWaveform(16000, merged);
      this.recognizer.decode(stream);
      const text = (this.recognizer.getResult(stream).text || "").trim();
      if (text) this.sink({ type: final ? "final" : "partial", text, provider: "local-pro" });
    } catch (error) {
      this.sink({ type: "log", message: `[asr:local-pro] decode 失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.decode(true);
  }

  cancel(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
