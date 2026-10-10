/**
 * Voice wake ("小泽同学") keyword spotting with the bundled sherpa-onnx KWS model.
 *
 * Loading is lazy and async: a missing or broken engine now surfaces as a
 * rejected promise with a readable message instead of an import-time crash.
 */
import fs from "node:fs";
import path from "node:path";
import { pinyin } from "pinyin-pro";
import { loadSherpaOnnx } from "./sherpa-loader.js";

const KWS_DIR = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20";

type Kws = ReturnType<typeof import("sherpa-onnx")["createKws"]>;
type KwsStream = ReturnType<Kws["createStream"]>;

interface VoiceWakeOptions {
  extraRoots?: string[];
  log?: (message: string) => void;
}

function keywordTokens(phrase: string): string {
  const syllables = pinyin(phrase.replace(/\s+/g, ""), { toneType: "symbol", type: "array" }) as string[];
  const initials = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];
  return syllables.map((syllable) => {
    const initial = initials.find((candidate) => syllable.startsWith(candidate)) || "";
    return `${initial} ${syllable.slice(initial.length)}`;
  }).join(" ");
}

export class VoiceWakeEngine {
  private kws: Kws | undefined;
  private stream: KwsStream | undefined;
  private detected: (() => void) | undefined;
  private startedAt = 0;
  private audioFrames = 0;
  private awaitingFirstAudio = false;
  private lastHeartbeatAt = 0;
  private readonly options: VoiceWakeOptions;

  constructor(options: VoiceWakeOptions = {}) {
    this.options = options;
  }

  get active(): boolean {
    return Boolean(this.kws && this.stream);
  }

  async start(phrase: string, onDetected: () => void): Promise<void> {
    this.detected = onDetected;
    if (this.kws) {
      this.options.log?.(`[voice-wake] local KWS already active phrase=${phrase}`);
      return;
    }
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [
      ...(this.options.extraRoots || []),
      ...(resourcesPath ? [resourcesPath] : []),
      process.cwd()
    ];
    const root = candidates.map((candidate) => path.join(candidate, "models", KWS_DIR)).find((candidate) => fs.existsSync(candidate));
    if (!root) throw new Error(`找不到语音唤醒模型 ${KWS_DIR}，已搜索：${candidates.map((candidate) => path.join(candidate, "models")).join("、")}`);
    const sherpa = await loadSherpaOnnx();
    this.kws = sherpa.createKws({
      featConfig: { samplingRate: 16_000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: path.join(root, "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx"),
          decoder: path.join(root, "decoder-epoch-13-avg-2-chunk-16-left-64.onnx"),
          joiner: path.join(root, "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx")
        },
        tokens: path.join(root, "tokens.txt"),
        provider: "cpu",
        numThreads: 1,
        modelingUnit: "ppinyin"
      },
      maxActivePaths: 4,
      numTrailingBlanks: 1,
      keywordsScore: 1.5,
      keywordsThreshold: 0.55,
      keywords: `${keywordTokens(phrase)} @${phrase}`
    });
    this.stream = this.kws.createStream();
    this.startedAt = Date.now();
    this.audioFrames = 0;
    this.awaitingFirstAudio = true;
    this.lastHeartbeatAt = this.startedAt;
    this.options.log?.(`[voice-wake] local KWS ready phrase=${phrase}`);
  }

  feed(samples: Float32Array): void {
    const kws = this.kws;
    const stream = this.stream;
    if (!kws || !stream) return;
    const now = Date.now();
    this.audioFrames += 1;
    if (this.awaitingFirstAudio) {
      this.awaitingFirstAudio = false;
      this.options.log?.(`[voice-wake] local KWS received first audio elapsed=${now - this.startedAt}ms`);
    } else if (now - this.lastHeartbeatAt >= 15_000) {
      this.lastHeartbeatAt = now;
      this.options.log?.(`[voice-wake] local KWS audio heartbeat frames=${this.audioFrames} elapsed=${now - this.startedAt}ms`);
    }
    stream.acceptWaveform(16_000, samples);
    while (kws.isReady(stream)) kws.decode(stream);
    const result = kws.getResult(stream);
    if (result.keyword) {
      this.options.log?.(`[voice-wake] local KWS detected keyword=${result.keyword} frames=${this.audioFrames}`);
      // Reset before invoking the callback. The callback may stop the engine
      // and release the KWS instance immediately.
      kws.reset(stream);
      this.detected?.();
    }
  }

  stop(): void {
    this.detected = undefined;
    this.stream = undefined;
    try { this.kws?.free(); } catch { /* already freed */ }
    this.kws = undefined;
    this.startedAt = 0;
    this.audioFrames = 0;
    this.awaitingFirstAudio = false;
  }
}
