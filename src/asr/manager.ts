/**
 * ASR orchestration: picks providers by settings, starts an utterance with
 * automatic fallback, and keeps at most one active session at a time.
 *
 * Fallback chain:
 *   `auto`       third-party (explicit user config) → official relay → local
 *   `official`   official relay → local
 *   `openai`     third-party → local
 *   `local`      local only
 *   `bailian`    百炼 chat/completions → local
 *   `bailian-ws` 百炼 realtime WebSocket → 百炼 chat/completions → local
 */
import type { AsrEvent, AsrEventSink, AsrProvider, AsrSession } from "./types.js";
import type { AsrProviderKind } from "./settings.js";

export interface AsrManagerOptions {
  /** Reads the live provider preference (`auto` when absent). */
  getProviderKind: () => AsrProviderKind | undefined;
  /** Reads the user's fully custom ordered fallback chain, if configured. */
  getCustomChain?: () => string[] | undefined;
  log?: (message: string) => void;
}

export interface StartedAsr {
  session: AsrSession;
  providerId: string;
  /** Ordered provider ids that were tried before one started. */
  fallbacks: string[];
}

export class AsrManager {
  private readonly providers = new Map<string, AsrProvider>();
  private active: AsrSession | undefined;
  private readonly options: AsrManagerOptions;

  constructor(options: AsrManagerOptions) {
    this.options = options;
  }

  register(provider: AsrProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  getProvider(id: string): AsrProvider | undefined {
    return this.providers.get(id);
  }

  listProviders(): AsrProvider[] {
    return [...this.providers.values()];
  }

  /** Resolve the fallback chain for the configured provider kind. */
  resolveChain(): AsrProvider[] {
    // 用户自定义链优先：完全按用户给的顺序，只过滤未配置项（local 始终保留在末尾兜底）。
    const custom = this.options.getCustomChain?.();
    if (custom && custom.length) {
      const picked = custom
        .map((id) => this.providers.get(id))
        .filter((provider): provider is AsrProvider => Boolean(provider))
        .filter((provider) => provider.isConfigured() || provider.id === "local");
      if (!picked.some((provider) => provider.id === "local")) {
        const local = this.providers.get("local");
        if (local && (local.isConfigured() || true)) picked.push(local);
      }
      if (picked.length) return picked;
    }
    const kind = this.options.getProviderKind() || "auto";
    const chainFor: Record<AsrProviderKind, string[]> = {
      auto: ["openai", "official", "local"],
      official: ["official", "local"],
      openai: ["openai", "local"],
      local: ["local"],
      bailian: ["bailian", "local"],
      "bailian-ws": ["bailian-ws", "bailian", "local"],
      mimo: ["mimo", "local"],
      "local-pro": ["local-pro", "local"]
    };
    return chainFor[kind]
      .map((id) => this.providers.get(id))
      .filter((provider): provider is AsrProvider => Boolean(provider))
      .filter((provider) => provider.isConfigured() || provider.id === "local");
  }

  /** Provider ids the current settings would try, in order (diagnostics). */
  chain(): string[] {
    return this.resolveChain().map((provider) => provider.id);
  }

  get activeProviderId(): string | undefined {
    return this.active?.providerId;
  }

  /**
   * Consecutive-start failures per provider (session-scoped). After 3 in a
   * row a provider is skipped for a cool-off window (5 minutes), mirroring the
   * model-level resilience cooldown. Reset on any successful start.
   */
  private startFailures = new Map<string, { count: number; until: number }>();
  private isAsrCoolingDown(id: string): boolean {
    const entry = this.startFailures.get(id);
    return Boolean(entry && entry.until > Date.now());
  }

  /** Start an utterance, falling back down the chain when a provider cannot start. */
  async start(sink: AsrEventSink): Promise<StartedAsr> {
    if (this.active) await this.cancel();
    const chain = this.resolveChain();
    if (!chain.length) throw new Error("没有可用的语音识别服务：请登录官方服务、配置第三方识别，或安装本地模型");
    // Keep at least one option even when everything is cooling down.
    const ready = chain.filter((provider) => !this.isAsrCoolingDown(provider.id));
    const ordered = ready.length ? [...ready, ...chain.filter((provider) => this.isAsrCoolingDown(provider.id))] : chain;
    const failures: Array<{ id: string; message: string }> = [];
    for (const provider of ordered) {
      try {
        const session = await provider.start(sink);
        this.active = session;
        this.startFailures.delete(provider.id);
        this.options.log?.(`[asr] session started provider=${provider.id} chain=${ordered.map((item) => item.id).join(">")}`);
        sink({ type: "ready", provider: provider.id });
        return { session, providerId: provider.id, fallbacks: failures.map((failure) => failure.id) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.log?.(`[asr] provider ${provider.id} failed to start: ${message}`);
        const entry = this.startFailures.get(provider.id) || { count: 0, until: 0 };
        entry.count += 1;
        if (entry.count >= 3) entry.until = Date.now() + 5 * 60_000;
        this.startFailures.set(provider.id, entry);
        failures.push({ id: provider.id, message });
      }
    }
    throw new Error(failures.map((failure) => `${failure.id}：${failure.message}`).join("；"));
  }

  /** Push audio into the active session (if any). */
  push(samples: Float32Array): void {
    this.active?.push(samples);
  }

  /** Finish the active utterance. */
  async stop(): Promise<void> {
    const session = this.active;
    this.active = undefined;
    if (!session) return;
    try { await session.stop(); } catch { /* stop errors surface as error events */ }
  }

  /** Abort the active utterance without a final result. */
  async cancel(): Promise<void> {
    const session = this.active;
    this.active = undefined;
    if (!session) return;
    try { session.cancel(); } catch { /* cancel must never throw */ }
  }

  /** Probe every configured provider (used by the settings page). */
  async test(kind: AsrProviderKind): Promise<Array<{ id: string; label: string; ok: boolean; message: string }>> {
    const ids: Record<AsrProviderKind, string[]> = {
      auto: ["openai", "official", "local"],
      official: ["official"],
      openai: ["openai"],
      local: ["local"],
      bailian: ["bailian"],
      "bailian-ws": ["bailian-ws"],
      mimo: ["mimo"],
      "local-pro": ["local-pro"]
    };
    const results: Array<{ id: string; label: string; ok: boolean; message: string }> = [];
    for (const id of ids[kind]) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      if (!provider.test) {
        results.push({ id, label: provider.label, ok: provider.isConfigured(), message: provider.isConfigured() ? "已配置" : "未配置" });
        continue;
      }
      try {
        const result = await provider.test();
        results.push({ id, label: provider.label, ok: result.ok, message: result.message });
      } catch (error) {
        results.push({ id, label: provider.label, ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }
}

