/** Settings-facing ASR configuration shared between the config layer and UI. */

/**
 * Which speech-to-text backend to use. `auto` follows the fallback chain.
 *
 * `bailian` is 阿里云百炼's OpenAI-compatible `chat/completions` ASR channel
 * (non-streaming utterances), `bailian-ws` its realtime WebSocket channel.
 */
export type AsrProviderKind = "auto" | "official" | "openai" | "local" | "bailian" | "bailian-ws";

export interface OpenAiAsrSettings {
  /** Optional display name (e.g. 小米 MiMo ASR). */
  name?: string;
  /** OpenAI-compatible base URL, e.g. `https://token-plan-cn.xiaomimimo.com/v1`. */
  baseUrl: string;
  /** Env var name that holds the API key inside the workspace `.env`. */
  apiKeyEnv: string;
  /** Model name posted to `/audio/transcriptions`. */
  model: string;
  /** Optional ISO language hint (`zh`, `en`…). */
  language?: string;
}

/**
 * 阿里云百炼 ASR settings. Channel A talks to `POST {baseUrl}/chat/completions`
 * with an `input_audio` Data URL; channel B talks to the realtime WebSocket at
 * `wsUrl`. Both share one DashScope API key (env-isolated like other providers).
 * Documented defaults are only applied when a field is left empty.
 */
export interface BailianAsrSettings {
  /** Optional display name. */
  name?: string;
  /** Env var name that holds the API key inside the workspace `.env`. */
  apiKeyEnv: string;
  /** OpenAI-compatible base URL, e.g. `https://…/compatible-mode/v1`. */
  baseUrl: string;
  /** Realtime endpoint, e.g. `wss://…/api-ws/v1/inference`. */
  wsUrl: string;
  /** Non-streaming model name (`qwen3-asr-flash`). */
  model: string;
  /** Realtime streaming model name (`qwen-audio-3.1-asr-flash-streaming`). */
  streamModel: string;
  /** Optional single language hint; empty means auto detect (recommended). */
  language?: string;
  /** ITN (digits normalization); 百炼 defaults to false. */
  enableItn?: boolean;
}

/** Documented 百炼 defaults (DASHSCOPE public domain fallback). */
export const BAILIAN_DEFAULTS = {
  apiKeyEnv: "BAILIAN_API_KEY",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  wsUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
  model: "qwen3-asr-flash",
  streamModel: "qwen-audio-3.1-asr-flash-streaming"
} as const;

export interface SpeechAsrSettings {
  betterRecognition?: boolean;
  provider?: AsrProviderKind;
  openai?: OpenAiAsrSettings;
  bailian?: BailianAsrSettings;
}

/** Provider dropdown entries for the 第三方云端 panel's 百炼 channels. */
export interface AsrBailianPreset {
  id: string;
  provider: "bailian" | "bailian-ws";
  label: string;
  note: string;
}

export const ASR_BAILIAN_PRESETS: readonly AsrBailianPreset[] = [
  {
    id: "bailian",
    provider: "bailian",
    label: "阿里云百炼（chat/completions）",
    note: "百炼 OpenAI 兼容模式：POST /chat/completions + input_audio（非流式，整句返回）。Base URL 需含 /compatible-mode/v1。"
  },
  {
    id: "bailian-ws",
    provider: "bailian-ws",
    label: "阿里云百炼（WebSocket 流式）",
    note: "百炼实时语音识别：wss /api-ws/v1/inference，边说边出字；失败自动回退非流式通道与本地模型。"
  }
];

export interface AsrOpenAiPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  note?: string;
}

/**
 * Presets for OpenAI-compatible third-party ASR endpoints. Every field stays
 * editable in settings, so regional variants or renamed models keep working.
 */
export const ASR_OPENAI_PRESETS: readonly AsrOpenAiPreset[] = [
  {
    id: "mimo",
    label: "小米 MiMo ASR",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    model: "MiMo-ASR",
    apiKeyEnv: "MIMO_API_KEY",
    note: "小米 MiMo 开放平台（OpenAI 兼容）。模型名称以平台控制台为准。"
  },
  {
    id: "siliconflow",
    label: "SiliconFlow SenseVoice",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "FunAudioLLM/SenseVoiceSmall",
    apiKeyEnv: "SILICONFLOW_API_KEY",
    note: "SiliconFlow 语音识别，OpenAI 兼容接口。"
  },
  {
    id: "groq",
    label: "Groq Whisper",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3",
    apiKeyEnv: "GROQ_API_KEY",
    note: "Groq Whisper，OpenAI 兼容接口。"
  },
  {
    id: "custom",
    label: "自定义 OpenAI 兼容",
    baseUrl: "",
    model: "",
    apiKeyEnv: "CUSTOM_ASR_API_KEY",
    note: "任何兼容 /v1/audio/transcriptions 的服务。"
  }
];

export function findAsrPreset(id: string | undefined): AsrOpenAiPreset | undefined {
  return ASR_OPENAI_PRESETS.find((preset) => preset.id === (id || "custom"));
}

export function isAsrProviderKind(value: unknown): value is AsrProviderKind {
  return value === "auto" || value === "official" || value === "openai" || value === "local" || value === "bailian" || value === "bailian-ws";
}

/** Trim a URL-ish field and drop trailing slashes (mirrors the `openai` block). */
function normalizeUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

/** Normalize raw (YAML/UI) ASR settings; always returns a defined object. */
export function normalizeSpeechSettings(raw: unknown): SpeechAsrSettings {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const betterRecognition = source.betterRecognition === true;
  const provider = isAsrProviderKind(source.provider) ? source.provider : "auto";
  const openaiRaw = source.openai && typeof source.openai === "object" ? source.openai as Record<string, unknown> : {};
  const openai: OpenAiAsrSettings = {
    ...(typeof openaiRaw.name === "string" && openaiRaw.name.trim() ? { name: openaiRaw.name.trim() } : {}),
    baseUrl: typeof openaiRaw.baseUrl === "string" ? openaiRaw.baseUrl.trim().replace(/\/+$/, "") : "",
    apiKeyEnv: typeof openaiRaw.apiKeyEnv === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(openaiRaw.apiKeyEnv) ? openaiRaw.apiKeyEnv : "",
    model: typeof openaiRaw.model === "string" ? openaiRaw.model.trim() : "",
    ...(typeof openaiRaw.language === "string" && openaiRaw.language.trim() ? { language: openaiRaw.language.trim() } : {})
  };
  // Only emit the third-party block when it carries a usable endpoint, so an
  // untouched config stays `{ betterRecognition, provider }` without an empty
  // `openai:` mapping in the YAML.
  const hasOpenAi = Boolean(openai.baseUrl || openai.model);
  const bailianRaw = source.bailian && typeof source.bailian === "object" ? source.bailian as Record<string, unknown> : {};
  const language = typeof bailianRaw.language === "string" ? bailianRaw.language.trim() : "";
  const bailian: BailianAsrSettings = {
    ...(typeof bailianRaw.name === "string" && bailianRaw.name.trim() ? { name: bailianRaw.name.trim() } : {}),
    apiKeyEnv: typeof bailianRaw.apiKeyEnv === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(bailianRaw.apiKeyEnv) ? bailianRaw.apiKeyEnv : "",
    baseUrl: normalizeUrl(bailianRaw.baseUrl),
    wsUrl: normalizeUrl(bailianRaw.wsUrl),
    model: typeof bailianRaw.model === "string" ? bailianRaw.model.trim() : "",
    streamModel: typeof bailianRaw.streamModel === "string" ? bailianRaw.streamModel.trim() : "",
    ...(language ? { language } : {}),
    ...(bailianRaw.enableItn === true ? { enableItn: true } : {})
  };
  const hasBailian = Boolean(bailian.baseUrl || bailian.wsUrl || bailian.model || bailian.streamModel);
  return { betterRecognition, provider, ...(hasOpenAi ? { openai } : {}), ...(hasBailian ? { bailian } : {}) };
}

/** An OpenAI-compatible provider is usable when endpoint, model and key name exist. */
export function isOpenAiAsrConfigured(settings: SpeechAsrSettings | undefined): boolean {
  const openai = settings?.openai;
  return Boolean(openai && openai.baseUrl && openai.model && openai.apiKeyEnv);
}
