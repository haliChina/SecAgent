interface SessionMeta { id: string; title: string; createdAt: string; updatedAt: string; preview?: string }
interface ToolCallRecord { name: string; arguments: unknown; result?: unknown }
type AssistantActivity = { kind: "thinking" | "summary" | "text"; content: string; turn?: number } | { kind: "skill-auto-load"; name: string; path: string } | { kind: "tool"; name: string; arguments: unknown; result?: unknown }
interface ChatAttachment { id: string; name: string; mimeType: string; dataUrl: string; size: number }
interface SessionMessage { id: string; role: "user" | "assistant"; content: string; createdAt: string; attachments?: ChatAttachment[]; toolCalls?: ToolCallRecord[]; activities?: AssistantActivity[]; stopped?: boolean; hallucination?: { score: number; signals: Array<{ id: string; detail: string }> } }
interface SessionData { meta: SessionMeta; messages: SessionMessage[] }
interface SessionRuntimeEvent { sessionId: string; sequence: number; at: string; stage: string; data: unknown }
type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type UpdateChannel = "stable" | "preview";
type UpdateStatus = "unsupported" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "installing" | "error";
interface UpdatePreferences { channel: UpdateChannel; autoCheck: boolean; autoDownload: boolean; autoInstallOnQuit: boolean }
interface UpdateRelease { version: string; tag: string; releaseType?: "alpha" | "beta"; channel: UpdateChannel; htmlUrl: string; body: string; publishedAt?: string; assetName: string; assetUrl: string; checksumUrl?: string; sha256?: string; size?: number }
interface UpdateRequestAttempt { phase: "metadata" | "release-api" | "checksum" | "asset"; route: "proxy" | "direct"; url: string; ok: boolean; status?: number; contentType?: string; responseBytes?: number; durationMs: number; error?: string }
interface UpdateState { currentVersion: string; channel: UpdateChannel; status: UpdateStatus; release?: UpdateRelease; downloadedVersion?: string; downloadedBytes: number; totalBytes?: number; checkedAt?: string; error?: string; operationId?: string; attempts?: UpdateRequestAttempt[]; supportReason?: string }
interface ModelOption { id: string; name: string; model: string; provider: string; virtual?: boolean; providerLabel?: string; vision?: boolean }
interface ModelProfile { id: string; name?: string; enabled?: boolean; provider: "openai-compatible" | "openai-responses" | "anthropic" | "google"; model: string; apiKeyEnv: string; apiKey?: string; apiKeyConfigured?: boolean; baseUrl: string; endpoint?: string; anthropicVersion?: string; maxTokens?: number }
interface McpServerConfig { transport: "stdio" | "http"; command?: string; args?: string[]; url?: string; enabled: boolean }
interface ProviderModel { id: string; name?: string; enabled?: boolean }
interface ProviderConfig { id: string; name: string; preset?: string; provider: ModelProfile["provider"]; apiKeyEnv: string; apiKey?: string; apiKeyConfigured?: boolean; baseUrl: string; endpoint?: string; anthropicVersion?: string; maxTokens?: number; models: ProviderModel[] }
interface ProviderPreset { id: string; name: string; env: string[]; api: string; models: ProviderModel[] }
interface TelemetrySettings { enabled: boolean }
type AsrProviderKind = "auto" | "official" | "openai" | "local" | "bailian" | "bailian-ws" | "mimo" | "local-pro";
interface OpenAiAsrSettings { name?: string; baseUrl: string; apiKeyEnv: string; model: string; language?: string; apiKey?: string; apiKeyConfigured?: boolean }
interface BailianAsrSettings { name?: string; apiKeyEnv: string; baseUrl: string; wsUrl: string; model: string; streamModel: string; language?: string; enableItn?: boolean; apiKey?: string; apiKeyConfigured?: boolean }
interface MimoAsrSettings { name?: string; baseUrl: string; apiKeyEnv: string; model: string; language?: string; apiKey?: string; apiKeyConfigured?: boolean }
interface AsrNoiseSettings { profile?: "standard" | "classroom" | "custom"; speechNoiseThreshold?: number; vadModel?: "near_meeting_16k" | "far_field_meeting_16k"; hotwords?: string[] }
interface AsrAudioDeviceSettings { input?: string; output?: string }
interface SpeechAsrSettings { betterRecognition?: boolean; provider?: AsrProviderKind; openai?: OpenAiAsrSettings; bailian?: BailianAsrSettings; mimo?: MimoAsrSettings; chain?: string[]; noise?: AsrNoiseSettings; audio?: AsrAudioDeviceSettings }
interface TtsProviderSettings { provider: "edge" | "windows" | "mimo" | "bailian"; chain?: Array<"edge" | "windows" | "mimo" | "bailian">; voice: string; rate: string; windows?: { voice?: string }; mimo?: { apiKeyEnv?: string; baseUrl?: string; model?: string; voice?: string; format?: string; voiceDescription?: string; apiKey?: string; apiKeyConfigured?: boolean }; bailian?: { apiKeyEnv?: string; baseUrl?: string; model?: string; voice?: string; format?: string; apiKey?: string; apiKeyConfigured?: boolean } }
interface ResilienceSettings { autoRetry: boolean; fallbackEnabled: boolean; fallbackModelIds?: string[]; rememberFailures: boolean; cooldownBaseMinutes: number; quotaCooldownMinutes: number }
interface ToolGuardSettings { enabled: boolean; approved: string[] }
interface ModelBudgetSettings { maxToolTurns: number; keepRecentImages: number }
interface SettingsPayload { providers: ProviderConfig[]; models: ModelProfile[]; tts: TtsProviderSettings; wake: { hotkey: string; modelId?: string; voiceEnabled?: boolean; voicePhrase?: string }; speech: SpeechAsrSettings; updates: UpdatePreferences; telemetry: TelemetrySettings; mcp: { servers: Record<string, McpServerConfig> }; defaultModelId?: string; defaultReasoningEffort?: ReasoningEffort; visionModelId?: string; autostart?: boolean; autostartHidden?: boolean; customModelMode?: boolean; resilience?: ResilienceSettings; guard?: ToolGuardSettings; budget?: ModelBudgetSettings; hallucinationEnabled?: boolean }
interface SkillSummary { name: string; description: string; path: string }
interface PluginStatus { id: string; format?: "secagent" | "agent"; name: string; version: string; icon?: string; enabled: boolean; state: "inactive" | "starting" | "error" | "ready"; message?: string; description?: string; author?: string; repository?: string; permissions?: string[]; readme?: string; settingsPages: Array<{ id: string; title: string; description?: string }> }
interface MarketplaceVersion { version: string; minHostApiVersion: number; assetUrl: string; sha256: string; permissions: string[]; platforms: string[] }
interface MarketplacePlugin { id: string; format?: "secagent" | "agent"; name: string; description: string; repository: string; icon?: string; readme?: string; latest?: MarketplaceVersion; releaseError?: string }
interface DetectedCompanionApp { pluginId: string; appName: string; description: string; icon: string; detected: boolean; evidence?: string }
interface ClassIslandInstallCandidate { id: string; executablePath: string; rootPath: string; dataRoot: string; pluginPackagesPath: string; version?: string; installedPluginVersion?: string; pluginHealthy?: boolean; packageType?: string; isRunning: boolean; pid?: number; processIds?: number[]; launchArgs: string[]; source: string; compatible: boolean; reason?: string }
interface ClassIslandInstallResult { targetId: string; ok: boolean; action: "installed" | "already-installed" | "skipped" | "failed"; message: string; version?: string }
type ClassIslandInstallPhase = "downloading" | "verifying" | "installing" | "closing" | "restarting";
interface ClassIslandInstallProgress { phase: "downloading" | "verifying" | "installing" | "closing" | "restarting"; targetIds: string[]; percent?: number; message?: string }
interface SecRandomInstallCandidate { id: string; executablePath: string; rootPath: string; dataRoot: string; pluginPackagesPath: string; version?: string; installedPluginVersion?: string; pluginHealthy?: boolean; healthReason?: string; packageType?: string; isRunning: boolean; pid?: number; launchArgs: string[]; source: string; compatible: boolean; reason?: string }
interface SecRandomInstallResult { targetId: string; ok: boolean; action: "installed" | "already-installed" | "skipped" | "failed"; message: string; version?: string }
interface SecRandomInstallProgress { phase: "downloading" | "verifying" | "installing" | "closing" | "restarting"; targetIds: string[]; percent?: number; message?: string }
interface IccceInstallCandidate { id: string; executablePath: string; rootPath: string; pluginPackagesPath: string; pluginsPath: string; version?: string; installedPluginVersion?: string; pluginHealthy?: boolean; packageType?: string; isRunning: boolean; pid?: number; launchArgs: string[]; source: string; compatible: boolean; reason?: string }
interface IccceInstallResult { targetId: string; ok: boolean; action: "installed" | "already-installed" | "skipped" | "failed"; message: string; version?: string }
interface IccceInstallProgress { phase: "downloading" | "verifying" | "installing" | "closing" | "restarting"; targetIds: string[]; percent?: number; message?: string }
interface ClassWidgetsInstallCandidate { id: string; executablePath: string; rootPath: string; pluginsPath: string; version?: string; installedPluginVersion?: string; pluginHealthy?: boolean; isRunning: boolean; pid?: number; processIds?: number[]; launchArgs: string[]; source: string; compatible: boolean; reason?: string }
interface ClassWidgetsInstallResult { targetId: string; ok: boolean; action: "installed" | "already-installed" | "skipped" | "failed"; message: string; version?: string }
interface ClassWidgetsInstallProgress { phase: "downloading" | "verifying" | "installing" | "closing" | "restarting"; targetIds: string[]; percent?: number; message?: string }
interface OobeProgress { step: "source" | "config" | "plugins"; source?: "official" | "custom"; provider?: Omit<ProviderConfig, "apiKey"> }
interface Window {
  secagent: {
    platform: NodeJS.Platform;
  telemetryConfig: { sentryDsn?: string; enabled: boolean };
    listSessions(): Promise<SessionMeta[]>;
    listModels(): Promise<ModelOption[]>;
    listProviders(): Promise<ProviderPreset[]>;
    getSettings(): Promise<SettingsPayload>;
    openSettings(): Promise<{ ok: true }>;
    getUpdateState(): Promise<UpdateState>;
    checkForUpdate(): Promise<UpdateState>;
    downloadUpdate(): Promise<UpdateState>;
    installUpdate(): Promise<UpdateState>;
    openDiagnosticLogs(): Promise<string>;
    exportDiagnosticLogs(): Promise<{ canceled: boolean; path?: string }>;
    officialStatus(): Promise<{ loggedIn: boolean; email: string }>;
    officialBalance(): Promise<{ points: number | null; balances: Array<{ points: number; expiresAt: string | null }>; expired: boolean }>;
    officialRedeem(code: string): Promise<{ pointsAdded: number; expiresAt: string | null; balance: number | null; balances: Array<{ points: number; expiresAt: string | null }> }>;
    officialOAuthLogin(): Promise<SettingsPayload>;
    officialLogout(): Promise<{ loggedIn: boolean }>;
    saveSettings(payload: SettingsPayload): Promise<SettingsPayload>;
    listSkills(): Promise<SkillSummary[]>;
    openSkillsDirectory(): Promise<string>;
    listPlugins(): Promise<PluginStatus[]>;
    callPluginSettings(pluginId: string, pageId: string, action: string, args?: unknown): Promise<any>;
    setPluginEnabled(id: string, enabled: boolean): Promise<PluginStatus[]>;
    reloadPlugin(id: string): Promise<PluginStatus[]>;
    uninstallPlugin(id: string): Promise<PluginStatus[]>;
    installPlugin(): Promise<PluginStatus[]>;
    listMarketplace(): Promise<MarketplacePlugin[]>;
    installMarketplaceVersion(version: MarketplaceVersion): Promise<PluginStatus[]>;
    updatePlugin(id: string): Promise<{ id: string; from: string; to: string; updated: boolean }>;
    detectInstalledApps(): Promise<DetectedCompanionApp[]>;
    detectClassIslandInstallations(): Promise<ClassIslandInstallCandidate[]>;
    pickClassIslandExecutable(): Promise<ClassIslandInstallCandidate | undefined>;
    installClassIslandCompanion(targetIds: string[]): Promise<ClassIslandInstallResult[]>;
    onClassIslandProgress(listener: (progress: ClassIslandInstallProgress) => void): () => void;
    detectSecRandomInstallations(): Promise<SecRandomInstallCandidate[]>;
    pickSecRandomExecutable(): Promise<SecRandomInstallCandidate | undefined>;
    installSecRandomCompanion(targetIds: string[]): Promise<SecRandomInstallResult[]>;
    onSecRandomProgress(listener: (progress: SecRandomInstallProgress) => void): () => void;
    detectIccceInstallations(): Promise<IccceInstallCandidate[]>;
    pickIccceExecutable(): Promise<IccceInstallCandidate | undefined>;
    installIccceCompanion(targetIds: string[]): Promise<IccceInstallResult[]>;
    installAllCompanions(payload: { classIsland?: string[]; secRandom?: string[]; iccce?: string[]; cw?: string[] }): Promise<{ classIsland: ClassIslandInstallResult[]; secRandom: SecRandomInstallResult[]; iccce: IccceInstallResult[]; cw: ClassWidgetsInstallResult[] }>;
    onIccceProgress(listener: (progress: IccceInstallProgress) => void): () => void;
    detectClassWidgetsInstallations(): Promise<ClassWidgetsInstallCandidate[]>;
    pickClassWidgetsExecutable(): Promise<ClassWidgetsInstallCandidate | undefined>;
    installClassWidgetsCompanion(targetIds: string[]): Promise<ClassWidgetsInstallResult[]>;
    onClassWidgetsProgress(listener: (progress: ClassWidgetsInstallProgress) => void): () => void;
    getOobeProgress(): Promise<OobeProgress | undefined>;
    saveOobeProgress(progress: OobeProgress): Promise<OobeProgress | undefined>;
    openExternal(url: string): Promise<{ ok: true }>;
    completeOnboarding(): Promise<{ ok: true }>;
    createSession(): Promise<SessionData>;
    deleteSession(id: string): Promise<SessionMeta[]>;
    getSession(id: string): Promise<SessionData>;
    getRuntimeEvents(id: string): Promise<SessionRuntimeEvent[]>;
    uploadDiagnostic(id: string): Promise<{ bytes: number }>;
    previewWorkspaceFile(relativePath: string): Promise<{ ok: true }>;
    sendMessage(id: string, text: string, modelId?: string, reasoningEffort?: ReasoningEffort, attachments?: ChatAttachment[]): Promise<SessionData>;
    stopMessage(id: string): Promise<{ ok: true; stopped: boolean }>;
    onRuntimeEvent(listener: (event: unknown) => void): () => void;
    startSpeech(hotwords?: string[]): Promise<{ ok: true; remote?: boolean; provider?: string; fallbacks?: string[] }>;
    startVoiceWake(phrase: string): Promise<{ ok: true }>;
    sendVoiceWakeAudio(samples: Float32Array): void;
    stopVoiceWake(): Promise<{ ok: true }>;
    logVoiceWake(event: unknown): void;
    sendSpeechAudio(samples: Float32Array): void;
    logSpeech(event: unknown): void;
    stopSpeech(): Promise<{ ok: true }>;
    cancelSpeech(): Promise<{ ok: true }>;
    testSpeech(kind?: string): Promise<Array<{ id: string; label: string; ok: boolean; message: string }>>;
    speechChain(): Promise<string[]>;
    synthesizeSpeech(text: string): Promise<string>;
    testTts(kind?: string): Promise<{ ok: boolean; message: string; results: Array<{ provider: string; ok: boolean; message: string }> }>;
    ttsChain(): Promise<string[]>;
    listWindowsVoices(): Promise<string[]>;
    fetchRemoteModels(request: { baseUrl: string; apiKey?: string; apiKeyEnv?: string }): Promise<{ ok: boolean; message: string; models: Array<{ id: string; ownedBy?: string }> }>;
    logWakeTts(event: unknown): void;
    setWakeContext(context: { sessionId?: string; modelId?: string; reasoningEffort?: ReasoningEffort }): void;
    closeWake(): Promise<{ ok: true }>;
    setWakeInteractive(interactive: boolean): void;
    onSpeechEvent(listener: (event: unknown) => void): () => void;
    onVoiceWakeResume(listener: () => void): () => void;
    onSettingsChanged(listener: (settings: SettingsPayload) => void): () => void;
    onUpdateState(listener: (state: UpdateState) => void): () => void;
    onPluginsChanged(listener: (plugins: PluginStatus[]) => void): () => void;
    respondToolConfirmation(payload: { confirmationId: string; approved: boolean; always?: boolean; signature?: string }): Promise<{ ok: boolean; error?: string }>;
    onToolConfirmation(listener: (payload: { confirmationId: string; sessionId: string; tool: string; arguments: Record<string, unknown>; reason: string }) => void): () => void;
  };
}
