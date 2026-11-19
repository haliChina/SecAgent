/**
 * 阿里云百炼 ASR — channel B (realtime streaming, "type-as-you-speak").
 *
 * DashScope WebSocket duplex protocol on `wss://…/api-ws/v1/inference`:
 *   1. send `run-task` (JSON text frame), wait for `task-started`
 *   2. stream raw PCM binary frames (16 kHz / 16-bit / mono, ~100ms / 3.2KB
 *      each, never above 16KB and never a burst of sub-1KB frames)
 *   3. each frame may yield `result-generated` → `payload.output.sentence.text`
 *   4. send `finish-task` and close after `task-finished`; `task-failed`
 *      surfaces `header.error_message`.
 * An unexpected drop is reconnected once (the already-received audio is
 * replayed); if that fails the session reports an error so the manager can
 * fall back to channel A (`bailian`) or the local model.
 *
 * Docs: https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api
 */
import type { AsrEventSink, AsrProvider, AsrSession, AsrTestResult } from "./types.js";
import { ASR_SAMPLE_RATE, encodePcm16, mergeSamples } from "./wav.js";
import type { AsrNoiseSettings, BailianAsrSettings } from "./settings.js";
import { bailianDisplayName, resolveBailianConfig, type ResolvedBailianConfig } from "./bailian-config.js";
// `ws`（而非全局 WebSocket）：DashScope 在握手阶段校验 Authorization 头，
// Node 全局 WebSocket 不支持自定义请求头，必须用 ws 包。
import Ws from "ws";

const CONNECT_TIMEOUT_MS = 8_000;
const FINISH_TIMEOUT_MS = 8_000;
/** ~100ms of 16 kHz 16-bit mono PCM (3.2KB per frame, well within the documented 16KB cap). */
const FRAME_BYTES = 3_200;
/** Cap audio queued while (re)connecting (~3s at 16 kHz). */
const MAX_PENDING_BYTES = 3 * ASR_SAMPLE_RATE * 2;
/** Cap the replay buffer used to restart an utterance after a drop (~30s). */
const MAX_REPLAY_SAMPLES = 30 * ASR_SAMPLE_RATE;
/** Documented behaviour: reconnect once when the socket drops. */
const MAX_RECONNECTS = 1;

const WS_OPEN = 1;

type WsLike = Pick<WebSocket, "readyState" | "send" | "close" | "binaryType"> & {
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
};

/** Node's WebSocket accepts handshake headers through a non-standard option bag. */
export type BailianWsConstructor = new (url: string, options?: { headers?: Record<string, string> }) => WebSocket;

interface BailianWsAsrOptions {
  /** Current 百炼 settings (re-read on each start). */
  getSettings: () => BailianAsrSettings | undefined;
  /** Resolves the API key for an env var name (usually process.env). */
  getApiKey: (envName: string) => string | undefined;
  /** 嘈杂环境参数（speech_noise_threshold / vad_model / 即时热词）。 */
  getNoise?: () => AsrNoiseSettings | undefined;
  WebSocketCtor?: BailianWsConstructor;
  log?: (message: string) => void;
  /** Injectable UUID source (tests only). */
  uuid?: () => string;
}

/** Split Float32 PCM into ≤16KB binary frames of ~100ms. */
class PcmFramer {
  private pending = new Float32Array(0);

  push(samples: Float32Array): ArrayBuffer[] {
    if (!samples.length) return [];
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending, 0);
    merged.set(samples, this.pending.length);
    const perFrame = FRAME_BYTES / 2;
    const frames: ArrayBuffer[] = [];
    let offset = 0;
    while (merged.length - offset >= perFrame) {
      frames.push(encodePcm16(merged.subarray(offset, offset + perFrame)).buffer as ArrayBuffer);
      offset += perFrame;
    }
    this.pending = merged.slice(offset);
    return frames;
  }

  /** Final tail (may be shorter than 100ms); only used when the utterance ends. */
  flush(): ArrayBuffer | undefined {
    if (!this.pending.length) return undefined;
    const frame = encodePcm16(this.pending).buffer as ArrayBuffer;
    this.pending = new Float32Array(0);
    return frame;
  }

  /** Drop the un-flushed tail (the replay rebuilds frames from the full history). */
  reset(): void {
    this.pending = new Float32Array(0);
  }
}

/**
 * One utterance over the duplex protocol. `ready` resolves after task-started
 * so the manager only reports the provider as usable once audio can flow.
 */
class BailianWsSession implements AsrSession {
  readonly providerId = "bailian-ws";
  private readonly sink: AsrEventSink;
  private readonly config: ResolvedBailianConfig;
  private readonly options: BailianWsAsrOptions;
  private readonly taskId: string;
  private readonly framer = new PcmFramer();
  /** Every sample received this utterance, kept for a single replay. */
  private readonly history: Float32Array[] = [];
  private socket: WsLike | undefined;
  private started = false;
  private finished = false;
  private failed = false;
  private cancelled = false;
  private stopRequested = false;
  private reconnects = 0;
  private pendingBytes = 0;
  private readonly pending: ArrayBuffer[] = [];
  private historySamples = 0;
  private reconnectPromise: Promise<void> | undefined;

  constructor(config: ResolvedBailianConfig, sink: AsrEventSink, options: BailianWsAsrOptions, taskId: string) {
    this.config = config;
    this.sink = sink;
    this.options = options;
    this.taskId = taskId;
  }

  /** Establish the connection and start the task; retries once on failure. */
  async ready(): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      if (this.reconnects >= MAX_RECONNECTS || this.cancelled || this.stopRequested) throw error;
      this.reconnects += 1;
      this.options.log?.("[asr:bailian-ws] connect failed, retrying once");
      await this.connect();
    }
  }

  private connect(): Promise<void> {
    const Ctor = this.options.WebSocketCtor || (Ws as unknown as BailianWsConstructor);
    if (typeof Ctor === "undefined") return Promise.reject(new Error("当前环境不支持 WebSocket"));
    return new Promise<void>((resolve, reject) => {
      let socket: WsLike;
      try {
        socket = new Ctor(this.config.wsUrl, { headers: { Authorization: `Bearer ${this.config.apiKey}`, "user-agent": "SecAgent" } }) as WsLike;
      } catch (error) {
        reject(new Error(`百炼实时识别连接创建失败：${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      socket.binaryType = "arraybuffer";
      this.socket = socket;
      this.started = false;
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch { /* may already be closed */ }
        reject(new Error(`百炼实时识别连接超时（${CONNECT_TIMEOUT_MS / 1000}s），请检查网络，或改用非流式/本地识别`));
      }, CONNECT_TIMEOUT_MS);
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const abort = (message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.socket === socket) this.socket = undefined;
        try { socket.close(); } catch { /* may already be closed */ }
        reject(new Error(message));
      };

      socket.onopen = () => {
        this.options.log?.("[asr:bailian-ws] websocket opened");
        try {
          // 嘈杂环境参数（官方文档）：
          //  - speech_noise_threshold [-1,1]：-1 方向更不易漏音（教室场景建议 -0.2 ~ -0.6）
          //  - vad_model：far_field_meeting_16k 远场（希沃顶部麦克风）/ near_meeting_16k 近场
          //  - vocabulary：即时热词（权重 50 = 超级热词）
          const noise = this.options.getNoise?.();
          const parameters: Record<string, unknown> = { format: "pcm", sample_rate: ASR_SAMPLE_RATE };
          if (typeof noise?.speechNoiseThreshold === "number") parameters.speech_noise_threshold = noise.speechNoiseThreshold;
          if (noise?.vadModel) parameters.vad_model = noise.vadModel;
          if (noise?.hotwords?.length) parameters.vocabulary = Object.fromEntries(noise.hotwords.map((word) => [word, 50]));
          if (this.config.language) parameters.language_hints = [this.config.language];
          socket.send(JSON.stringify({
            header: { action: "run-task", task_id: this.taskId, streaming: "duplex" },
            payload: {
              task_group: "audio",
              task: "asr",
              function: "recognition",
              model: this.config.streamModel,
              parameters,
              input: {}
            }
          }));
        } catch (error) {
          abort(`百炼 run-task 发送失败：${error instanceof Error ? error.message : String(error)}`);
        }
      };

      socket.onmessage = (event) => {
        // ws 包的文本帧给 Buffer，全局 WebSocket 给 string——统一成 string。
        const raw = event.data;
        const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : typeof ArrayBuffer !== "undefined" && raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : undefined;
        if (!text) return; // binary audio is never sent back by the server
        let message: { header?: { event?: string; error_code?: string; error_message?: string }; payload?: { message?: string; output?: { sentence?: { text?: string; sentence_end?: boolean; heartbeat?: boolean } } } };
        try { message = JSON.parse(text) as typeof message; } catch { return; }
        const header = message.header || {};
        if (header.event === "task-started") {
          this.started = true;
          this.options.log?.("[asr:bailian-ws] task started");
          for (const pcm of this.pending.splice(0)) { try { socket.send(pcm); } catch { /* socket may close mid-send */ } }
          this.pendingBytes = 0;
          succeed();
          return;
        }
        if (header.event === "result-generated") {
          const sentence = message.payload?.output?.sentence;
          if (sentence?.heartbeat) return; // keep-alive packet carries no transcript
          const text = (sentence?.text || "").trim();
          if (!text) return;
          this.sink({ type: sentence?.sentence_end === false ? "partial" : "final", text, provider: this.providerId });
          return;
        }
        if (header.event === "task-finished") {
          this.finished = true;
          return;
        }
        if (header.event === "task-failed") {
          this.failed = true;
          const detail = header.error_message || message.payload?.message || header.error_code || "未知错误";
          abort(`百炼实时识别任务失败：${detail}`);
          this.sink({ type: "error", message: `百炼实时识别失败：${detail}` });
        }
      };

      socket.onerror = (event: Event) => {
        const errorEvent = event as ErrorEvent;
        this.options.log?.(`[asr:bailian-ws] websocket error state=${socket.readyState} message=${errorEvent.message || ""}`);
        abort("百炼实时识别连接失败（网络波动或密钥/地址有误），已尝试改用其他识别通道");
      };

      socket.onclose = (event: CloseEvent) => {
        this.options.log?.(`[asr:bailian-ws] websocket closed code=${event.code}`);
        if (this.socket === socket) this.socket = undefined;
        if (!settled) {
          // Handshake dropped before task-started: surface a retryable failure.
          abort(`百炼实时识别连接已断开（code=${event.code}）：请检查 API Key（无效或额度用尽）、WS URL 与网络`);
          return;
        }
        // Mid-stream drop: restart the task once and replay the buffered audio.
        this.scheduleReconnect(event.code);
      };
    });
  }

  private pushHistory(samples: Float32Array): void {
    this.history.push(samples);
    this.historySamples += samples.length;
    while (this.historySamples > MAX_REPLAY_SAMPLES && this.history.length > 1) {
      const dropped = this.history.shift();
      if (dropped) this.historySamples -= dropped.length;
    }
  }

  private queueFrame(frame: ArrayBuffer): void {
    if (this.pendingBytes + frame.byteLength > MAX_PENDING_BYTES) {
      const dropped = this.pending.shift();
      if (dropped) this.pendingBytes -= dropped.byteLength;
    }
    this.pending.push(frame);
    this.pendingBytes += frame.byteLength;
  }

  /** Unexpected close after task-started: one reconnect attempt, then error. */
  private scheduleReconnect(code: number): void {
    if (this.cancelled || this.stopRequested || this.finished || this.failed) return;
    if (this.reconnects >= MAX_RECONNECTS) {
      this.failed = true;
      this.sink({ type: "error", message: `百炼实时识别连接中断（code=${code}），自动重连失败：请重试，或改用非流式/本地识别` });
      return;
    }
    this.options.log?.("[asr:bailian-ws] connection dropped mid-stream, reconnecting once");
    this.reconnectPromise = this.reconnect(code);
  }

  private async reconnect(code: number): Promise<void> {
    try {
      this.reconnects += 1;
      this.prepareReplay();
      await this.connect();
      this.options.log?.("[asr:bailian-ws] reconnected, buffered audio replayed");
    } catch (error) {
      this.failed = true;
      const message = error instanceof Error ? error.message : String(error);
      this.sink({ type: "error", message: `百炼实时识别连接中断（code=${code}），重连失败：${message}` });
    } finally {
      this.reconnectPromise = undefined;
    }
  }

  /** Rebuild the already-received audio as ≤16KB frames for the new task. */
  private prepareReplay(): void {
    this.framer.reset();
    this.pending.length = 0;
    this.pendingBytes = 0;
    const samples = mergeSamples(this.history);
    if (!samples.length) return;
    for (const frame of new PcmFramer().push(samples)) {
      this.pending.push(frame);
      this.pendingBytes += frame.byteLength;
    }
    this.options.log?.(`[asr:bailian-ws] replaying ${(samples.length / ASR_SAMPLE_RATE).toFixed(1)}s of audio`);
  }

  push(samples: Float32Array): void {
    if (this.cancelled || this.stopRequested) return;
    this.pushHistory(samples);
    const frames = this.framer.push(samples);
    const socket = this.socket;
    if (!socket || socket.readyState !== WS_OPEN || !this.started) {
      // Queue framed audio while connecting (or reconnecting).
      for (const frame of frames) this.queueFrame(frame);
      return;
    }
    for (const frame of frames) {
      try { socket.send(frame); } catch { /* socket may close between the state check and send */ }
    }
  }

  async stop(): Promise<void> {
    if (this.cancelled || this.stopRequested) return;
    this.stopRequested = true;
    // A drop may be mid-reconnect: finish the recovery attempt before closing.
    if (this.reconnectPromise) await this.reconnectPromise;
    const socket = this.socket;
    if (socket && socket.readyState === WS_OPEN && this.started) {
      const tail = this.framer.flush();
      try {
        if (tail) socket.send(tail);
        socket.send(JSON.stringify({
          header: { action: "finish-task", task_id: this.taskId, streaming: "duplex" },
          payload: { input: {} }
        }));
      } catch { /* socket may already be closing */ }
      const deadline = Date.now() + FINISH_TIMEOUT_MS;
      while (!this.finished && !this.failed && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!this.finished && !this.failed) this.sink({ type: "error", message: "百炼实时识别未在预期时间内返回最终结果" });
    this.close("finished");
    this.sink({ type: "stopped" });
  }

  cancel(): void {
    this.cancelled = true;
    this.stopRequested = true;
    this.close("cancelled");
  }

  private close(reason: string): void {
    const socket = this.socket;
    this.socket = undefined;
    try { socket?.close(1000, reason); } catch { /* may already be closed */ }
  }
}

export class BailianWsAsrProvider implements AsrProvider {
  readonly id = "bailian-ws";
  readonly label = "阿里云百炼（WebSocket 流式）";
  private readonly options: BailianWsAsrOptions;

  constructor(options: BailianWsAsrOptions) {
    this.options = options;
  }

  private displayName(): string {
    return bailianDisplayName(this.options.getSettings(), this.label);
  }

  isConfigured(): boolean {
    return resolveBailianConfig(this.options.getSettings(), this.options.getApiKey) !== null;
  }

  private uuid(): string {
    const injected = this.options.uuid?.();
    if (injected) return injected;
    try { return crypto.randomUUID(); } catch { /* runtime without randomUUID */ }
    return `task-${Date.now()}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
  }

  async test(): Promise<AsrTestResult> {
    const config = resolveBailianConfig(this.options.getSettings(), this.options.getApiKey);
    if (!config) return { ok: false, message: `环境变量 ${this.options.getSettings()?.apiKeyEnv || "BAILIAN_API_KEY"} 中没有 API Key（可在下方填写并保存到工作区 .env）` };
    const endpoint = config.wsUrl.replace(/^wss?:\/\//, "");
    return { ok: true, message: `${this.displayName()} 已配置（实时连接在开始说话时建立：${endpoint}）` };
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const config = resolveBailianConfig(this.options.getSettings(), this.options.getApiKey);
    if (!config) throw new Error("阿里云百炼实时语音识别未配置：请在设置中填写 API Key（保存到工作区 .env 的 BAILIAN_API_KEY）");
    this.options.log?.(`[asr:bailian-ws] connecting ${config.wsUrl.replace(/^wss?:\/\//, "")} model=${config.streamModel}`);
    const session = new BailianWsSession(config, sink, this.options, this.uuid());
    try {
      await session.ready();
    } catch (error) {
      session.cancel();
      throw error;
    }
    return session;
  }
}