/**
 * Local offline ASR backed by the bundled sherpa-onnx streaming zipformer.
 *
 * The recognizer is created lazily on first use and kept for the app lifetime;
 * a load failure surfaces as a rejected `start()` so the manager can fall back
 * to a cloud provider instead of leaving speech dead.
 */
import fs from "node:fs";
import path from "node:path";
import type { AsrEventSink, AsrProvider, AsrSession } from "./types.js";
import { LocalAsrWorker } from "./local-asr-worker.js";

const RECOGNIZER_DIR = "sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23";

interface LocalAsrOptions {
  /** Additional directories to search for the bundled `models/` folder. */
  extraRoots?: string[];
  log?: (message: string) => void;
}

/** Electron exposes `process.resourcesPath`; plain Node does not. */
function electronResourcesPath(): string | undefined {
  return (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
}

function resolveModelRoot(options: LocalAsrOptions): string {
  const resourcesPath = electronResourcesPath();
  const candidates = [
    ...(options.extraRoots || []),
    ...(resourcesPath ? [resourcesPath] : []),
    process.cwd(),
    ...(process.env.SECAGENT_ASR_MODELS_ROOT ? [process.env.SECAGENT_ASR_MODELS_ROOT] : [])
  ];
  for (const root of candidates) {
    const candidate = path.join(root, "models", RECOGNIZER_DIR);
    if (fs.existsSync(candidate)) return candidate;
  }
  const searched = candidates.map((root) => path.join(root, "models")).join("、");
  throw new Error(`找不到本地语音模型 ${RECOGNIZER_DIR}，已搜索：${searched || "（无候选目录）"}`);
}

export class LocalSherpaAsrProvider implements AsrProvider {
  readonly id = "local";
  readonly label = "本地离线识别（sherpa-onnx）";

  private worker: LocalAsrWorker | undefined;
  private readonly options: LocalAsrOptions;

  constructor(options: LocalAsrOptions = {}) {
    this.options = options;
  }

  isConfigured(): boolean {
    return true; // bundled with the app; actual load errors surface on start
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const modelRoot = resolveModelRoot(this.options);
    this.worker ??= new LocalAsrWorker({ mode: "sherpa", root: modelRoot, numThreads: 1, log: this.options.log });
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
