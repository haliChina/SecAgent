/** Settings-facing ASR configuration shared between the config layer and UI. */

/**
 * Which speech-to-text backend to use. `auto` follows the fallback chain.
 *
 * `bailian` is 阿里云百炼's OpenAI-compatible `chat/completions` ASR channel
 * (non-streaming utterances), `bailian-ws` its realtime WebSocket channel.
 */
export type AsrProviderKind = "auto" | "official" | "openai" | "local" | "bailian" | "bailian-ws" | "mimo" | "local-pro";

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

/** 小米 MiMo ASR — dedicated chat/completions + input_audio protocol. */
export interface MimoAsrSettings {
  name?: string;
  baseUrl: string;
  apiKeyEnv: string;
  model: string;
  /** "auto" | "zh" | "en" — maps to asr_options.language. */
  language?: string;
}

export const MIMO_ASR_DEFAULTS = {
  apiKeyEnv: "MIMO_API_KEY",
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: "mimo-v2.5-asr",
  language: "auto"
} as const;

/** 嘈杂环境优化（教室/希沃一体机：麦克风在屏幕顶部，远场+高噪声）。 */
export interface AsrNoiseSettings {
  /** classroom: 远场 VAD + 高噪声容忍 + 拾音增强（默认推荐）。 */
  profile?: "standard" | "classroom" | "custom";
  /** 百炼 speech_noise_threshold [-1,1]：越接近 -1 越不容易漏掉语音。 */
  speechNoiseThreshold?: number;
  /** 百炼 VAD 模型（qwen-audio 系）。 */
  vadModel?: "near_meeting_16k" | "far_field_meeting_16k";
  /** 即时热词（百炼 vocabulary；权重 50 为超级热词）。 */
  hotwords?: string[];
}

/** 输入/输出音频设备选择（"auto" 自动检测 / "default" 系统默认 / 设备 ID）。 */
export interface AsrAudioDeviceSettings {
  input?: string;
  output?: string;
}

export interface SpeechAsrSettings {
  betterRecognition?: boolean;
  provider?: AsrProviderKind;
  openai?: OpenAiAsrSettings;
  bailian?: BailianAsrSettings;
  mimo?: MimoAsrSettings;
  /** 完全自定义的回退链（按顺序尝试，例如 ["bailian-ws","mimo","local-pro","local"]）。 */
  chain?: string[];
  noise?: AsrNoiseSettings;
  audio?: AsrAudioDeviceSettings;
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
  // 小米 MiMo 已移到这里之外：它不是 /audio/transcriptions，而是专用
  // chat/completions + input_audio 协议（见 mimo-http.ts 与官方文档）。
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

export function isAsrProviderKind(value: unknown): value is AsrProviderKind {
  return value === "auto" || value === "official" || value === "openai" || value === "local" || value === "bailian" || value === "bailian-ws" || value === "mimo" || value === "local-pro";
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

  // MiMo（专用 chat/completions + input_audio 协议）。
  const mimoRaw = source.mimo && typeof source.mimo === "object" ? source.mimo as Record<string, unknown> : {};
  const mimo: MimoAsrSettings = {
    ...(typeof mimoRaw.name === "string" && mimoRaw.name.trim() ? { name: mimoRaw.name.trim() } : {}),
    baseUrl: typeof mimoRaw.baseUrl === "string" && mimoRaw.baseUrl.trim() ? normalizeUrl(mimoRaw.baseUrl) : MIMO_ASR_DEFAULTS.baseUrl,
    apiKeyEnv: typeof mimoRaw.apiKeyEnv === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(mimoRaw.apiKeyEnv) ? mimoRaw.apiKeyEnv : MIMO_ASR_DEFAULTS.apiKeyEnv,
    model: typeof mimoRaw.model === "string" && mimoRaw.model.trim() ? mimoRaw.model.trim() : MIMO_ASR_DEFAULTS.model,
    ...(typeof mimoRaw.language === "string" && mimoRaw.language.trim() ? { language: mimoRaw.language.trim() } : {})
  };
  const hasMimo = Boolean(mimo.baseUrl && mimo.model && mimo.apiKeyEnv) || mimoRaw.apiKeyEnv !== undefined || mimoRaw.baseUrl !== undefined;

  // 自定义回退链：白名单内的 provider id，按用户顺序保留。
  const chain = Array.isArray(source.chain)
    ? source.chain.filter((id): id is string => typeof id === "string" && isAsrProviderKind(id) && id !== "auto")
    : undefined;

  // 嘈杂环境参数。
  const noiseRaw = source.noise && typeof source.noise === "object" ? source.noise as Record<string, unknown> : {};
  const noise: AsrNoiseSettings | undefined = (source.noise && typeof source.noise === "object") ? {
    profile: noiseRaw.profile === "classroom" || noiseRaw.profile === "custom" ? noiseRaw.profile : "standard",
    ...(typeof noiseRaw.speechNoiseThreshold === "number" && Number.isFinite(noiseRaw.speechNoiseThreshold)
      ? { speechNoiseThreshold: Math.min(1, Math.max(-1, noiseRaw.speechNoiseThreshold)) }
      : {}),
    ...(noiseRaw.vadModel === "near_meeting_16k" || noiseRaw.vadModel === "far_field_meeting_16k" ? { vadModel: noiseRaw.vadModel } : {}),
    ...(Array.isArray(noiseRaw.hotwords)
      ? { hotwords: noiseRaw.hotwords.filter((word): word is string => typeof word === "string" && word.trim().length > 0).slice(0, 50).map((word) => word.trim()) }
      : {})
  } : undefined;

  // 输入/输出音频设备。
  const audioRaw = source.audio && typeof source.audio === "object" ? source.audio as Record<string, unknown> : {};
  const audio: AsrAudioDeviceSettings | undefined = (source.audio && typeof source.audio === "object") ? {
    ...(typeof audioRaw.input === "string" && audioRaw.input ? { input: audioRaw.input } : {}),
    ...(typeof audioRaw.output === "string" && audioRaw.output ? { output: audioRaw.output } : {})
  } : undefined;

  return {
    betterRecognition,
    provider,
    ...(hasOpenAi ? { openai } : {}),
    ...(hasBailian ? { bailian } : {}),
    ...(hasMimo ? { mimo } : {}),
    ...(chain && chain.length ? { chain } : {}),
    ...(noise ? { noise } : {}),
    ...(audio ? { audio } : {})
  };
}

/** An OpenAI-compatible provider is usable when endpoint, model and key name exist. */
export function isOpenAiAsrConfigured(settings: SpeechAsrSettings | undefined): boolean {
  const openai = settings?.openai;
  return Boolean(openai && openai.baseUrl && openai.model && openai.apiKeyEnv);
}
