/**
 * R87：本地 ASR Worker 源码（eval worker）。
 *
 * `mode=sherpa`：流式 zipformer，边收边出 partial/final。
 * `mode=sensevoice`：整句离线识别，收到 stop 才 decode（低端机不做
 * 3.5s 全量 partial，避免 O(n²) 解码把 CPU 打满）。
 *
 * 模型只加载一次，worker 常驻；start/stop 只重置流，不重复加载模型。
 */
export const LOCAL_ASR_WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");

let recognizer = null;
let stream = null;
let sinkProvider = "";
let mode = "";
let running = false;
let buffers = [];

function post(type, payload) {
  try { parentPort.postMessage(Object.assign({ type }, payload || {})); } catch { /* parent gone */ }
}
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
function reset() {
  if (stream) { try { stream.free(); } catch { /* already freed */ } }
  stream = null;
  buffers = [];
  running = false;
}

try {
  if (!workerData || typeof workerData.modulePath !== "string") throw new Error("本地 ASR Worker 参数缺失");
  const sherpa = require(workerData.modulePath);
  mode = workerData.mode === "sensevoice" ? "sensevoice" : "sherpa";
  sinkProvider = mode === "sensevoice" ? "local-pro" : "local";
  if (mode === "sherpa") {
    const root = workerData.root;
    if (!fs.existsSync(root)) throw new Error("找不到本地语音模型目录：" + root);
    recognizer = sherpa.createOnlineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: path.join(root, "encoder-epoch-99-avg-1.int8.onnx"),
          decoder: path.join(root, "decoder-epoch-99-avg-1.onnx"),
          joiner: path.join(root, "joiner-epoch-99-avg-1.onnx")
        },
        tokens: path.join(root, "tokens.txt"),
        provider: "cpu",
        numThreads: Number(workerData.numThreads) || 1
      },
      enableEndpoint: 1,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20
    });
  } else {
    const dir = workerData.root;
    if (!fs.existsSync(dir)) throw new Error("找不到 SenseVoice 附加包目录：" + dir);
    const OfflineRecognizer = sherpa.OfflineRecognizer;
    if (typeof OfflineRecognizer !== "function") throw new Error("当前 sherpa-onnx 版本不支持 SenseVoice");
    recognizer = new OfflineRecognizer({
      modelConfig: {
        senseVoice: { model: path.join(dir, "model.int8.onnx"), useInverseTextNormalization: 1 },
        tokens: path.join(dir, "tokens.txt"),
        numThreads: Number(workerData.numThreads) || 2,
        debug: 0,
        provider: "cpu"
      }
    });
  }
  post("ready", { provider: sinkProvider });
} catch (error) {
  post("error", { provider: sinkProvider, message: describe(error) });
}

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "start") {
    reset();
    buffers = [];
    running = true;
    if (mode === "sherpa") stream = recognizer.createStream();
    post("started", { provider: sinkProvider });
    return;
  }
  if (message.type === "audio") {
    if (!running || !recognizer) return;
    if (mode === "sensevoice") {
      buffers.push(message.samples);
      let total = 0;
      for (const chunk of buffers) total += chunk.length;
      while (total > 16000 * 120 && buffers.length > 1) total -= buffers.shift().length;
      return;
    }
    try {
      stream.acceptWaveform(16000, message.samples);
      while (recognizer.isReady(stream)) recognizer.decode(stream);
      if (recognizer.isEndpoint(stream)) {
        const text = (recognizer.getResult(stream).text || "").trim();
        if (text) post("final", { provider: sinkProvider, text });
        recognizer.reset(stream);
      } else {
        const text = (recognizer.getResult(stream).text || "").trim();
        if (text) post("partial", { provider: sinkProvider, text });
      }
    } catch (error) {
      post("error", { provider: sinkProvider, message: describe(error) });
    }
    return;
  }
  if (message.type === "stop") {
    if (!running) { post("stopped", { provider: sinkProvider }); return; }
    running = false;
    try {
      if (mode === "sensevoice") {
        let length = 0;
        for (const chunk of buffers) length += chunk.length;
        const merged = new Float32Array(length);
        let offset = 0;
        for (const chunk of buffers) { merged.set(chunk, offset); offset += chunk.length; }
        buffers = [];
        if (merged.length) {
          const s = recognizer.createStream();
          s.acceptWaveform(16000, merged);
          recognizer.decode(s);
          const text = (recognizer.getResult(s).text || "").trim();
          try { s.free(); } catch { /* already freed */ }
          if (text) post("final", { provider: sinkProvider, text });
        }
      } else if (stream) {
        stream.inputFinished();
        while (recognizer.isReady(stream)) recognizer.decode(stream);
        const text = (recognizer.getResult(stream).text || "").trim();
        if (text) post("final", { provider: sinkProvider, text });
      }
    } catch (error) {
      post("error", { provider: sinkProvider, message: describe(error) });
    }
    reset();
    post("stopped", { provider: sinkProvider });
    return;
  }
  if (message.type === "cancel") {
    reset();
    post("stopped", { provider: sinkProvider });
    return;
  }
});
`;