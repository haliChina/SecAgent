/**
 * R87：KWS 从 Electron 主进程移到 worker_threads。
 *
 * 主进程只负责音频转发；sherpa-onnx 的同步 decode 跑在独立线程，
 * 不再和 UI、模型流、IPC 抢同一个事件循环。worker 用 eval 方式加载，
 * 避免 electron-vite 额外打一个 worker 入口；sherpa 绝对路径由主进程传入。
 */
export const VOICE_WAKE_WORKER_SOURCE = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");

let kws = null;
let stream = null;
let paused = false;

function post(type, payload) {
  try { parentPort.postMessage(Object.assign({ type }, payload || {})); } catch { /* parent gone */ }
}
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

try {
  if (!workerData || typeof workerData.modulePath !== "string" || typeof workerData.root !== "string") {
    throw new Error("唤醒 Worker 参数缺失");
  }
  const root = workerData.root;
  if (!fs.existsSync(root)) throw new Error("找不到语音唤醒模型目录：" + root);
  const sherpa = require(workerData.modulePath);
  kws = sherpa.createKws({
    featConfig: { samplingRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(root, "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx"),
        decoder: path.join(root, "decoder-epoch-13-avg-2-chunk-16-left-64.onnx"),
        joiner: path.join(root, "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx")
      },
      tokens: path.join(root, "tokens.txt"),
      provider: "cpu",
      numThreads: Number(workerData.numThreads) || 2,
      modelingUnit: "ppinyin"
    },
    maxActivePaths: 4,
    numTrailingBlanks: 2,
    keywordsScore: Number(workerData.keywordsScore) || 1.4,
    keywordsThreshold: Number(workerData.keywordsThreshold) || 0.15,
    keywords: String(workerData.keywords || "")
  });
  stream = kws.createStream();
  post("ready");
} catch (error) {
  post("error", { message: describe(error) });
}

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "audio") {
    if (paused || !kws || !stream) return;
    try {
      stream.acceptWaveform(16000, message.samples);
      while (kws.isReady(stream)) kws.decode(stream);
      const result = kws.getResult(stream);
      if (result && result.keyword) {
        kws.reset(stream);
        post("detected", { keyword: result.keyword });
      }
    } catch (error) {
      post("error", { message: describe(error) });
    }
    return;
  }
  if (message.type === "pause") {
    paused = true;
    if (kws && stream) { try { kws.reset(stream); } catch { /* best effort */ } }
    post("paused");
    return;
  }
  if (message.type === "resume") {
    paused = false;
    if (kws && stream) { try { kws.reset(stream); } catch { /* best effort */ } }
    post("resumed");
    return;
  }
  if (message.type === "stop") {
    paused = true;
    try { kws && kws.free(); } catch { /* already freed */ }
    kws = null;
    stream = null;
    post("stopped");
    try { parentPort.close(); } catch { /* ignore */ }
  }
});
`;