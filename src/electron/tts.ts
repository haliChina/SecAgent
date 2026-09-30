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
import { EdgeTtsProvider, WindowsSapiProvider, MimoTtsProvider, BailianTtsProvider } from "../tts/providers.js";
import { TtsManager, type TtsManagerOptions } from "../tts/manager.js";
import type { TtsProviderKind, TtsSettings } from "../tts/types.js";
import { DEFAULT_TTS_VOICE, DEFAULT_TTS_RATE } from "../config.js";

const execFileAsync = promisify(execFile);

let ttsSettings: TtsSettings | undefined;
let managerOptions: TtsManagerOptions | undefined;

const log = (message: string): void => console.info(message);

/** Update the live TTS preference (called after settings load/save). */
export function configureTts(settings: TtsSettings | undefined): void {
  ttsSettings = settings;
  managerOptions = undefined; // rebuilt lazily with the latest settings
}

function ensureManager(): TtsManager {
  if (managerOptions?.settings === ttsSettings) return managerOptions.manager;
  const settings: TtsSettings = ttsSettings || { provider: "edge", voice: DEFAULT_TTS_VOICE, rate: DEFAULT_TTS_RATE };
  const manager = new TtsManager({ getSettings: () => settings, log });
  manager.register(new EdgeTtsProvider({
    getVoice: () => settings.voice || DEFAULT_TTS_VOICE,
    getRate: () => settings.rate || DEFAULT_TTS_RATE,
    log
  }));
  manager.register(new WindowsSapiProvider({
    getVoice: () => settings.windows?.voice,
    getRate: () => settings.rate || DEFAULT_TTS_RATE,
    log
  }));
  manager.register(new MimoTtsProvider({
    getSettings: () => settings.mimo,
    getApiKey: (envName) => process.env[envName] || "",
    log
  }));
  manager.register(new BailianTtsProvider({
    getSettings: () => settings.bailian,
    getApiKey: (envName) => process.env[envName] || "",
    log
  }));
  managerOptions = { settings: ttsSettings, manager };
  return manager;
}

/** Speak `text` through the primary provider, falling back down the chain. */
export async function synthesizeSpeech(text: string, settingsSnapshot?: TtsSettings): Promise<Buffer> {
  if (settingsSnapshot) configureTts(settingsSnapshot);
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return Buffer.alloc(0);
  const chunk = await ensureManager().synthesize(clean);
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
