/**
 * Provider-agnostic ASR (speech-to-text) contracts.
 *
 * The core layer knows nothing about Electron: providers receive Float32 PCM
 * chunks at 16 kHz and emit events through a sink. Electron-specific wiring
 * (windows, IPC, telemetry) lives in `src/electron/`.
 */

export type AsrEvent =
  | { type: "ready"; provider?: string }
  | { type: "partial"; text: string; provider?: string }
  | { type: "final"; text: string; provider?: string }
  | { type: "log"; message: string }
  | { type: "stopped" }
  | { type: "error"; message: string };

export type AsrEventSink = (event: AsrEvent) => void;

export interface AsrSession {
  readonly providerId: string;
  /** Feed 16 kHz mono Float32 samples. */
  push(samples: Float32Array): void;
  /** Finish the utterance; resolves after the final text has been emitted. */
  stop(): Promise<void>;
  /** Abort without emitting a final result. */
  cancel(): void;
}

export interface AsrTestResult {
  ok: boolean;
  message: string;
}

export interface AsrProvider {
  /** Stable identifier used in settings and logs (`official`, `openai`, `local`). */
  readonly id: string;
  /** Human-readable label for logs and diagnostics. */
  readonly label: string;
  /** Whether the provider has everything it needs (config present, logged in…). */
  isConfigured(): boolean;
  /**
   * Start an utterance. The returned promise resolves once the provider is
   * ready to accept audio and rejects when it cannot start, so the manager can
   * fall back to the next provider in the chain.
   */
  start(sink: AsrEventSink): Promise<AsrSession>;
  /** Optional connectivity probe used by the settings page. */
  test?(): Promise<AsrTestResult>;
}
