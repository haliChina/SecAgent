/**
 * Cloud ASR via the official SECTL relay (`/asr/ws` WebSocket).
 *
 * Requires a signed-in session (`SECTL_OFFICIAL_TOKEN` + API URL). Connection
 * failures reject `start()` so the manager can fall back instead of leaving
 * the user without speech input.
 */
import type { AsrEvent, AsrEventSink, AsrProvider, AsrSession } from "./types.js";

const CONNECT_TIMEOUT_MS = 8_000;
/** Cap buffered audio while the socket is still connecting (~1s at 16 kHz). */
const MAX_PENDING_CHUNKS = 32;

export interface RelayAsrOptions {
  getToken?: () => string;
  getApiBaseUrl?: () => string;
  log?: (message: string) => void;
  WebSocketCtor?: typeof WebSocket;
}

export class RelayAsrProvider implements AsrProvider {
  readonly id = "official";
  readonly label = "官方云端语音识别";
  private readonly options: RelayAsrOptions;
  /** Current socket, when a session started through this provider. */
  private socket: WebSocket | undefined;

  constructor(options: RelayAsrOptions = {}) {
    this.options = options;
  }

  private endpoint(): string | null {
    const token = this.options.getToken?.() || process.env.SECTL_OFFICIAL_TOKEN || "";
    const baseUrl = (this.options.getApiBaseUrl?.() || process.env.SECTL_OFFICIAL_API_URL || "").replace(/\/$/, "");
    if (!token || !baseUrl) return null;
    const wsBase = baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    return `${wsBase}/asr/ws?token=${encodeURIComponent(token)}`;
  }

  isConfigured(): boolean {
    return this.endpoint() !== null;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const url = this.endpoint();
    if (!url) return { ok: false, message: "尚未登录官方服务（缺少 SECTL_OFFICIAL_TOKEN），无法使用官方云端语音识别" };
    return { ok: true, message: "官方云端语音识别已配置（连接在开始说话时建立）" };
  }

  async start(sink: AsrEventSink): Promise<AsrSession> {
    const url = this.endpoint();
    if (!url) throw new Error("官方云端语音识别未配置：请先登录官方服务");
    const WebSocketCtor = this.options.WebSocketCtor || WebSocket;
    if (typeof WebSocketCtor === "undefined") throw new Error("当前环境不支持 WebSocket");

    let logTarget = "<invalid-url>";
    try {
      const parsed = new URL(url);
      logTarget = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch { /* keep the placeholder */ }
    this.options.log?.(`[asr:official] connecting to ${logTarget}`);

    return await new Promise<AsrSession>((resolve, reject) => {
      let socket: WebSocket;
      try {
        socket = new WebSocketCtor(url);
      } catch (error) {
        reject(new Error(`云端语音识别连接创建失败：${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      socket.binaryType = "arraybuffer";
      const pending: ArrayBuffer[] = [];
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.close(); } catch { /* may already be closed */ }
        reject(new Error(`云端语音识别连接超时（${CONNECT_TIMEOUT_MS / 1000}s）`));
      }, CONNECT_TIMEOUT_MS);
      const finish = (error?: Error, session?: AsrSession): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error || !session) reject(error || new Error("云端语音识别连接失败"));
        else resolve(session);
      };

      socket.onopen = () => {
        this.options.log?.("[asr:official] websocket opened");
        // The relay must receive the start control message before binary
        // audio. Sending buffered audio first makes the relay discard it.
        try { socket.send(JSON.stringify({ type: "start" })); } catch { /* socket may close during startup */ }
        for (const pcm of pending.splice(0)) socket.send(pcm);
        if (this.socket && this.socket !== socket) { try { this.socket.close(1000, "superseded"); } catch { /* ignore */ } }
        this.socket = socket;
        // Set once the user finishes the utterance; the server-initiated close
        // that follows "Done" is then expected, not an error.
        let finished = false;
        finish(undefined, {
          providerId: this.id,
          push: (samples: Float32Array): void => {
            const pcm = samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer;
            if (socket.readyState === WebSocket.OPEN) {
              try { socket.send(pcm); } catch { /* socket may close between the state check and send */ }
              return;
            }
            if (socket.readyState === WebSocket.CONNECTING) {
              if (pending.length >= MAX_PENDING_CHUNKS) pending.shift();
              pending.push(pcm);
            }
          },
          stop: async (): Promise<void> => {
            finished = true;
            if (socket.readyState === WebSocket.OPEN) {
              try { socket.send("Done"); } catch { /* socket may already be closing */ }
            } else if (socket.readyState === WebSocket.CONNECTING) socket.close();
          },
          cancel: (): void => {
            finished = true;
            try { socket.close(1000, "cancelled"); } catch { /* socket may already be closed */ }
            if (this.socket === socket) this.socket = undefined;
          }
        });
        socket.onclose = (event: CloseEvent): void => onclose(event, () => finished);
      };
      socket.onmessage = (event: MessageEvent) => {
        try {
          sink(typeof event.data === "string" ? JSON.parse(event.data) as AsrEvent : (event.data as AsrEvent));
        } catch {
          sink({ type: "log", message: String(event.data ?? "") });
        }
      };
      socket.onerror = (event: Event) => {
        const errorEvent = event as ErrorEvent;
        const error = errorEvent.error as { message?: string; code?: string } | undefined;
        this.options.log?.(`[asr:official] websocket error state=${socket.readyState} message=${errorEvent.message || error?.message || ""}`);
        const message = "云端语音识别连接失败";
        if (settled) sink({ type: "error", message });
        else finish(new Error(message));
      };
      const onclose = (event: CloseEvent, isFinished: () => boolean): void => {
        this.options.log?.(`[asr:official] websocket closed code=${event.code}`);
        if (this.socket === socket) this.socket = undefined;
        if (!settled) {
          finish(new Error(`云端语音识别连接已断开（code=${event.code}），请检查网络或改用第三方/本地识别`));
          return;
        }
        // A close after a normal stop/cancel is expected; only a mid-utterance
        // drop should surface as an error so the UI does not hang.
        if (isFinished()) return;
        sink({ type: "error", message: `云端语音识别连接断开（code=${event.code}）` });
      };
      socket.onclose = (event: CloseEvent): void => onclose(event, () => false);
    });
  }
}
