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

/** Speak `text` through the primary provider, falling back down the chain. */
export async function synthesizeSpeech(text: string, settingsSnapshot?: TtsSettings): Promise<Buffer> {
  if (settingsSnapshot) configureTts(settingsSnapshot);
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return Buffer.alloc(0);
  const chunk = await ensureManager().synthesize(clean, { voice: ttsSettings?.voice, rate: ttsSettings?.rate });
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
