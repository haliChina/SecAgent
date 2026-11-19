/**
 * Electron glue for text-to-speech.
 *
 * The provider implementations and the fallback-chain manager live in
 * `src/tts/`; this module keeps the process-wide TtsManager, feeds it live
 * settings, and exposes the small surface `main.ts` consumes:
 *   - configureTts(settings)   after every settings load/save
 *   - synthesizeSpeech(text)  speak one utterance (tries chain in order)
 *   - testTts / ttsChain      diagnostics for the settings page
 *   - listWindowsVoices()     installed SAPI voices for the picker
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EdgeTtsProvider, WindowsSapiTtsProvider, MimoTtsProvider, BailianTtsProvider } from "../tts/providers.js";
import { TtsManager } from "../tts/manager.js";
import type { TtsProviderKind, TtsSettings } from "../tts/types.js";
import { DEFAULT_TTS_VOICE, DEFAULT_TTS_RATE } from "../config.js";
import { markdownToPlainText } from "../tts-text.js";
import { readTtsCache, writeTtsCache } from "../tts-cache.js";

const execFileAsync = promisify(execFile);

let ttsSettings: TtsSettings | undefined;
/** Cache keyed on the settings object identity — configureTts() swaps the object. */
let managerCache: { ref: TtsSettings | undefined; manager: TtsManager } | undefined;

const log = (message: string): void => console.info(message);

/** Update the live TTS preference (called after settings load/save). */
export function configureTts(settings: TtsSettings | undefined): void {
  ttsSettings = settings;
  managerCache = undefined; // rebuilt lazily with the latest settings
}

function ensureManager(): TtsManager {
  if (managerCache && managerCache.ref === ttsSettings) return managerCache.manager;
  const liveSettings = (): TtsSettings => ttsSettings || { provider: "edge", voice: DEFAULT_TTS_VOICE, rate: DEFAULT_TTS_RATE };
  const manager = new TtsManager({ getSettings: liveSettings, log });
  // Edge/Windows take no constructor options — voice/rate ride on synthesize options.
  manager.register(new EdgeTtsProvider());
  manager.register(new WindowsSapiTtsProvider());
  manager.register(new MimoTtsProvider({
    getSettings: () => ttsSettings?.mimo,
    getApiKey: (envName) => process.env[envName] || "",
    log
  }));
  manager.register(new BailianTtsProvider({
    getSettings: () => ttsSettings?.bailian,
    getApiKey: (envName) => process.env[envName] || "",
    log
  }));
  managerCache = { ref: ttsSettings, manager };
  return manager;
}

/** 音色缓存键：Edge/Windows 用全局音色；MiMo/Bailian 用各自子配置的音色。 */
function cacheVoice(kind: TtsProviderKind, settings: TtsSettings): string {
  if (kind === "mimo") return settings.mimo?.voice?.trim() || "mimo_default";
  if (kind === "bailian") return settings.bailian?.voice?.trim() || "longanyang";
  return settings.voice || DEFAULT_TTS_VOICE;
}

/** Speak `text` through the primary provider, falling back down the chain. */
export async function synthesizeSpeech(text: string, settingsSnapshot?: TtsSettings): Promise<Buffer> {
  if (settingsSnapshot) configureTts(settingsSnapshot);
  const settings: TtsSettings = ttsSettings ?? { provider: "edge", voice: DEFAULT_TTS_VOICE, rate: DEFAULT_TTS_RATE };
  // Markdown 清洗在这里统一做：渲染端只负责分句，避免两套规则各删各的符号。
  const plain = markdownToPlainText(text, { readCodeBlocks: settings.readCodeBlocks === true });
  if (!plain) return Buffer.alloc(0);
  const rate = settings.rate || DEFAULT_TTS_RATE;
  const manager = ensureManager();
  // 缓存按链路逐个探测：本次实际可能由回退引擎合成，命中任一已缓存引擎即可复用。
  for (const kind of manager.chain()) {
    const cached = readTtsCache({ provider: kind, voice: cacheVoice(kind, settings), rate, text: plain });
    if (cached) {
      log(`[tts] 缓存命中：${kind}（${cached.length} 字节）`);
      return cached;
    }
  }
  const chunk = await manager.synthesize(plain, { voice: settings.voice, rate });
  writeTtsCache({ provider: chunk.provider, voice: cacheVoice(chunk.provider, settings), rate, text: plain }, chunk.data);
  return chunk.data;
}

/** Connectivity probe for the settings page. */
export function testTts(kind?: TtsProviderKind): ReturnType<TtsManager["test"]> {
  return ensureManager().test(kind);
}

/** Provider chain that would be tried right now, for diagnostics. */
export function ttsChain(): TtsProviderKind[] {
  return ensureManager().chain();
}

/** Installed Windows SAPI voices ("Name|Culture" per line) for the picker. */
export async function listWindowsVoices(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  try {
    const script = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture }";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15_000 });
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
