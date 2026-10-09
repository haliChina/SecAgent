import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { expandPath } from "./paths.js";
import type { McpServerConfig, ModelProfile, ProviderConfig, ReasoningEffort, SecAgentConfig, TelemetrySettings, UpdatePreferences } from "./types.js";
import { normalizeSpeechSettings, type BailianAsrSettings, type MimoAsrSettings, type OpenAiAsrSettings, type SpeechAsrSettings } from "./asr/settings.js";
import type { GoogleModelInfo } from "./google-models.js";
import { DEFAULT_WAKE_HOTKEY, normalizeWakeHotkey } from "./wake-hotkey.js";
import { normalizeResilienceSettings } from "./resilience.js";
import { normalizeToolGuardSettings } from "./tool-guard.js";
import { normalizeModelBudgetSettings } from "./model-budget.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

export const DEFAULT_GOOGLE_MODEL = "gemini-2.5-flash";
export const DEFAULT_MAX_TOKENS = 16_384;
/**
 * Client-facing virtual vision model served by the official relay. The relay routes this
 * model id to a vision-capable upstream, so the client does not need to know which concrete
 * model is behind it. Only the client part lives in this repository; the relay contract is
 * documented in the README/settings help text.
 */
export const OFFICIAL_VISION_MODEL = "virtual-vision";
const ONBOARDING_MARKER = ".oobe-complete";
const OOBE_PROGRESS_FILE = ".oobe-progress.json";
const LEGACY_AGENT_MODEL_FIELDS = ["provider", "model", "apiKeyEnv", "baseUrl", "endpoint", "anthropicVersion", "maxTokens"] as const;
const WORKSPACE_RUNTIME_ENV_KEYS = new Set(["SECTL_OFFICIAL_TOKEN", "SECTL_OFFICIAL_EMAIL", "SECTL_OFFICIAL_SECTL_TOKEN", "SECTL_OFFICIAL_USER_ID"]);
/** The packaged app ships public service defaults; development uses the project .env. */
const BUNDLED_ENV_FILES = process.resourcesPath
  ? [path.join(process.resourcesPath, "official.env"), path.join(process.resourcesPath, ".env")]
  : [];
export const PROJECT_ENV_FILE = BUNDLED_ENV_FILES.find((file) => fs.existsSync(file))
  ?? path.resolve(process.cwd(), ".env");

if (fs.existsSync(PROJECT_ENV_FILE)) loadEnvFile(PROJECT_ENV_FILE, "project");
export const DEFAULT_TTS_VOICE = "zh-CN-XiaoxiaoNeural";
export const DEFAULT_TTS_RATE = "+0%";

/** TTS provider kinds allowed in the YAML block (mirror of tts/types.ts). */
const TTS_KINDS = new Set(["edge", "windows", "mimo", "bailian"]);

/**
 * Normalize the `tts:` YAML block into a full TtsSettings, keeping provider
 * and the ordered fallback chain plus per-provider sub-blocks intact.
 */
function normalizeTtsBlock(raw: unknown): import("./tts/types.js").TtsSettings {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const text = (value: unknown, fallback: string): string => (typeof value === "string" && value.trim() ? value.trim() : fallback);
  const provider = typeof source.provider === "string" && TTS_KINDS.has(source.provider) ? source.provider as "edge" | "windows" | "mimo" | "bailian" : "edge";
  const chain = Array.isArray(source.chain)
    ? (source.chain.filter((kind): kind is "edge" | "windows" | "mimo" | "bailian" => typeof kind === "string" && TTS_KINDS.has(kind)) as Array<"edge" | "windows" | "mimo" | "bailian">)
    : (["edge", "windows"] as Array<"edge" | "windows" | "mimo" | "bailian">);
  const sub = (key: string): Record<string, unknown> => source[key] && typeof source[key] === "object" ? source[key] as Record<string, unknown> : {};
  const windows = sub("windows");
  const mimo = sub("mimo");
  const bailian = sub("bailian");
  const has = (block: Record<string, unknown>): boolean => Object.keys(block).length > 0;
  return {
    provider,
    chain: chain.length ? chain : [provider],
    voice: text(source.voice, DEFAULT_TTS_VOICE),
    rate: text(source.rate, DEFAULT_TTS_RATE),
    ...(has(windows) ? { windows: { ...(typeof windows.voice === "string" && windows.voice.trim() ? { voice: windows.voice.trim() } : {}) } } : {}),
    ...(has(mimo) ? { mimo: {
      ...(typeof mimo.apiKeyEnv === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(mimo.apiKeyEnv) ? { apiKeyEnv: mimo.apiKeyEnv } : {}),
      ...(typeof mimo.baseUrl === "string" && mimo.baseUrl.trim() ? { baseUrl: mimo.baseUrl.trim().replace(/\/+$/, "") } : {}),
      ...(typeof mimo.model === "string" && mimo.model.trim() ? { model: mimo.model.trim() } : {}),
      ...(typeof mimo.voice === "string" && mimo.voice.trim() ? { voice: mimo.voice.trim() } : {}),
      ...(typeof mimo.format === "string" && mimo.format.trim() ? { format: mimo.format.trim() } : {}),
      ...(typeof mimo.voiceDescription === "string" && mimo.voiceDescription.trim() ? { voiceDescription: mimo.voiceDescription.trim() } : {})
    } } : {}),
    ...(has(bailian) ? { bailian: {
      ...(typeof bailian.apiKeyEnv === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(bailian.apiKeyEnv) ? { apiKeyEnv: bailian.apiKeyEnv } : {}),
      ...(typeof bailian.baseUrl === "string" && bailian.baseUrl.trim() ? { baseUrl: bailian.baseUrl.trim().replace(/\/+$/, "") } : {}),
      ...(typeof bailian.model === "string" && bailian.model.trim() ? { model: bailian.model.trim() } : {}),
      ...(typeof bailian.voice === "string" && bailian.voice.trim() ? { voice: bailian.voice.trim() } : {}),
      ...(typeof bailian.format === "string" && bailian.format.trim() ? { format: bailian.format.trim() } : {})
    } } : {})
  };
}
export const DEFAULT_WAKE_PHRASE = "小泽同学";
export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = { channel: "stable", autoCheck: true, autoDownload: true, autoInstallOnQuit: true };
// Installers for managed/education deployments can opt out before the first
// workspace is created without changing the user's persisted setting later.
export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = { enabled: !["0", "false", "no", "off"].includes((process.env.SECTL_TELEMETRY_DEFAULT_ENABLED || "true").toLowerCase()) };

const template = (workspace: string): SecAgentConfig => ({
  version: 1,
  workspace,
  agent: {
    models: [{
      id: "default",
      name: "gpt-5",
      provider: "openai-compatible",
      model: "gpt-5",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      endpoint: "/chat/completions",
      maxTokens: DEFAULT_MAX_TOKENS
    }]
  } as SecAgentConfig["agent"],
  tts: { provider: "edge" as const, chain: ["edge", "windows"], voice: DEFAULT_TTS_VOICE, rate: DEFAULT_TTS_RATE },
  wake: { hotkey: DEFAULT_WAKE_HOTKEY, voiceEnabled: false, voicePhrase: DEFAULT_WAKE_PHRASE },
  updates: { ...DEFAULT_UPDATE_PREFERENCES },
  telemetry: { ...DEFAULT_TELEMETRY_SETTINGS },
  mcp: { servers: {} }
});

export function configPath(workspace: string): string { return path.join(workspace, "secagent.yaml"); }

export function isOnboardingComplete(workspaceInput: string): boolean {
  return fs.existsSync(path.join(expandPath(workspaceInput), ONBOARDING_MARKER));
}

export function markOnboardingComplete(workspaceInput: string): void {
  const workspace = expandPath(workspaceInput);
  ensureWorkspaceDirectories(workspace);
  fs.writeFileSync(path.join(workspace, ONBOARDING_MARKER), "1\n", "utf8");
  clearOobeProgress(workspace);
}

export type OobeStep = "source" | "config" | "plugins";
export type OobeSource = "official" | "custom";
export interface OobeProgress {
  step: OobeStep;
  source?: OobeSource;
  provider?: Omit<ProviderConfig, "apiKey">;
}

export function oobeProgressPath(workspace: string): string { return path.join(expandPath(workspace), OOBE_PROGRESS_FILE); }

export function readOobeProgress(workspaceInput: string): OobeProgress | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(oobeProgressPath(workspaceInput), "utf8")) as Partial<OobeProgress>;
    if (raw.step !== "source" && raw.step !== "config" && raw.step !== "plugins") return undefined;
    const source = raw.source === "official" || raw.source === "custom" ? raw.source : undefined;
    const provider = raw.provider && typeof raw.provider === "object" ? raw.provider : undefined;
    return { step: raw.step, ...(source ? { source } : {}), ...(provider ? { provider } : {}) };
  } catch {
    return undefined;
  }
}

export function saveOobeProgress(workspaceInput: string, progress: OobeProgress): void {
  const workspace = expandPath(workspaceInput);
  ensureWorkspaceDirectories(workspace);
  const provider = progress.provider
    ? Object.fromEntries(Object.entries(progress.provider).filter(([key]) => key !== "apiKey")) as Omit<ProviderConfig, "apiKey">
    : undefined;
  const safeProgress: OobeProgress = {
    step: progress.step,
    ...(progress.source ? { source: progress.source } : {}),
    ...(provider ? { provider } : {})
  };
  fs.writeFileSync(oobeProgressPath(workspace), `${JSON.stringify(safeProgress, null, 2)}\n`, "utf8");
}

export function clearOobeProgress(workspaceInput: string): void {
  try { fs.rmSync(oobeProgressPath(workspaceInput), { force: true }); } catch { /* Best effort cleanup. */ }
}

/**
 * Prepare only the directory structure needed by the app.
 *
 * This is intentionally non-destructive: it never recreates deleted workspace
 * files or restores default Skills.
 */
export function ensureWorkspaceDirectories(workspace: string): void {
  fs.mkdirSync(workspace, { recursive: true });
  for (const part of ["skills", "mcp", "plugins", "sessions", "audit"]) {
    fs.mkdirSync(path.join(workspace, part), { recursive: true });
  }
}

export function initializeWorkspace(workspace: string): void {
  ensureWorkspaceDirectories(workspace);
  const file = configPath(workspace);
  if (!fs.existsSync(file)) fs.writeFileSync(file, YAML.stringify(template(workspace)), "utf8");
  const envFile = path.join(workspace, ".env");
  if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, "# 本地密钥和官方服务连接配置，不要提交或分享此文件。\nOPENAI_API_KEY=\nANTHROPIC_API_KEY=\nGEMINI_API_KEY=\nSECTL_OFFICIAL_API_URL=\nSECTL_OAUTH_API_URL=https://appwrite.sectl.cn\nSECTL_OAUTH_CALLBACK_PORT=49152\nSECTL_OFFICIAL_PLATFORM_ID=\nSECTL_OFFICIAL_CLIENT_ID=\nSECTL_OFFICIAL_TOKEN=\nSECTL_OFFICIAL_EMAIL=\nSECTL_OFFICIAL_SECTL_TOKEN=\nSECTL_OFFICIAL_USER_ID=\n", "utf8");
  removeReservedWorkspaceEnvEntries(envFile);
}

export function loadConfig(workspaceInput: string): { workspace: string; config: SecAgentConfig } {
  const workspace = expandPath(workspaceInput);
  const file = configPath(workspace);
  if (!fs.existsSync(file)) throw new Error(`未找到配置：${file}。请先执行 secagent init。`);
  const envFile = path.join(workspace, ".env");
  if (fs.existsSync(envFile)) loadWorkspaceEnv(envFile);
  const raw = YAML.parse(fs.readFileSync(file, "utf8")) as SecAgentConfig;
  return { workspace, config: normalizeAndValidate(raw, workspace) };
}

/** Workspace values intentionally override inherited shell values, but blank template entries do not. */
function loadWorkspaceEnv(envFile: string): void {
  loadEnvFile(envFile, "workspace");
}

function loadEnvFile(envFile: string, source: "project" | "workspace"): void {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !match[2]) continue;
    if (source === "workspace" && match[1].startsWith("SECTL_") && !WORKSPACE_RUNTIME_ENV_KEYS.has(match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (value) process.env[match[1]] = value;
  }
}

function removeReservedWorkspaceEnvEntries(envFile: string): void {
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return !match || !match[1].startsWith("SECTL_") || WORKSPACE_RUNTIME_ENV_KEYS.has(match[1]);
  });
  fs.writeFileSync(envFile, filtered.join("\n"), "utf8");
}

export function normalizeAndValidate(raw: SecAgentConfig, workspace: string): SecAgentConfig {
  const errors: string[] = [];
  if (raw?.version !== 1) errors.push("version 必须为 1");
  // Multi-model configuration is canonical. Populate the legacy top-level fields in memory
  // so the runtime can keep using one normalized AgentConfig shape.
  if (raw?.agent?.providers?.length) {
    raw.agent.models = raw.agent.providers.flatMap((provider) => {
      const seenModelIds = new Set<string>();
      // Drop duplicate model ids within one provider instead of failing the
      // whole save: duplicates used to abort normalizeAndValidate with a bare
      // "id 重复" error, which made every later autosave fail too until the
      // YAML was fixed by hand.
      const uniqueModels = provider.models.filter((model) => {
        if (!model?.id || seenModelIds.has(model.id)) return false;
        seenModelIds.add(model.id);
        return true;
      });
      return uniqueModels.map((model) => ({
        id: `${provider.id}:${model.id}`,
        name: model.name || model.id,
        enabled: model.enabled,
        provider: provider.provider,
        model: model.id,
        apiKeyEnv: provider.apiKeyEnv,
        baseUrl: provider.baseUrl,
        endpoint: provider.endpoint,
        anthropicVersion: provider.anthropicVersion,
        maxTokens: provider.maxTokens,
        providerName: provider.name || provider.id
      }));
    });
  }
  if (raw?.agent?.models?.length) {
    const first = raw.agent.models[0];
    raw.agent = {
      ...raw.agent,
      provider: raw.agent.provider ?? first.provider,
      model: raw.agent.model ?? first.model,
      apiKeyEnv: raw.agent.apiKeyEnv ?? first.apiKeyEnv,
      baseUrl: raw.agent.baseUrl ?? first.baseUrl,
      endpoint: raw.agent.endpoint ?? first.endpoint,
      anthropicVersion: raw.agent.anthropicVersion ?? first.anthropicVersion,
      maxTokens: raw.agent.maxTokens ?? first.maxTokens ?? DEFAULT_MAX_TOKENS
    };
  }
  // 兼容首版配置的 `openai:gpt-5` 写法，并迁移到明确的协议配置。
  const legacyAgent = raw?.agent as unknown as Record<string, unknown> | undefined;
  if (raw?.agent && !raw.agent.provider && typeof legacyAgent?.model === "string" && legacyAgent.model.startsWith("openai:")) {
    raw.agent = {
      provider: "openai-compatible",
      model: legacyAgent.model.slice("openai:".length),
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      endpoint: "/chat/completions",
      maxTokens: DEFAULT_MAX_TOKENS
    } as SecAgentConfig["agent"];
  }
  // 系统提示词写死在源码 system-prompt.ts 中，忽略工作区 YAML 里的 agent.systemPrompt。
  raw.agent.systemPrompt = SYSTEM_PROMPT;
  raw.tts = normalizeTtsBlock(raw.tts);
  raw.updates = {
    channel: raw.updates?.channel === "preview" ? "preview" : DEFAULT_UPDATE_PREFERENCES.channel,
    autoCheck: raw.updates?.autoCheck !== false,
    autoDownload: raw.updates?.autoDownload !== false,
    autoInstallOnQuit: raw.updates?.autoInstallOnQuit !== false
  };
  try { raw.wake = { hotkey: normalizeWakeHotkey(raw.wake?.hotkey || DEFAULT_WAKE_HOTKEY), ...(raw.wake?.modelId ? { modelId: raw.wake.modelId } : {}), voiceEnabled: raw.wake?.voiceEnabled === true, voicePhrase: typeof raw.wake?.voicePhrase === "string" && raw.wake.voicePhrase.trim() ? raw.wake.voicePhrase.trim() : DEFAULT_WAKE_PHRASE }; }
  catch (error) { errors.push(error instanceof Error ? error.message : "随时唤醒快捷键无效"); }
  delete (raw.agent as { systemPromptFile?: unknown }).systemPromptFile;
  if (!raw?.agent?.provider || !["openai-compatible", "openai-responses", "anthropic", "google"].includes(raw.agent.provider)) errors.push("agent.provider 必须是 openai-compatible、openai-responses、anthropic 或 google");
  if (!raw?.agent?.model && raw?.agent?.provider !== "google") errors.push("agent.model 缺失");
  if (!raw?.agent?.apiKeyEnv) errors.push("agent.apiKeyEnv 缺失");
  if (!raw?.agent?.baseUrl) errors.push("agent.baseUrl 缺失");
  if (raw?.agent?.models !== undefined && !Array.isArray(raw.agent.models)) errors.push("agent.models 必须为数组");
  if (!raw?.mcp?.servers || typeof raw.mcp.servers !== "object") errors.push("mcp.servers 缺失");
  if (errors.length) throw new Error(`配置校验失败：${errors.join("；")}`);
  raw.agent.baseUrl = raw.agent.baseUrl.replace(/\/$/, "");
  raw.agent.maxTokens = raw.agent.maxTokens || DEFAULT_MAX_TOKENS;
  // Keep the speech/ASR block canonical (no UI-only extras like raw API keys).
  raw.speech = normalizeSpeechSettings(raw.speech);
  raw.resilience = normalizeResilienceSettings(raw.resilience);
  raw.guard = normalizeToolGuardSettings(raw.guard);
  raw.budget = normalizeModelBudgetSettings(raw.budget);
  raw.hallucination = { enabled: raw.hallucination?.enabled !== false };
  for (const model of raw.agent.models ?? []) validateModelProfile(model, errors);
  if (raw.agent.models?.length) {
    const ids = new Set<string>();
    for (const model of raw.agent.models) {
      if (ids.has(model.id)) errors.push(`agent.models.id 重复：${model.id}${model.providerName ? `（提供商「${model.providerName}」）` : ""}`);
      ids.add(model.id);
      model.name = model.name?.trim() || model.model;
      model.baseUrl = model.baseUrl.replace(/\/$/, "");
      model.maxTokens = model.maxTokens || raw.agent.maxTokens;
    }
  }
  if (errors.length) throw new Error(`配置校验失败：${errors.join("；")}`);
  delete (raw as SecAgentConfig & { policy?: unknown }).policy;
  raw.workspace = workspace;
  return raw;
}

function validateModelProfile(model: ModelProfile, errors: string[]): void {
  if (!model?.id) errors.push("agent.models[].id 缺失");
  if (!model?.model && model?.provider !== "google") errors.push(`agent.models[${model?.id || "?"}].model 缺失`);
  if (!model?.provider || !["openai-compatible", "openai-responses", "anthropic", "google"].includes(model.provider)) errors.push(`agent.models[${model?.id || "?"}].provider 无效`);
  if (!model?.apiKeyEnv) errors.push(`agent.models[${model?.id || "?"}].apiKeyEnv 缺失`);
  if (!model?.baseUrl) errors.push(`agent.models[${model?.id || "?"}].baseUrl 缺失`);
}

export interface ModelOption {
  id: string;
  name: string;
  model: string;
  provider: SecAgentConfig["agent"]["provider"];
  /** Display name of the provider this model belongs to, used to group the model pickers. */
  providerLabel?: string;
}

function commaValues(value: string | undefined): string[] {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function configuredModels(config: SecAgentConfig, googleModels: GoogleModelInfo[] = []): ModelOption[] {
  const profiles = config.agent.models?.length ? config.agent.models : [{ id: "default", name: config.agent.model, model: config.agent.model, provider: config.agent.provider, apiKeyEnv: config.agent.apiKeyEnv, baseUrl: config.agent.baseUrl } as ModelProfile];
  const options: ModelOption[] = [];
  for (const profile of profiles) {
    if (profile.enabled === false) continue;
    const providerLabel = profile.providerName || profile.id;
    const configuredNames = commaValues(profile.name);
    const configuredModelNames = commaValues(profile.model);
    // Every provider gets its own entry now. Previously only the first Google
    // profile was expanded (`googleSeen`) and later Google providers — e.g. an
    // official key plus a relay — silently lost all of their models.
    if (profile.provider !== "google" || !googleModels.length) {
      const modelNames = configuredModelNames.length ? configuredModelNames : [""];
      modelNames.forEach((modelName, index) => options.push({ id: index ? `${profile.id}#${index}` : profile.id, name: configuredNames[index] || configuredNames[0] || modelName || "Google Gemini（自动选择）", model: modelName, provider: profile.provider, providerLabel }));
      continue;
    }
    if (configuredModelNames.length) {
      configuredModelNames.forEach((modelName, index) => options.push({ id: index ? `${profile.id}#${index}` : profile.id, name: configuredNames[index] || configuredNames[0] || modelName, model: modelName, provider: profile.provider, providerLabel }));
      continue;
    }
    for (const model of googleModels) {
      const modelName = model.name?.replace(/^models\//, "");
      if (!modelName) continue;
      options.push({ id: `google:${profile.id}:${modelName}`, name: model.displayName || modelName, model: modelName, provider: "google", providerLabel });
    }
  }
  return options;
}

export function useConfiguredModel(config: SecAgentConfig, id?: string): void {
  if (!id || !config.agent.models?.length) return;
  const dynamicPrefix = id.startsWith("google:") ? "google:" : id.startsWith("official:") ? "official:" : "";
  const separator = dynamicPrefix ? id.indexOf(":", dynamicPrefix.length) : -1;
  const dynamicModel = separator > 0 ? id.slice(separator + 1) : undefined;
  const profileId = separator > 0 ? id.slice(dynamicPrefix.length, separator) : id.split("#")[0];
  const profileIndex = id.includes("#") ? Number(id.slice(id.indexOf("#") + 1)) : 0;
  const selected = config.agent.models.find((model) => model.id === profileId) ?? (profileId ? config.agent.models.find((model) => model.id.startsWith(`${profileId}:`)) : undefined) ?? (id === "default" ? config.agent.models[0] : undefined);
  if (!selected) throw new Error(`未找到配置模型：${id}`);
  const selectedModels = commaValues(selected.model);
  config.agent = { ...config.agent, ...selected, model: dynamicModel || selectedModels[profileIndex] || selectedModels[0] || DEFAULT_GOOGLE_MODEL, maxTokens: selected.maxTokens || config.agent.maxTokens, systemPrompt: config.agent.systemPrompt, models: config.agent.models };
}

/**
 * Return a copy of the config with `agent` resolved to the given model id, without
 * mutating the caller's config. Unlike `useConfiguredModel`, this is safe to call for
 * a secondary (e.g. vision) model while the main session keeps using its own model.
 */
export function resolveModelConfig(config: SecAgentConfig, modelId: string): SecAgentConfig {
  const next = { ...config, agent: { ...config.agent } };
  useConfiguredModel(next, modelId);
  if (!next.agent.models?.length) throw new Error(`未找到配置模型：${modelId}`);
  return next;
}

/**
 * Resolve the dedicated image-recognition model config, if any.
 * 1. An explicitly configured `defaults.visionModelId` wins.
 * 2. In official (non-custom) mode, fall back to the relay's virtual-vision model so
 *    the feature works without any manual setup.
 * Returns undefined when no vision model is configured or the id is stale — the vision
 * tool is then simply not exposed to the main agent.
 */
export function resolveVisionAgentConfig(config: SecAgentConfig): SecAgentConfig | undefined {
  const id = config.defaults?.visionModelId;
  if (id) {
    try { return resolveModelConfig(config, id); }
    catch { return undefined; }
  }
  if (config.defaults?.customModelMode === false
      && process.env.SECTL_OFFICIAL_TOKEN
      && config.agent.models?.some((model) => model.id.startsWith("sectl-official:"))) {
    try { return resolveModelConfig(config, `official:sectl-official:${OFFICIAL_VISION_MODEL}`); }
    catch { return undefined; }
  }
  return undefined;
}

export interface SettingsPayload {
  providers: Array<ProviderConfig & { apiKey?: string; apiKeyConfigured?: boolean }>;
  /** Compatibility field for older IPC callers; the settings UI uses providers. */
  models: Array<ModelProfile & { apiKey?: string; apiKeyConfigured?: boolean }>;
  tts: import("./tts/types.js").TtsSettings & { mimo?: import("./tts/types.js").MimoTtsSettings & { apiKey?: string; apiKeyConfigured?: boolean }; bailian?: import("./tts/types.js").BailianTtsSettings & { apiKey?: string; apiKeyConfigured?: boolean } };
  wake: { hotkey: string; modelId?: string; voiceEnabled?: boolean; voicePhrase?: string };
  /**
   * Speech-to-text settings; `openai.apiKey`/`bailian.apiKey` and their
   * `apiKeyConfigured` flags are UI-only extras (keys live in the workspace .env).
   */
  speech: SpeechAsrSettings & { openai?: OpenAiAsrSettings & { apiKey?: string; apiKeyConfigured?: boolean }; bailian?: BailianAsrSettings & { apiKey?: string; apiKeyConfigured?: boolean }; mimo?: MimoAsrSettings & { apiKey?: string; apiKeyConfigured?: boolean } };
  updates: UpdatePreferences;
  telemetry: TelemetrySettings;
  mcp: { servers: Record<string, McpServerConfig> };
  defaultModelId?: string;
  defaultReasoningEffort?: ReasoningEffort;
  /** Model used by the dedicated image-recognition tool when the main model has no vision input. */
  visionModelId?: string;
  autostart?: boolean;
  /** On by default: an autostart launch stays in the tray instead of opening the main window. */
  autostartHidden?: boolean;
  /** Off by default: custom providers are ignored and the official service (login) is required. */
  customModelMode?: boolean;
  resilience?: import("./resilience.js").ResilienceSettings;
  guard?: import("./tool-guard.js").ToolGuardSettings;
  budget?: import("./model-budget.js").ModelBudgetSettings;
  hallucinationEnabled?: boolean;
}

export function readSettings(workspaceInput: string): SettingsPayload {
  const { config } = loadConfig(workspaceInput);
  const configured = config.agent.models?.length
    ? config.agent.models
    : [{
      id: "default",
      name: config.agent.model,
      provider: config.agent.provider,
      model: config.agent.model,
      apiKeyEnv: config.agent.apiKeyEnv,
      baseUrl: config.agent.baseUrl,
      endpoint: config.agent.endpoint,
      anthropicVersion: config.agent.anthropicVersion,
      maxTokens: config.agent.maxTokens
    }];
  const providers = config.agent.providers?.length ? config.agent.providers : groupLegacyModels(configured);
  const speech = normalizeSpeechSettings(config.speech);
  return { providers: providers.map((provider) => ({ ...provider, apiKeyConfigured: Boolean(process.env[provider.apiKeyEnv]) })), models: configured.map((model) => ({ ...model, apiKeyConfigured: Boolean(process.env[model.apiKeyEnv]) })), tts: { ...normalizeTtsBlock(config.tts), ...(config.tts?.mimo ? { mimo: { ...config.tts.mimo, apiKeyConfigured: Boolean(config.tts.mimo.apiKeyEnv && process.env[config.tts.mimo.apiKeyEnv]) } } : {}), ...(config.tts?.bailian ? { bailian: { ...config.tts.bailian, apiKeyConfigured: Boolean(process.env[config.tts.bailian.apiKeyEnv || "BAILIAN_API_KEY"]) } } : {}) }, wake: { hotkey: config.wake?.hotkey || DEFAULT_WAKE_HOTKEY, ...(config.wake?.modelId ? { modelId: config.wake.modelId } : {}), voiceEnabled: config.wake?.voiceEnabled === true, voicePhrase: config.wake?.voicePhrase || DEFAULT_WAKE_PHRASE }, speech: { ...speech, ...(speech.openai ? { openai: { ...speech.openai, apiKeyConfigured: Boolean(speech.openai.apiKeyEnv && process.env[speech.openai.apiKeyEnv]) } } : {}), ...(speech.bailian ? { bailian: { ...speech.bailian, apiKeyConfigured: Boolean(process.env[speech.bailian.apiKeyEnv || "BAILIAN_API_KEY"]) } } : {}), ...(speech.mimo ? { mimo: { ...speech.mimo, apiKeyConfigured: Boolean(process.env[speech.mimo.apiKeyEnv || "MIMO_API_KEY"]) } } : {}) }, updates: { ...(config.updates || DEFAULT_UPDATE_PREFERENCES) }, telemetry: { enabled: config.telemetry?.enabled !== false }, mcp: config.mcp, defaultModelId: config.defaults?.modelId, defaultReasoningEffort: config.defaults?.reasoningEffort, visionModelId: config.defaults?.visionModelId, autostart: config.defaults?.autostart === true, autostartHidden: config.defaults?.autostartHidden !== false, customModelMode: config.defaults?.customModelMode ?? false, resilience: normalizeResilienceSettings(config.resilience), guard: normalizeToolGuardSettings(config.guard), budget: normalizeModelBudgetSettings(config.budget), hallucinationEnabled: config.hallucination?.enabled !== false };
}

function groupLegacyModels(models: ModelProfile[]): ProviderConfig[] {
  const groups = new Map<string, ProviderConfig>();
  for (const model of models) {
    const id = model.id.includes(":") ? model.id.split(":")[0] : model.id;
    const existing = groups.get(id);
    const provider = existing || { id, name: model.name || id, provider: model.provider, apiKeyEnv: model.apiKeyEnv, baseUrl: model.baseUrl, endpoint: model.endpoint, anthropicVersion: model.anthropicVersion, maxTokens: model.maxTokens, models: [] };
    provider.models.push({ id: model.model, name: model.name || model.model });
    groups.set(id, provider);
  }
  return [...groups.values()];
}

/**
 * Derive a stable, filesystem-safe env-var name for a provider from its name
 * (or baseUrl host when the name has no ASCII letters, e.g. Chinese-only).
 * Users never see or type this name — it only lives in the workspace .env.
 */
function deriveEnvName(name: string, baseUrl: string): string {
  const slug = (source: string) => source.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase().slice(0, 32);
  const fromName = slug(name);
  if (fromName) return `SECAGENT_${fromName}_API_KEY`;
  try {
    const host = slug(new URL(baseUrl).hostname.replace(/\./g, "_"));
    if (host) return `SECAGENT_${host}_API_KEY`;
  } catch { /* invalid/empty baseUrl — fall through */ }
  return "SECAGENT_CUSTOM_API_KEY";
}

/** Legacy placeholder the old "new provider" form used to plant into the config. */
const LEGACY_DEFAULT_PROVIDER_ENVS = new Set(["CUSTOM_API_KEY"]);

export function saveSettings(workspaceInput: string, payload: SettingsPayload): SettingsPayload {
  const workspace = expandPath(workspaceInput);
  const file = configPath(workspace);
  const raw = YAML.parse(fs.readFileSync(file, "utf8")) as SecAgentConfig;
  const inputProviders: Array<ProviderConfig & { apiKey?: string; apiKeyConfigured?: boolean }> = Array.isArray(payload?.providers) && payload.providers.length ? payload.providers : groupLegacyModels(payload?.models || []);
  if (!inputProviders.length) throw new Error("至少需要配置一个提供商");
  if (!payload.mcp?.servers || typeof payload.mcp.servers !== "object") throw new Error("MCP 服务配置无效");
  // The env-var name used to be a manual text field in the settings UI, which
  // forced users to invent a valid identifier before an API key could be
  // saved. Auto-derive one instead whenever it is missing or still the legacy
  // placeholder; explicitly configured names (yaml, presets) are preserved.
  const takenEnvs = new Set(inputProviders.map((provider) => provider.apiKeyEnv).filter(Boolean));
  for (const provider of inputProviders) {
    const current = provider.apiKeyEnv?.trim() || "";
    if (current && !LEGACY_DEFAULT_PROVIDER_ENVS.has(current)) continue;
    let generated = deriveEnvName(provider.name || "", provider.baseUrl || "");
    if (takenEnvs.has(generated) && current !== generated) {
      let suffix = 2;
      while (takenEnvs.has(`${generated}_${suffix}`)) suffix++;
      generated = `${generated}_${suffix}`;
    }
    takenEnvs.add(generated);
    provider.apiKeyEnv = generated;
  }
  const providers = inputProviders.map(({ apiKey, apiKeyConfigured: _apiKeyConfigured, ...provider }) => {
    if (typeof apiKey === "string" && apiKey.trim()) writeWorkspaceEnv(workspace, provider.apiKeyEnv, apiKey.trim());
    return provider;
  });
  // Two providers sharing one env var used to silently overwrite each other's
  // API key (last write wins in .env), which looked like "I fixed the key but
  // the other provider broke". Refuse ambiguous saves with an explicit error.
  const envOwners = new Map<string, string>();
  for (const provider of providers) {
    const owner = envOwners.get(provider.apiKeyEnv);
    if (owner && owner !== provider.name) throw new Error(`提供商「${owner}」和「${provider.name}」使用了相同的环境变量 ${provider.apiKeyEnv}，请为其中一个改用独立变量名，否则 API Key 会互相覆盖`);
    envOwners.set(provider.apiKeyEnv, provider.name);
  }
  const models = providers.flatMap((provider) => provider.models.map((model) => ({ id: `${provider.id}:${model.id}`, name: model.name || model.id, enabled: model.enabled, provider: provider.provider, model: model.id, apiKeyEnv: provider.apiKeyEnv, baseUrl: provider.baseUrl, endpoint: provider.endpoint, anthropicVersion: provider.anthropicVersion, maxTokens: provider.maxTokens })));
  // TTS: keep the full provider/fallback-chain block (voice/rate stay shared).
  const nextTts = normalizeTtsBlock(payload.tts);
  // TTS API keys follow the same env-var convention as model providers.
  const inputTtsMimo = payload.tts?.mimo;
  if (inputTtsMimo && typeof (inputTtsMimo as { apiKey?: string }).apiKey === "string" && (inputTtsMimo as { apiKey?: string }).apiKey!.trim()) {
    const envName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(inputTtsMimo.apiKeyEnv || "") ? inputTtsMimo.apiKeyEnv! : "MIMO_TTS_API_KEY";
    inputTtsMimo.apiKeyEnv = envName;
    writeWorkspaceEnv(workspace, envName, (inputTtsMimo as { apiKey?: string }).apiKey!.trim());
  }
  const inputTtsBailian = payload.tts?.bailian;
  if (inputTtsBailian && typeof (inputTtsBailian as { apiKey?: string }).apiKey === "string" && (inputTtsBailian as { apiKey?: string }).apiKey!.trim()) {
    const envName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(inputTtsBailian.apiKeyEnv || "") ? inputTtsBailian.apiKeyEnv! : "BAILIAN_TTS_API_KEY";
    inputTtsBailian.apiKeyEnv = envName;
    writeWorkspaceEnv(workspace, envName, (inputTtsBailian as { apiKey?: string }).apiKey!.trim());
  }
  const nextWake = { hotkey: normalizeWakeHotkey(payload.wake?.hotkey || DEFAULT_WAKE_HOTKEY), ...(payload.wake?.modelId ? { modelId: payload.wake.modelId } : {}), voiceEnabled: payload.wake?.voiceEnabled === true, voicePhrase: payload.wake?.voicePhrase?.trim() || DEFAULT_WAKE_PHRASE };
  const canonicalAgent = { ...(raw.agent as unknown as Record<string, unknown>), providers, models } as SecAgentConfig["agent"];
  for (const field of LEGACY_AGENT_MODEL_FIELDS) delete (canonicalAgent as unknown as Record<string, unknown>)[field];
  // 系统提示词写死在源码中，保存时从工作区配置文件里移除该键。
  delete (canonicalAgent as { systemPrompt?: unknown }).systemPrompt;
  const candidateAgent = { ...canonicalAgent, models: models.map((model) => ({ ...model })) } as SecAgentConfig["agent"];
  // Third-party ASR keys follow the same env-var convention as model providers.
  // The env-var name is no longer a visible form field; auto-assign a stable
  // default whenever the payload arrives without a valid one.
  const inputOpenAi = payload.speech?.openai;
  if (inputOpenAi && typeof inputOpenAi.apiKey === "string" && inputOpenAi.apiKey.trim()) {
    let envName = (inputOpenAi.apiKeyEnv || "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) envName = "SECAGENT_ASR_KEY";
    inputOpenAi.apiKeyEnv = envName;
    writeWorkspaceEnv(workspace, envName, inputOpenAi.apiKey.trim());
  }
  // 百炼 uses the documented BAILIAN_API_KEY name so headless .env setups and
  // the settings UI share one variable.
  const inputBailian = payload.speech?.bailian;
  if (inputBailian && typeof inputBailian.apiKey === "string" && inputBailian.apiKey.trim()) {
    let envName = (inputBailian.apiKeyEnv || "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) envName = "BAILIAN_API_KEY";
    inputBailian.apiKeyEnv = envName;
    writeWorkspaceEnv(workspace, envName, inputBailian.apiKey.trim());
  }
  // MiMo ASR key: same convention, MIMO_API_KEY by default.
  const inputMimo = payload.speech?.mimo;
  if (inputMimo && typeof (inputMimo as { apiKey?: string }).apiKey === "string" && (inputMimo as { apiKey?: string }).apiKey!.trim()) {
    const envName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(inputMimo.apiKeyEnv || "") ? inputMimo.apiKeyEnv! : "MIMO_API_KEY";
    inputMimo.apiKeyEnv = envName;
    writeWorkspaceEnv(workspace, envName, (inputMimo as { apiKey?: string }).apiKey!.trim());
  }
  const nextSpeech = normalizeSpeechSettings(payload.speech);
  const currentUpdates = raw.updates || DEFAULT_UPDATE_PREFERENCES;
  const nextUpdates: UpdatePreferences = { channel: payload.updates?.channel === "preview" ? "preview" : payload.updates?.channel === "stable" ? "stable" : currentUpdates.channel, autoCheck: payload.updates ? payload.updates.autoCheck !== false : currentUpdates.autoCheck, autoDownload: payload.updates ? payload.updates.autoDownload !== false : currentUpdates.autoDownload, autoInstallOnQuit: payload.updates ? payload.updates.autoInstallOnQuit !== false : currentUpdates.autoInstallOnQuit };
  const nextTelemetry: TelemetrySettings = { enabled: payload.telemetry?.enabled !== false };
  const candidate: SecAgentConfig = { ...raw, agent: candidateAgent, tts: nextTts, wake: nextWake, speech: nextSpeech, updates: nextUpdates, telemetry: nextTelemetry, mcp: payload.mcp };
  delete (candidate as SecAgentConfig & { policy?: unknown }).policy;
  // Validate a normalized copy, then persist only the canonical multi-model fields.
  normalizeAndValidate(candidate, workspace);
  canonicalAgent.models = candidate.agent.models;
  raw.agent = canonicalAgent;
  raw.tts = nextTts;
  raw.wake = nextWake;
  raw.speech = nextSpeech;
  raw.updates = nextUpdates;
  raw.telemetry = nextTelemetry;
  raw.mcp = payload.mcp;
  raw.defaults = { modelId: payload.defaultModelId || undefined, reasoningEffort: payload.defaultReasoningEffort || undefined, customModelMode: Boolean(payload.customModelMode), autostart: payload.autostart === true, autostartHidden: payload.autostartHidden !== false, visionModelId: payload.visionModelId || undefined };
  raw.resilience = normalizeResilienceSettings(payload.resilience);
  raw.guard = normalizeToolGuardSettings(payload.guard);
  raw.budget = normalizeModelBudgetSettings(payload.budget);
  raw.hallucination = { enabled: payload.hallucinationEnabled !== false };
  delete (raw as SecAgentConfig & { policy?: unknown }).policy;
  fs.writeFileSync(file, YAML.stringify(raw), "utf8");
  return readSettings(workspace);
}

export function writeWorkspaceEnv(workspace: string, name: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`API Key 环境变量名无效：${name}`);
  if (/[\r\n]/.test(value)) throw new Error("API Key 不能包含换行符");
  const file = path.join(workspace, ".env");
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const next = `${name}=${value}`;
  const index = lines.findIndex((line) => line.match(new RegExp(`^\\s*${name}\\s*=`)));
  if (index >= 0) lines[index] = next;
  else lines.push(next);
  fs.writeFileSync(file, `${lines.filter((line, item) => item !== lines.length - 1 || line).join("\n").replace(/\n*$/, "\n")}`, "utf8");
  process.env[name] = value;
}
