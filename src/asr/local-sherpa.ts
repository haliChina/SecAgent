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
import { loadSherpaOnnx } from "./sherpa-loader.js";

const RECOGNIZER_DIR = "sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23";

type Recognizer = ReturnType<typeof import("sherpa-onnx")["createOnlineRecognizer"]>;
type RecognizerStream = ReturnType<Recognizer["createStream"]>;

export interface LocalAsrOptions {
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

  private recognizer: Recognizer | undefined;
  private recognizerError: string | undefined;
  private readonly options: LocalAsrOptions;

  constructor(options: LocalAsrOptions = {}) {
    this.options = options;
  }

  isConfigured(): boolean {
    return true; // bundled with the app; actual load errors surface on start
  }

  private async ensureRecognizer(): Promise<Recognizer> {
    if (this.recognizerError) throw new Error(this.recognizerError);
    if (this.recognizer) return this.recognizer;
    try {
      const modelRoot = resolveModelRoot(this.options);
      this.options.log?.(`[asr:local] loading model from ${modelRoot}`);
      const sherpa = await loadSherpaOnnx();
      this.recognizer = sherpa.createOnlineRecognizer({
        featConfig: { sampleRate: 16_000, featureDim: 80 },
        modelConfig: {
          transducer: {
            encoder: path.join(modelRoot, "encoder-epoch-99-avg-1.int8.onnx"),
            decoder: path.join(modelRoot, "decoder-epoch-99-avg-1.onnx"),
            joiner: path.join(modelRoot, "joiner-epoch-99-avg-1.onnx")
          },
          tokens: path.join(modelRoot, "tokens.txt"),
          provider: "cpu",
          numThreads: 1
        },
        enableEndpoint: 1,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20
      });
      return this.recognizer;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recognizerError = message;
      throw error;
    }
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const recognizer = await this.ensureRecognizer();
    let stream: RecognizerStream = recognizer.createStream();
    let stopped = false;

    const decode = (): void => {
      while (recognizer.isReady(stream)) recognizer.decode(stream);
    };

    return {
      providerId: this.id,
      push: (samples: Float32Array): void => {
        if (stopped) return;
        stream.acceptWaveform(16_000, samples);
        decode();
        if (recognizer.isEndpoint(stream)) {
          const text = (recognizer.getResult(stream).text || "").trim();
          if (text) sink({ type: "final", text, provider: this.id });
          recognizer.reset(stream);
        } else {
          const text = (recognizer.getResult(stream).text || "").trim();
          if (text) sink({ type: "partial", text, provider: this.id });
        }
      },
      stop: async (): Promise<void> => {
        if (stopped) return;
        stopped = true;
        try {
          stream.inputFinished();
          decode();
          const text = (recognizer.getResult(stream).text || "").trim();
          if (text) sink({ type: "final", text, provider: this.id });
        } catch (error) {
          sink({ type: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
          // A stream that has seen inputFinished() cannot be reused.
          try { stream.free(); } catch { /* already freed */ }
          stream = recognizer.createStream();
          stopped = false;
          sink({ type: "stopped" });
        }
      },
      cancel: (): void => {
        stopped = true;
        try { stream.free(); } catch { /* already freed */ }
        stream = recognizer.createStream();
        stopped = false;
      }
    };
  }
}

// Keep the exported helper name used by older callers (wake window diagnostics).
export function isLocalAsrAvailable(provider: LocalSherpaAsrProvider): boolean {
  return provider.isConfigured();
}
