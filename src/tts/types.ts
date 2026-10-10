/**
 * TTS (text-to-speech) contracts shared by every provider.
 *
 * The core layer stays Electron-free: providers turn text into playable audio
 * buffers; the Electron glue (src/electron/tts-bridge.ts) routes them to the
 * renderer over IPC.
 */

export type TtsProviderKind = "edge" | "windows" | "mimo" | "bailian";

export interface TtsSynthesisOptions {
  /** Voice name; provider-specific. */
  voice?: string;
  /** Rate hint like "+10%" / "-10%" (edge-tts) or SAPI-style "-1..1" (mapped internally). */
  rate?: string;
}

export interface TtsAudioChunk {
  /** MP3/WAV bytes ready for playback. */
  data: Buffer;
}

export interface TtsTestResult {
  ok: boolean;
  message: string;
}

export interface TtsProvider {
  readonly id: TtsProviderKind;
  readonly label: string;
  /** Whether the provider has everything it needs (key, runtime, etc.). */
  isConfigured(): boolean;
  displayName(): string;
  synthesize(text: string, options?: TtsSynthesisOptions): Promise<TtsAudioChunk>;
  /** Connectivity probe for the settings page. */
  test(): Promise<TtsTestResult>;
}

/** Mimo TTS settings (chat/completions audio output). */
export interface MimoTtsSettings {
  apiKeyEnv?: string;
  baseUrl?: string;
  /** mimo-v2.5-tts | mimo-v2.5-tts-voicedesign | mimo-v2.5-tts-voiceclone */
  model?: string;
  /** Preset voice, or base64 sample for voiceclone. */
  voice?: string;
  /** Tone description used as the user message (voicedesign). */
  voiceDescription?: string;
  /** mp3 | wav | pcm */
  format?: string;
}

/** Bailian CosyVoice settings. */
export interface BailianTtsSettings {
  apiKeyEnv?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  format?: string;
}

/** Windows 系统朗读（SAPI）设置。 */
interface WindowsTtsSettings {
  voice?: string;
}

export interface TtsSettings {
  provider: TtsProviderKind;
  /** Ordered fallback chain after the primary provider. Empty = no fallback. */
  chain?: TtsProviderKind[];
  voice: string;
  rate: string;
  windows?: WindowsTtsSettings;
  mimo?: MimoTtsSettings;
  bailian?: BailianTtsSettings;
}

