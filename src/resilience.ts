import fs from "node:fs";
import path from "node:path";

/**
 * Resilience layer for model requests.
 *
 * Designed for the "free quota" reality of providers such as Aliyun Bailian:
 * a model works until its trial package runs out, then every request fails
 * with a quota/billing error. Instead of failing the whole conversation, we
 * remember which models are unhealthy, temporarily skip them, and fall through
 * to the next configured model.
 */
export interface ResilienceSettings {
  /** Retry the same model once before switching. Default true. */
  autoRetry: boolean;
  /** Try other configured models when the current one fails. Default true. */
  fallbackEnabled: boolean;
  /** Remember failures and skip cooling-down models in later runs. Default true. */
  rememberFailures: boolean;
  /** First cooldown in minutes; doubles per consecutive failure, capped. Default 5. */
  cooldownBaseMinutes: number;
  /** Long cooldown applied to quota/billing errors (free package exhausted). Default 60. */
  quotaCooldownMinutes: number;
}

export const DEFAULT_RESILIENCE: ResilienceSettings = {
  autoRetry: true,
  fallbackEnabled: true,
  rememberFailures: true,
  cooldownBaseMinutes: 5,
  quotaCooldownMinutes: 60
};

export function normalizeResilienceSettings(raw: unknown): ResilienceSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof ResilienceSettings, unknown>>;
  const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === "number" && Number.isFinite(value) ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  };
  return {
    autoRetry: input.autoRetry !== false,
    fallbackEnabled: input.fallbackEnabled !== false,
    rememberFailures: input.rememberFailures !== false,
    cooldownBaseMinutes: clampNumber(input.cooldownBaseMinutes, DEFAULT_RESILIENCE.cooldownBaseMinutes, 1, 720),
    quotaCooldownMinutes: clampNumber(input.quotaCooldownMinutes, DEFAULT_RESILIENCE.quotaCooldownMinutes, 1, 10080)
  };
}

/** Categories that decide cooldown length and fallback behaviour. */
export type FailureKind = "quota" | "auth" | "rate_limit" | "server" | "network" | "aborted" | "unknown";

export interface FailureRecord {
  at: string;
  kind: FailureKind;
  message: string;
}

export interface ModelHealth {
  failures: FailureRecord[];
  consecutiveFailures: number;
  disabledUntil: string | undefined;
  lastKind: FailureKind | undefined;
}

const MAX_RECORDED_FAILURES = 5;

/** Map a provider error to a failure category. `aborted` is user-initiated and never falls back. */
export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  const text = `${error instanceof Error ? `${error.message} ${error.name}` : String(error)}`.toLowerCase();
  if (/(abort|用户中止|已停止)/.test(text)) return "aborted";
  if (/(quota|billing|arrears|insufficient[_ ]balance|balance.*insufficient|欠费|余额不足|资源包.*用完|免费额度|402)/.test(text)) return "quota";
  if (/(invalid[_ ]api[_ ]key|authentication|unauthorized|api key|401|403|forbidden)/.test(text)) return "auth";
  if (/(rate[_ ]?limit|too many requests|429|throttl|请求过于频繁|频率)/.test(text)) return "rate_limit";
  if (/(timeout|etimedout|econnreset|econnrefused|enotfound|eai_again|fetch failed|network|暂时无法|unreachable|502|503|504)/.test(text)) return "network";
  if (/(internal[_ ]?server|500|bad[_ ]?gateway|server error|服务(器)?(错误|繁忙))/.test(text)) return "server";
  return "unknown";
}

/** Whether a failure kind should trigger fallback to another model. */
export function isFallbackable(kind: FailureKind): boolean {
  return kind !== "aborted";
}

export class ModelHealthStore {
  private state = new Map<string, ModelHealth>();
  private constructor(private readonly file: string | undefined) {}

  static load(workspace: string | undefined): ModelHealthStore {
    if (!workspace) return new ModelHealthStore(undefined);
    const file = path.join(workspace, ".model-health.json");
    const store = new ModelHealthStore(file);
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { models?: Record<string, ModelHealth> } | Record<string, ModelHealth>;
        // Accept both the canonical {version, models} envelope and a bare map.
        const source = parsed && typeof parsed === "object" && "models" in parsed && parsed.models && typeof parsed.models === "object"
          ? (parsed as { models: Record<string, ModelHealth> }).models
          : (parsed as Record<string, ModelHealth>);
        for (const [id, health] of Object.entries(source || {})) {
          if (health && Array.isArray(health.failures)) store.state.set(id, health);
        }
      }
    } catch { /* corrupt file — start fresh */ }
    return store;
  }

  private persist(): void {
    if (!this.file) return;
    try {
      const entries = [...this.state.entries()].filter(([, health]) => health.failures.length > 0);
      const payload: Record<string, ModelHealth> = {};
      for (const [id, health] of entries.slice(-64)) payload[id] = health;
      fs.writeFileSync(this.file, JSON.stringify({ version: 1, models: payload }, null, 2), "utf8");
    } catch { /* persistence is best-effort */ }
  }

  private entry(id: string): ModelHealth {
    let health = this.state.get(id);
    if (!health) {
      health = { failures: [], consecutiveFailures: 0, disabledUntil: undefined, lastKind: undefined };
      this.state.set(id, health);
    }
    return health;
  }

  reportFailure(id: string, kind: FailureKind, message: string, settings: ResilienceSettings): { cooldownMinutes: number } {
    const health = this.entry(id);
    health.failures.push({ at: new Date().toISOString(), kind, message: message.slice(0, 300) });
    if (health.failures.length > MAX_RECORDED_FAILURES) health.failures.shift();
    health.consecutiveFailures += 1;
    health.lastKind = kind;
    let cooldownMinutes: number;
    if (kind === "quota") {
      // Bailian-style exhausted trial package: retrying sooner is pointless.
      cooldownMinutes = settings.quotaCooldownMinutes * Math.min(4, health.consecutiveFailures);
    } else if (kind === "auth") {
      // A wrong key does not heal within one session; long cooldown.
      cooldownMinutes = 24 * 60;
    } else if (kind === "rate_limit") {
      cooldownMinutes = Math.min(15, settings.cooldownBaseMinutes * health.consecutiveFailures);
    } else {
      cooldownMinutes = Math.min(60, settings.cooldownBaseMinutes * 2 ** (health.consecutiveFailures - 1));
    }
    health.disabledUntil = new Date(Date.now() + cooldownMinutes * 60_000).toISOString();
    this.persist();
    return { cooldownMinutes };
  }

  reportSuccess(id: string): void {
    const health = this.state.get(id);
    if (!health) return;
    health.failures = [];
    health.consecutiveFailures = 0;
    health.disabledUntil = undefined;
    health.lastKind = undefined;
    this.persist();
  }

  isCoolingDown(id: string, settings: ResilienceSettings): boolean {
    if (!settings.rememberFailures) return false;
    const health = this.state.get(id);
    if (!health?.disabledUntil) return false;
    return new Date(health.disabledUntil).getTime() > Date.now();
  }

  summary(): Record<string, { coolingDown: boolean; consecutiveFailures: number; lastKind: FailureKind | undefined; disabledUntil: string | undefined }> {
    const result: Record<string, { coolingDown: boolean; consecutiveFailures: number; lastKind: FailureKind | undefined; disabledUntil: string | undefined }> = {};
    for (const [id, health] of this.state) {
      result[id] = {
        coolingDown: Boolean(health.disabledUntil && new Date(health.disabledUntil).getTime() > Date.now()),
        consecutiveFailures: health.consecutiveFailures,
        lastKind: health.lastKind,
        disabledUntil: health.disabledUntil
      };
    }
    return result;
  }

  clear(id?: string): void {
    if (id) this.state.delete(id);
    else this.state.clear();
    this.persist();
  }
}

/**
 * Order the model chain for a run: the requested model first (unless it is
 * cooling down and other options exist), then every other enabled model with
 * cooling-down ones pushed to the end. Returns [] when there is no option.
 */
export function planModelChain<T>(requested: T | undefined, candidates: T[], idOf: (model: T) => string, settings: ResilienceSettings, health: ModelHealthStore): T[] {
  const pool = [...candidates];
  if (requested !== undefined) {
    const index = pool.findIndex((model) => idOf(model) === idOf(requested));
    if (index >= 0) pool.splice(index, 1);
    pool.unshift(requested);
  }
  if (!settings.fallbackEnabled) return pool.slice(0, 1);
  const ready = pool.filter((model) => !health.isCoolingDown(idOf(model), settings));
  const cooling = pool.filter((model) => health.isCoolingDown(idOf(model), settings));
  return [...ready, ...cooling];
}
