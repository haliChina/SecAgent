/** Settings-facing ASR configuration shared between the config layer and UI. */

/** Which speech-to-text backend to use. `auto` follows the fallback chain. */
export type AsrProviderKind = "auto" | "official" | "openai" | "local";

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

export interface SpeechAsrSettings {
  betterRecognition?: boolean;
  provider?: AsrProviderKind;
  openai?: OpenAiAsrSettings;
}

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
  return value === "auto" || value === "official" || value === "openai" || value === "local";
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
  return { betterRecognition, provider, ...(hasOpenAi ? { openai } : {}) };
}

/** An OpenAI-compatible provider is usable when endpoint, model and key name exist. */
export function isOpenAiAsrConfigured(settings: SpeechAsrSettings | undefined): boolean {
  const openai = settings?.openai;
  return Boolean(openai && openai.baseUrl && openai.model && openai.apiKeyEnv);
}
