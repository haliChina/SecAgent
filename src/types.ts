import type { SpeechAsrSettings } from "./asr/settings.js";

export interface McpServerConfig {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

/** 用户保存的提示词命令：在输入框用 /名称 快速调用。 */
export interface CustomCommand {
  name: string;
  description?: string;
  prompt: string;
}

export interface ModelProfile {
  id: string;
  name?: string;
  enabled?: boolean;
  provider: "openai-compatible" | "openai-responses" | "anthropic" | "google";
  model: string;
  apiKeyEnv: string;
  baseUrl: string;
  endpoint?: string;
  anthropicVersion?: string;
  maxTokens?: number;
  /** Display name of the ProviderConfig this profile was expanded from. */
  providerName?: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  preset?: string;
  provider: ModelProfile["provider"];
  apiKeyEnv: string;
  baseUrl: string;
  endpoint?: string;
  anthropicVersion?: string;
  maxTokens?: number;
  models: Array<{ id: string; name?: string; enabled?: boolean }>;
}

export interface AgentConfig {
  provider: "openai-compatible" | "openai-responses" | "anthropic" | "google";
  model: string;
  apiKeyEnv: string;
  baseUrl: string;
  endpoint?: string;
  anthropicVersion?: string;
  maxTokens: number;
  /** Always the hardcoded SYSTEM_PROMPT from system-prompt.ts; secagent.yaml cannot override it. */
  systemPrompt: string;
  models?: ModelProfile[];
  providers?: ProviderConfig[];
}

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type UpdateChannel = "stable" | "preview";

export interface UpdatePreferences {
  channel: UpdateChannel;
  autoCheck: boolean;
  autoDownload: boolean;
  autoInstallOnQuit: boolean;
}

export interface TelemetrySettings {
  /** Master switch. When false, the client must not send telemetry requests. */
  enabled: boolean;
}

export type UpdateStatus = "unsupported" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "installing" | "error";

export interface UpdateRequestAttempt {
  phase: "metadata" | "release-api" | "checksum" | "asset";
  route: "proxy" | "direct";
  url: string;
  ok: boolean;
  status?: number;
  contentType?: string;
  responseBytes?: number;
  durationMs: number;
  error?: string;
}

export interface UpdateRelease {
  version: string;
  tag: string;
  releaseType?: "alpha" | "beta";
  channel: UpdateChannel;
  htmlUrl: string;
  body: string;
  publishedAt?: string;
  assetName: string;
  assetUrl: string;
  checksumUrl?: string;
  sha256?: string;
  size?: number;
}

export interface UpdateState {
  currentVersion: string;
  channel: UpdateChannel;
  status: UpdateStatus;
  release?: UpdateRelease;
  downloadedVersion?: string;
  downloadedBytes: number;
  totalBytes?: number;
  checkedAt?: string;
  error?: string;
  operationId?: string;
  attempts?: UpdateRequestAttempt[];
  supportReason?: string;
}

/** An image selected in the desktop composer, persisted with the user message. */
export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
}

export interface SecAgentConfig {
  version: number;
  workspace: string;
  agent: AgentConfig;
  tts?: import("./tts/types.js").TtsSettings;
  wake?: { hotkey?: string; modelId?: string; voiceEnabled?: boolean; voicePhrase?: string };
  /** Speech-to-text settings: provider preference + third-party endpoint. */
  speech?: SpeechAsrSettings;
  updates?: UpdatePreferences;
  telemetry?: TelemetrySettings;
  mcp: { servers: Record<string, McpServerConfig> };
  defaults?: { modelId?: string; reasoningEffort?: ReasoningEffort; customModelMode?: boolean; autostart?: boolean; autostartHidden?: boolean; closeWindowAction?: "tray" | "quit"; sendShortcut?: "enter" | "modEnter"; visionModelId?: string; responseTips?: boolean };
  /** 技能开关：disabled 里的技能名/相对路径不会被加载进运行时。 */
  skills?: { disabled?: string[] };
  /** 自定义命令：items 由设置页维护，输入框用 /名称 调用。 */
  commands?: { items?: CustomCommand[] };
  /** 用户自定义规则：拼进系统提示词，跨会话生效。 */
  rules?: { enabled?: boolean; text?: string };
  /** 已归档会话的自动清理策略（启动时扫描一次）。 */
  archive?: { auto?: boolean; retentionDays?: number };
  /** Model-failure resilience (retry/fallback/cooldown) — see resilience.ts. */
  resilience?: import("./resilience.js").ResilienceSettings;
  /** Sensitive tool-call confirmations — see tool-guard.ts. */
  guard?: import("./tool-guard.js").ToolGuardSettings;
  /** Tool-loop ceiling + image history pruning — see model-budget.ts. */
  budget?: import("./model-budget.js").ModelBudgetSettings;
  /** Hallucination warning strip for final answers. */
  hallucination?: { enabled?: boolean };
  /** UI theme tri-state (P3-5): light / dark / system. Invalid values fall back to light. */
  theme?: "light" | "dark" | "system";
}

/** A tool supplied by a locally installed SecAgent plugin. */
export interface PluginToolDefinition {
  key: string;
  description: string;
  inputSchema: Record<string, unknown>;
  hidden?: boolean;
}

export interface PluginStatus {
  id: string;
  format?: "secagent" | "agent";
  name: string;
  version: string;
  icon?: string;
  enabled: boolean;
  state: "inactive" | "starting" | "ready" | "error";
  message?: string;
  description?: string;
  author?: string;
  repository?: string;
  permissions?: string[];
  readme?: string;
  settingsPages: Array<{ id: string; title: string; description?: string }>;
}

export interface Student { id: number; name: string; class: string; balance: number }

export interface Preview {
  tool: "score.preview_adjust";
  student: Student;
  delta: number;
  reason: string;
  before: number;
  after: number;
}

export interface AuditRecord {
  id: string;
  createdAt: string;
  status: string;
  tool: string;
  request: string | null;
  params: string | null;
  result: string | null;
  confirmationId: string | null;
  undoOf: string | null;
}
