/** R87：本地 ASR 的 Worker 客户端。模型只加载一次，start/stop 复用同一 worker。 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import type { AsrEventSink } from "./types.js";
import { LOCAL_ASR_WORKER_SOURCE } from "./local-asr-worker-source.js";

type LocalAsrMode = "sherpa" | "sensevoice";

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

interface LocalAsrWorkerOptions {
  mode: LocalAsrMode;
  root: string;
  numThreads?: number;
  log?: (message: string) => void;
}

export class LocalAsrWorker {
  private readonly options: LocalAsrWorkerOptions;
  private worker: Worker | undefined;
  private readyPromise: Promise<void> | undefined;
  private sink: AsrEventSink | undefined;
  private stopResolve: (() => void) | undefined;
  private active = false;

  constructor(options: LocalAsrWorkerOptions) {
    this.options = options;
  }

  private ensure(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    const worker = new Worker(LOCAL_ASR_WORKER_SOURCE, {
      eval: true,
      workerData: {
        modulePath: resolveSherpaModulePath(),
        mode: this.options.mode,
        root: this.options.root,
        numThreads: this.options.numThreads || (this.options.mode === "sensevoice" ? 2 : 1)
      }
    });
    this.worker = worker;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("本地语音模型 Worker 启动超时（20s）"));
      }, 20_000);
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      worker.on("message", (message: { type?: string; provider?: string; text?: string; message?: string }) => {
        if (!message || typeof message !== "object") return;
        if (message.type === "ready") {
          this.options.log?.(`[asr:${this.options.mode}] worker ready`);
          finish();
          return;
        }
        if (message.type === "error") {
          const error = new Error(message.message || "本地语音 Worker 运行失败");
          this.options.log?.(`[asr:${this.options.mode}] worker error: ${error.message}`);
          if (!settled) finish(error);
          this.sink?.({ type: "error", message: error.message });
          return;
        }
        if (message.type === "partial" || message.type === "final") {
          const text = typeof message.text === "string" ? message.text.trim() : "";
          if (text) {
            const type = message.type === "partial" ? "partial" as const : "final" as const;
            const provider = message.provider || (this.options.mode === "sensevoice" ? "local-pro" : "local");
            this.sink?.({ type, text, provider });
          }
          return;
        }
        if (message.type === "stopped") {
          this.active = false;
          this.sink?.({ type: "stopped" });
          this.stopResolve?.();
          this.stopResolve = undefined;
        }
      });
      worker.on("error", (error) => {
        this.options.log?.(`[asr:${this.options.mode}] worker fatal: ${error.message}`);
        if (!settled) finish(error);
        this.sink?.({ type: "error", message: error.message });
      });
      worker.on("exit", (code) => {
        this.options.log?.(`[asr:${this.options.mode}] worker exited code=${code}`);
        if (this.worker === worker) {
          this.worker = undefined;
          this.readyPromise = undefined;
        }
        this.active = false;
        this.stopResolve?.();
        this.stopResolve = undefined;
        if (!settled) finish(new Error(`本地语音 Worker 异常退出（${code}）`));
      });
    });
    return this.readyPromise;
  }

  async start(sink: AsrEventSink): Promise<void> {
    try {
      await this.ensure();
    } catch (error) {
      this.worker?.terminate();
      this.worker = undefined;
      this.readyPromise = undefined;
      throw error;
    }
    this.sink = sink;
    this.active = true;
    this.worker?.postMessage({ type: "start" });
  }

  push(samples: Float32Array): void {
    if (!this.active || !this.worker) return;
    try { this.worker.postMessage({ type: "audio", samples }, [samples.buffer]); } catch { /* worker gone */ }
  }

  stop(): Promise<void> {
    if (!this.active || !this.worker) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.stopResolve = resolve;
      try { this.worker?.postMessage({ type: "stop" }); } catch { resolve(); }
      setTimeout(() => {
        if (this.stopResolve === resolve) {
          this.stopResolve = undefined;
          resolve();
        }
      }, 8_000);
    });
  }

  cancel(): void {
    if (!this.active || !this.worker) return;
    this.active = false;
    try { this.worker.postMessage({ type: "cancel" }); } catch { /* best effort */ }
    this.stopResolve?.();
    this.stopResolve = undefined;
  }
}