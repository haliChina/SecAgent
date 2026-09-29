/**
 * Shared 阿里云百炼 ASR configuration resolution.
 *
 * Values entered in the settings UI win; the workspace `.env` (already loaded
 * into `process.env` by the config layer) can supply the API key plus the
 * endpoints/models for headless setups. Documented defaults from
 * `BAILIAN_DEFAULTS` fill whatever is left empty.
 */
import { BAILIAN_DEFAULTS, type BailianAsrSettings } from "./settings.js";

export interface ResolvedBailianConfig {
  settings?: BailianAsrSettings;
  apiKey: string;
  /** OpenAI-compatible base URL for channel A (`chat/completions`). */
  baseUrl: string;
  /** Realtime WebSocket endpoint for channel B. */
  wsUrl: string;
  /** Non-streaming model name. */
  model: string;
  /** Realtime streaming model name. */
  streamModel: string;
  /** Optional language hint; absent means auto detect. */
  language?: string;
  enableItn: boolean;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function envFlag(value: string | undefined): boolean | undefined {
  const normalized = text(value).toLowerCase();
  if (!normalized) return undefined;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/** Resolve 百炼 settings/env/defaults; `null` when no API key is available. */
export function resolveBailianConfig(
  settings: BailianAsrSettings | undefined,
  getApiKey: (envName: string) => string | undefined,
  env: Record<string, string | undefined> = process.env
): ResolvedBailianConfig | null {
  const apiKey = text(getApiKey(text(settings?.apiKeyEnv) || BAILIAN_DEFAULTS.apiKeyEnv));
  if (!apiKey) return null;
  const language = text(settings?.language) || text(env.BAILIAN_LANGUAGE);
  return {
    ...(settings ? { settings } : {}),
    apiKey,
    baseUrl: (text(settings?.baseUrl) || text(env.BAILIAN_BASE_URL) || BAILIAN_DEFAULTS.baseUrl).replace(/\/+$/, ""),
    wsUrl: (text(settings?.wsUrl) || text(env.BAILIAN_WS_URL) || BAILIAN_DEFAULTS.wsUrl).replace(/\/+$/, ""),
    model: text(settings?.model) || text(env.BAILIAN_ASR_MODEL) || BAILIAN_DEFAULTS.model,
    streamModel: text(settings?.streamModel) || text(env.BAILIAN_STREAM_MODEL) || BAILIAN_DEFAULTS.streamModel,
    ...(language ? { language } : {}),
    enableItn: settings?.enableItn ?? envFlag(env.BAILIAN_ENABLE_ITN) ?? false
  };
}

/** Display name for logs and connectivity probes. */
export function bailianDisplayName(settings: BailianAsrSettings | undefined, fallback: string): string {
  return text(settings?.name) || fallback;
}