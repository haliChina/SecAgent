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
import { LocalAsrWorker } from "./local-asr-worker.js";

const PACK_DIR = "sense-voice";
const MODEL_FILES = ["model.int8.onnx", "tokens.txt"] as const;

interface LocalSenseVoiceOptions {
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

function resolveSenseVoicePack(options: LocalSenseVoiceOptions = {}): string | undefined {
  for (const root of candidateRoots(options)) {
    const dir = path.join(root, "models", PACK_DIR);
    if (MODEL_FILES.every((file) => fs.existsSync(path.join(dir, file)))) return dir;
  }
  return undefined;
}

export class LocalSenseVoiceProvider implements AsrProvider {
  readonly id = "local-pro";
  readonly label = "本地增强（SenseVoice 附加包）";
  private readonly options: LocalSenseVoiceOptions;
  private worker: LocalAsrWorker | undefined;

  constructor(options: LocalSenseVoiceOptions = {}) { this.options = options; }

  isConfigured(): boolean { return Boolean(resolveSenseVoicePack(this.options)); }

  displayName(): string { return this.options.language ? `${this.label} · ${this.options.language}` : this.label; }

  async test(): Promise<AsrTestResult> {
    const dir = resolveSenseVoicePack(this.options);
    if (!dir) return { ok: false, message: "未安装附加包：在设备上运行 scripts/fetch-sensevoice-pack.mjs 下载（约 230 MB，含 model.int8.onnx 与 tokens.txt）" };
    return { ok: true, message: `SenseVoice 附加包已就绪（${dir}；整句离线识别，Worker 解码）` };
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const dir = resolveSenseVoicePack(this.options);
    if (!dir) throw new Error("SenseVoice 附加包未安装：请先运行 scripts/fetch-sensevoice-pack.mjs");
    this.worker ??= new LocalAsrWorker({ mode: "sensevoice", root: dir, numThreads: this.options.numThreads ?? 2, log: this.options.log });
    const worker = this.worker;
    await worker.start(sink);
    return {
      providerId: this.id,
      push: (samples: Float32Array): void => worker.push(samples),
      stop: async (): Promise<void> => { await worker.stop(); },
      cancel: (): void => worker.cancel()
    };
  }
}
