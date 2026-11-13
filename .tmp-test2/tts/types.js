/**
 * TTS (text-to-speech) contracts shared by every provider.
 *
 * The core layer stays Electron-free: providers turn text into playable audio
 * buffers; the Electron glue (src/electron/tts-bridge.ts) routes them to the
 * renderer over IPC.
 */
export {};
