/**
 * TTS orchestration: user-defined provider + ordered fallback chain.
 *
 * Mirrors the ASR manager's philosophy but for text-to-speech: the primary
 * provider is tried first, then each remaining chain entry. A failing provider
 * cools off for 5 minutes (3 consecutive failures) exactly like ASR so one
 * dead endpoint cannot slow down every utterance.
 */
import type { TtsAudioChunk, TtsProvider, TtsProviderKind, TtsSettings, TtsSynthesisOptions } from "./types.js";

const CONSECUTIVE_FAILURES = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

interface TtsManagerOptions {
  getSettings(): TtsSettings;
  log?(message: string): void;
}

export class TtsManager {
  private readonly providers = new Map<TtsProviderKind, TtsProvider>();
  private readonly failures = new Map<TtsProviderKind, number>();
  private readonly cooldownUntil = new Map<TtsProviderKind, number>();
  private readonly options: TtsManagerOptions;

  constructor(options: TtsManagerOptions) { this.options = options; }

  register(provider: TtsProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  getProvider(id: TtsProviderKind): TtsProvider | undefined {
    return this.providers.get(id);
  }

  listProviders(): TtsProvider[] {
    return [...this.providers.values()];
  }

  /** Ordered ids the current settings would try (primary first). */
  chain(): TtsProviderKind[] {
    return this.resolveChain().map((provider) => provider.id);
  }

  private resolveChain(): TtsProvider[] {
    const settings = this.options.getSettings();
    const ids: TtsProviderKind[] = [settings.provider, ...(settings.chain || [])];
    const seen = new Set<TtsProviderKind>();
    const chain: TtsProvider[] = [];
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const provider = this.providers.get(id);
      if (provider && (provider.isConfigured() || id === "windows")) chain.push(provider);
    }
    // Platform fallback: nothing configured/available → Windows SAPI on win32,
    // else Edge (needs no key). Guarantees the chain is never empty.
    if (!chain.length) {
      const fallback = this.providers.get(process.platform === "win32" ? "windows" : "edge");
      if (fallback) chain.push(fallback);
    }
    return chain;
  }

  private isCoolingDown(id: TtsProviderKind): boolean {
    const until = this.cooldownUntil.get(id) || 0;
    return Date.now() < until;
  }

  private recordFailure(id: TtsProviderKind): void {
    const count = (this.failures.get(id) || 0) + 1;
    this.failures.set(id, count);
    if (count >= CONSECUTIVE_FAILURES) {
      this.cooldownUntil.set(id, Date.now() + COOLDOWN_MS);
      this.failures.set(id, 0);
      this.options.log?.(`[tts] ${id} 连续失败 ${CONSECUTIVE_FAILURES} 次，冷却 5 分钟`);
    }
  }

  private recordSuccess(id: TtsProviderKind): void {
    this.failures.set(id, 0);
    this.cooldownUntil.delete(id);
  }

  /** Synthesize with fallback: returns audio plus which provider produced it. */
  async synthesize(text: string, options: TtsSynthesisOptions = {}): Promise<TtsAudioChunk & { provider: TtsProviderKind }> {
    const chain = this.resolveChain();
    const ready = chain.filter((provider) => !this.isCoolingDown(provider.id));
    const ordered = ready.length ? [...ready, ...chain.filter((provider) => this.isCoolingDown(provider.id))] : chain;
    const errors: string[] = [];
    for (const provider of ordered) {
      try {
        const audio = await provider.synthesize(text, options);
        if (!audio.data.length) throw new Error("返回空音频");
        this.recordSuccess(provider.id);
        this.options.log?.(`[tts] ${provider.id} 合成成功（${audio.data.length} 字节）`);
        return { ...audio, provider: provider.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.recordFailure(provider.id);
        errors.push(`${provider.displayName()}：${message}`);
        this.options.log?.(`[tts] ${provider.id} 失败：${message}`);
      }
    }
    throw new Error(`语音合成全部失败 — ${errors.join("；")}`);
  }

  /** Connectivity/capability probe for the settings page. */
  async test(kind?: TtsProviderKind): Promise<{ ok: boolean; message: string; results: Array<{ provider: TtsProviderKind; ok: boolean; message: string }> }> {
    const targets = kind && this.providers.has(kind) ? [this.providers.get(kind)!] : this.listProviders();
    const results: Array<{ provider: TtsProviderKind; ok: boolean; message: string }> = [];
    for (const provider of targets) {
      if (provider.id === "edge" || provider.id === "windows") {
        results.push({ provider: provider.id, ok: provider.isConfigured(), message: provider.isConfigured() ? `${provider.displayName()} 可用` : `${provider.displayName()} 在当前系统不可用` });
        continue;
      }
      const configured = provider.isConfigured();
      results.push({ provider: provider.id, ok: configured, message: configured ? `${provider.displayName()} 已配置` : `${provider.displayName()} 未配置 API Key` });
    }
    return { ok: results.some((entry) => entry.ok), message: results.map((entry) => `${entry.ok ? "✓" : "✗"} ${entry.message}`).join("\n"), results };
  }
}
