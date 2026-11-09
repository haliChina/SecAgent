/**
 * Voice wake ("小泽同学") keyword spotting with the bundled sherpa-onnx KWS model.
 *
 * R87：KWS 解码从 Electron 主进程移到 worker_threads。主线程只做音频帧
 * 转发与心跳；sherpa 的同步 decode 不再和 UI、模型流、IPC 抢事件循环。
 * Worker 用 eval 源码启动，sherpa-onnx 的绝对路径由主进程解析后传入。
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { pinyin } from "pinyin-pro";
import { VOICE_WAKE_WORKER_SOURCE } from "./voice-wake-worker-source.js";

const KWS_DIR = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20";

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

/** 解析 sherpa-onnx 的绝对路径，交给 eval worker 的 require。 */
function resolveSherpaModulePath(): string {
  try {
    const resolved = createRequire(import.meta.url).resolve("sherpa-onnx");
    /* 打包后 sherpa 在 asarUnpack；worker 里 require asar 路径不一定能读 wasm，
       优先换到 app.asar.unpacked。 */
    const unpacked = resolved.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    if (unpacked !== resolved && fs.existsSync(unpacked)) return unpacked;
    return resolved;
  } catch {
    const fallback = path.join(process.cwd(), "node_modules", "sherpa-onnx", "index.js");
    if (fs.existsSync(fallback)) return fallback;
    throw new Error("找不到 sherpa-onnx 运行时（node_modules/sherpa-onnx）");
  }
}

export class VoiceWakeEngine {
  private worker: Worker | undefined;
  private detected: (() => void) | undefined;
  private startedAt = 0;
  private audioFrames = 0;
  private lastHeartbeatAt = 0;
  private paused = false;
  private stopping = false;
  private readonly options: VoiceWakeOptions;

  constructor(options: VoiceWakeOptions = {}) {
    this.options = options;
  }

  get active(): boolean {
    return Boolean(this.worker);
  }

  async start(phrase: string, onDetected: () => void): Promise<void> {
    this.detected = onDetected;
    if (this.worker) {
      this.options.log?.(`[voice-wake] worker already active phrase=${phrase}`);
      return;
    }
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates = [...(this.options.extraRoots || []), ...(resourcesPath ? [resourcesPath] : []), process.cwd()];
    const root = candidates.map((candidate) => path.join(candidate, "models", KWS_DIR)).find((candidate) => fs.existsSync(candidate));
    if (!root) throw new Error(`找不到语音唤醒模型 ${KWS_DIR}，已搜索：${candidates.map((candidate) => path.join(candidate, "models")).join("、")}`);

    this.stopping = false;
    this.paused = false;
    this.audioFrames = 0;
    this.lastHeartbeatAt = Date.now();
    this.startedAt = this.lastHeartbeatAt;
    const worker = new Worker(VOICE_WAKE_WORKER_SOURCE, {
      eval: true,
      workerData: {
        modulePath: resolveSherpaModulePath(),
        root,
        keywords: `${keywordTokens(phrase)} @${phrase}`,
        numThreads: 2,
        keywordsScore: 1.4,
        keywordsThreshold: 0.15
      }
    });
    this.worker = worker;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("语音唤醒 Worker 启动超时（15s）"));
      }, 15_000);
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      worker.on("message", (message: { type?: string; message?: string; keyword?: string }) => {
        if (!message || typeof message !== "object") return;
        if (message.type === "ready") {
          this.options.log?.(`[voice-wake] worker ready phrase=${phrase}`);
          finish();
          return;
        }
        if (message.type === "error") {
          const error = new Error(message.message || "语音唤醒 Worker 运行失败");
          this.options.log?.(`[voice-wake] worker error: ${error.message}`);
          if (!settled) finish(error);
          return;
        }
        if (message.type === "detected") {
          this.options.log?.(`[voice-wake] worker detected keyword=${message.keyword || ""} frames=${this.audioFrames}`);
          this.detected?.();
          return;
        }
        if (message.type === "paused" || message.type === "resumed" || message.type === "stopped") {
          this.options.log?.(`[voice-wake] worker ${message.type}`);
        }
      });
      worker.on("error", (error) => {
        this.options.log?.(`[voice-wake] worker fatal: ${error.message}`);
        if (!settled) finish(error);
      });
      worker.on("exit", (code) => {
        this.options.log?.(`[voice-wake] worker exited code=${code}`);
        if (this.worker === worker) this.worker = undefined;
        if (!this.stopping && !settled) finish(new Error(`语音唤醒 Worker 异常退出（${code}）`));
      });
    }).catch((error: unknown) => {
      this.stopping = true;
      void worker.terminate();
      if (this.worker === worker) this.worker = undefined;
      throw error;
    });
  }

  feed(samples: Float32Array): void {
    const worker = this.worker;
    if (!worker || this.paused) return;
    const now = Date.now();
    this.audioFrames += 1;
    if (this.audioFrames === 1) {
      this.options.log?.(`[voice-wake] worker received first audio elapsed=${now - this.startedAt}ms`);
    } else if (now - this.lastHeartbeatAt >= 15_000) {
      this.lastHeartbeatAt = now;
      this.options.log?.(`[voice-wake] worker audio heartbeat frames=${this.audioFrames} elapsed=${now - this.startedAt}ms`);
    }
    try {
      worker.postMessage({ type: "audio", samples }, [samples.buffer]);
    } catch (error) {
      this.options.log?.(`[voice-wake] worker post failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.worker?.postMessage({ type: "pause" });
    this.options.log?.("[voice-wake] worker paused");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.worker?.postMessage({ type: "resume" });
    this.options.log?.("[voice-wake] worker resumed");
  }

  stop(): void {
    this.detected = undefined;
    this.stopping = true;
    const worker = this.worker;
    this.worker = undefined;
    this.paused = false;
    if (worker) {
      try { worker.postMessage({ type: "stop" }); } catch { /* best effort */ }
      void worker.terminate();
    }
    this.startedAt = 0;
    this.audioFrames = 0;
  }
}
