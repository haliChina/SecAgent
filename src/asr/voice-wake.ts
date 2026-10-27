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
  /* R62 唤醒词修复补遗（此前注释的两处断言经实测不成立，已订正）：
     - 词表 models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/tokens.txt
       （263 token）并非"无任何带调韵母"——约 135 个 token 含带调韵母
       （iǎo/ué/óng/é…）；pinyin-pro 的 toneType:"symbol" 生成的是带调符号
       （xiǎo/zé/tóng/xué），不是数字调（iao3/e2/ong2）。
     - toneType:"none" 下 pinyin("女")="nü"(U+00FC)，按声母+韵母切成 "n ü"；
       但词表没有裸 ü（ü 系只有 ǘ/ǚ/ǜ 与 üè/üě），含女/绿/吕/旅/律的自定
       义唤醒词永远拼不出关键词图。修：含 ü 的音节单独保留声调。 */
  const cleaned = phrase.replace(/\s+/g, "");
  const toneless = pinyin(cleaned, { toneType: "none", type: "array" }) as string[];
  const toned = pinyin(cleaned, { toneType: "symbol", type: "array" }) as string[];
  const initials = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"];
  return toneless.map((syllable, index) => {
    const source = syllable.includes("ü") ? toned[index] : syllable;
    const initial = initials.find((candidate) => source.startsWith(candidate)) || "";
    return `${initial} ${source.slice(initial.length)}`.trim();
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
        numThreads: 2,
        modelingUnit: "ppinyin"
      },
      maxActivePaths: 4,
      /* R74：numTrailingBlanks 1→2——尾部静音判定太短会让说完关键词的
         收尾帧被吞（截断式漏检），2 是社区对 3M 模型的常用值。 */
      numTrailingBlanks: 2,
      /* R59：threshold 0.55 远高于 sherpa 默认 0.25，回落官方默认。
         R74 用户实测仍「喊不动」+识别率低——继续放宽：threshold 0.15
         （3M 小模型召回优先，误触由四字词长度+冷却兜底）、score 1.4
         （关键词相对背景语料的加分）。配合 VoiceWakeListener 的
         AudioWorklet 重写（掉帧才是大屏场景的真根因）。 */
      keywordsScore: 1.4,
      keywordsThreshold: 0.15,
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
