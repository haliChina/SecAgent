/**
 * 语音/TTS IPC 域（B2 自 main.ts 拆出，纯搬家）。
 *
 * 13 通道：speech:start/stop/cancel/chain/test/log/audio +
 * voice-wake:start/stop/log/audio + tts:synthesize/test/chain/voices +
 * wake:tts-log。唤醒窗引用经访问器注入（speech 目标窗：wake 优先主窗
 * 兜底）；语音唤醒触发开屏经回调注入（不直接依赖 wake 域）。
 */
import { DEFAULT_WORKSPACE } from "../paths.js";
import { ipcMain, type BrowserWindow } from "electron";
import { loadConfig } from "../config.js";
import { cancelSpeech, sendSpeechAudio, sendVoiceWakeAudio, speechChain, startSpeech, startVoiceWake, stopSpeech, stopVoiceWake, testSpeech } from "./speech.js";
import { synthesizeSpeech, testTts, ttsChain, listWindowsVoices } from "./tts.js";
import { logMain } from "./main-log.js";
import { recordTelemetryFailure } from "./main-telemetry.js";

export function registerSpeechIpc(deps: {
  getWakeWindow: () => BrowserWindow | undefined;
  getVoiceWakeWindow: () => BrowserWindow | undefined;
  openWakeWindow: () => Promise<void>;
}): void {
  const { getWakeWindow, getVoiceWakeWindow, openWakeWindow } = deps;

  ipcMain.handle("speech:start", async (event) => {
    const wakeWindow = getWakeWindow();
    const target = wakeWindow?.webContents.id === event.sender.id ? wakeWindow : undefined;
    logMain("speech.start", { window: target === wakeWindow ? "wake" : "main" });
    try {
      const result = await startSpeech(target);
      logMain("speech.start.ready", { window: target === wakeWindow ? "wake" : "main", provider: result.provider, fallbacks: result.fallbacks });
      return result;
    } catch (error) {
      recordTelemetryFailure({ type: "speech.failed", error, context: { phase: "start" } });
      throw error;
    }
  });
  ipcMain.handle("speech:stop", () => { logMain("speech.stop"); void stopSpeech(); return { ok: true }; });
  ipcMain.handle("speech:cancel", () => { logMain("speech.cancel"); cancelSpeech(); return { ok: true }; });
  ipcMain.handle("speech:chain", () => speechChain());
  ipcMain.handle("speech:test", (_event, kind: unknown) => {
    const scope = kind === "official" || kind === "openai" || kind === "local" || kind === "bailian" || kind === "bailian-ws" ? kind : "auto";
    return testSpeech(scope);
  });
  ipcMain.handle("voice-wake:start", (event, phrase: string) => {
    const voiceWakeWindow = getVoiceWakeWindow();
    return startVoiceWake(voiceWakeWindow?.webContents.id === event.sender.id ? voiceWakeWindow : undefined, phrase, () => {
      // Keep the hidden microphone window alive so the listener can be resumed
      // after the one-shot wake overlay closes.
      stopVoiceWake();
      void openWakeWindow().catch((error) => logMain("wake.open.failed", { error: String(error), reason: "voice" }));
    }).catch((error) => { recordTelemetryFailure({ type: "speech.failed", error, context: { phase: "voice-wake-start" } }); throw error; });
  });
  ipcMain.handle("voice-wake:stop", () => { stopVoiceWake(); return { ok: true }; });
  ipcMain.on("voice-wake:log", (_event, payload: unknown) => {
    const data = payload && typeof payload === "object" ? payload : { detail: String(payload) };
    console.info("[voice-wake] renderer", data);
    logMain("voice-wake.renderer", data);
  });
  ipcMain.on("speech:log", (_event, payload: unknown) => {
    const data = payload && typeof payload === "object" ? payload : { detail: String(payload) };
    console.info("[speech] renderer", data);
    logMain("speech.renderer", data);
  });
  ipcMain.handle("tts:synthesize", async (_event, text: string) => {
    if (typeof text !== "string" || !text.trim()) return "";
    const clean = text.slice(0, 1800);
    logMain("tts.synthesize.start", { characters: clean.length });
    try {
      const { config } = loadConfig(DEFAULT_WORKSPACE);
      const audio = await synthesizeSpeech(clean, config.tts);
      const encoded = audio.toString("base64");
      logMain("tts.synthesize.success", { bytes: audio.length, base64Characters: encoded.length, voice: config.tts?.voice, rate: config.tts?.rate });
      return encoded;
    } catch (error) {
      logMain("tts.synthesize.failed", { characters: clean.length, message: error instanceof Error ? error.message : String(error) });
      recordTelemetryFailure({ type: "speech.failed", error, context: { phase: "tts", inputLength: clean.length } });
      throw error;
    }
  });
  ipcMain.on("wake:tts-log", (_event, payload: unknown) => logMain("wake.tts.playback", payload));
  // TTS diagnostics: connectivity probe, active fallback chain, installed SAPI voices.
  ipcMain.handle("tts:test", (_event, kind?: string) => testTts(kind as never));
  ipcMain.handle("tts:chain", () => ttsChain());
  ipcMain.handle("tts:voices", () => listWindowsVoices());
  ipcMain.on("speech:audio", (_event, samples: Float32Array) => sendSpeechAudio(samples));
  ipcMain.on("voice-wake:audio", (_event, samples: Float32Array) => sendVoiceWakeAudio(samples));
}
