/**
 * Electron glue for speech recognition and voice wake.
 *
 * All recognition logic lives in the provider-agnostic `src/asr/` layer; this
 * module owns the process-wide `AsrManager`, routes events to the requesting
 * window over the `speech:event` channel, and keeps the exported surface that
 * `main.ts` consumes.
 */
import { BrowserWindow, app } from "electron";
import { AsrManager, type StartedAsr } from "../asr/manager.js";
import type { AsrEvent } from "../asr/types.js";
import type { AsrProviderKind } from "../asr/settings.js";
import { LocalSherpaAsrProvider } from "../asr/local-sherpa.js";
import { RelayAsrProvider } from "../asr/relay.js";
import { OpenAiHttpAsrProvider } from "../asr/openai-http.js";
import { BailianHttpAsrProvider } from "../asr/bailian-http.js";
import { BailianWsAsrProvider } from "../asr/bailian-ws.js";
import { MimoHttpAsrProvider } from "../asr/mimo-http.js";
import { LocalSenseVoiceProvider } from "../asr/local-sensevoice.js";
import { VoiceWakeEngine } from "../asr/voice-wake.js";
import type { SpeechAsrSettings } from "../asr/settings.js";

let speechSettings: SpeechAsrSettings | undefined;

/** Update the live ASR preference (called after settings load/save). */
export function configureSpeech(settings: SpeechAsrSettings | undefined): void {
  speechSettings = settings;
}

function send(window: BrowserWindow | undefined, event: AsrEvent): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  try { window.webContents.send("speech:event", event); } catch { /* Window may close during an async callback. */ }
}

const appModelRoots = (): string[] => {
  // Packaged layout keeps models/ next to the asar archive; dev runs from the
  // repository root. Also cover out/ bundles two levels deep.
  const roots: string[] = [];
  try { roots.push(app.getAppPath()); } catch { /* not under Electron */ }
  if (typeof process.resourcesPath === "string") roots.push(process.resourcesPath);
  roots.push(process.cwd(), __dirname);
  return [...new Set(roots)];
};

const log = (message: string): void => console.info(message);

const manager = new AsrManager({
  getProviderKind: () => speechSettings?.provider,
  // 完全自定义回退链（用户在设置里排好的顺序，例：A → C → 本地）。
  getCustomChain: () => speechSettings?.chain,
  log
});
manager.register(new RelayAsrProvider({
  getToken: () => process.env.SECTL_OFFICIAL_TOKEN || "",
  getApiBaseUrl: () => process.env.SECTL_OFFICIAL_API_URL || "",
  log
}));
manager.register(new OpenAiHttpAsrProvider({
  getSettings: () => speechSettings?.openai,
  getApiKey: (envName) => process.env[envName] || "",
  log
}));
manager.register(new BailianHttpAsrProvider({
  getSettings: () => speechSettings?.bailian,
  getApiKey: (envName) => process.env[envName] || "",
  log
}));
manager.register(new BailianWsAsrProvider({
  getSettings: () => speechSettings?.bailian,
  getApiKey: (envName) => process.env[envName] || "",
  getNoise: () => speechSettings?.noise,
  log
}));
manager.register(new MimoHttpAsrProvider({
  getSettings: () => speechSettings?.mimo,
  getApiKey: (envName) => process.env[envName] || "",
  log
}));
manager.register(new LocalSenseVoiceProvider({ extraRoots: appModelRoots(), log }));
manager.register(new LocalSherpaAsrProvider({ extraRoots: appModelRoots(), log }));

const voiceWake = new VoiceWakeEngine({ extraRoots: appModelRoots(), log });

let speechWindow: BrowserWindow | undefined;
let currentSession: StartedAsr | undefined;

/** Start a recognition utterance for `window`; falls back down the provider chain. */
export async function startSpeech(window: BrowserWindow | undefined): Promise<{ ok: true; provider: string; remote: boolean; fallbacks: string[] }> {
  speechWindow = window;
  if (currentSession) {
    // The chat window and the wake overlay share one utterance; re-route events.
    send(speechWindow, { type: "ready", provider: currentSession.providerId });
    return { ok: true, provider: currentSession.providerId, remote: currentSession.providerId !== "local", fallbacks: [] };
  }
  currentSession = await manager.start((event) => send(speechWindow, event));
  return { ok: true, provider: currentSession.providerId, remote: currentSession.providerId !== "local", fallbacks: currentSession.fallbacks };
}

export function sendSpeechAudio(samples: Float32Array): void {
  if (currentSession) currentSession.session.push(samples);
}

export async function stopSpeech(): Promise<void> {
  const active = currentSession;
  if (!active) return;
  currentSession = undefined;
  try { await active.session.stop(); } catch (error) { send(speechWindow, { type: "error", message: error instanceof Error ? error.message : String(error) }); }
  speechWindow = undefined;
}

export function cancelSpeech(): void {
  const active = currentSession;
  if (!active) return;
  currentSession = undefined;
  try { active.session.cancel(); } catch { /* best effort */ }
  speechWindow = undefined;
}

/** Connectivity probe for the settings page; `kind` scopes which providers run. */
export function testSpeech(kind: AsrProviderKind): ReturnType<AsrManager["test"]> {
  return manager.test(kind);
}

/** Provider chain that `auto` would try right now, for diagnostics in the UI. */
export function speechChain(): string[] {
  return manager.chain();
}

export async function startVoiceWake(window: BrowserWindow | undefined, phrase: string, onDetected: () => void): Promise<{ ok: true }> {
  void window;
  await voiceWake.start(phrase.trim(), onDetected);
  return { ok: true };
}

export function stopVoiceWake(): void {
  voiceWake.stop();
}

export function sendVoiceWakeAudio(samples: Float32Array): void {
  voiceWake.feed(samples);
}
