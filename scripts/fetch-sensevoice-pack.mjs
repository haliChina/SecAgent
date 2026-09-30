#!/usr/bin/env node
/**
 * 本地模型升级附加包安装器 — SenseVoice (sherpa-onnx int8, ~230MB).
 *
 * Downloads the official sherpa-onnx SenseVoice pack and unpacks it to
 * `models/sense-voice/` next to the resources the app searches:
 *   - dev:  <repo>/models/sense-voice
 *   - installed desktop app: <resources>/models/sense-voice   (pass --out <dir>)
 *
 * Usage:
 *   node scripts/fetch-sensevoice-pack.mjs            # dev (repo/models)
 *   node scripts/fetch-sensevoice-pack.mjs --out "C:\Program Files\SecAgent\resources"
 *
 * Source: https://github.com/k2-fsa/sherpa-onnx/releases (asr-models)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const URL_BASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8.tar.bz2";
const FILES = ["model.int8.onnx", "tokens.txt"];

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const targetRoot = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : path.resolve(process.cwd(), "models");
const packDir = path.join(targetRoot, "sense-voice");

function have(files) { return files.every((f) => fs.existsSync(path.join(packDir, f))); }

if (have(FILES)) {
  console.log(`✓ SenseVoice 附加包已存在：${packDir}（如需重装请先删除该目录）`);
  process.exit(0);
}

fs.mkdirSync(packDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sensevoice-"));
const archive = path.join(tmp, "pack.tar.bz2");

console.log("↓ 下载 SenseVoice int8 附加包（约 230 MB，只需一次）…");
console.log("  " + URL_BASE);
const response = await fetch(URL_BASE, { redirect: "follow" });
if (!response.ok || !response.body) { console.error(`✗ 下载失败：HTTP ${response.status}`); process.exit(1); }
let seen = 0;
const total = Number(response.headers.get("content-length") || 0);
const tracked = new Readable().wrap(response.body);
tracked.on("data", (chunk) => {
  seen += chunk.length;
  if (total) process.stdout.write(`\r  ${(seen / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
});
await pipeline(tracked, fs.createWriteStream(archive));
process.stdout.write("\n");

console.log("→ 解压（tar xjf）…");
const child = spawn("tar", ["-xjf", archive, "-C", tmp, "--strip-components", "1"], { stdio: "inherit" });
await new Promise((resolve, reject) => child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar 退出码 ${code}`)))));

for (const file of FILES) {
  const from = path.join(tmp, file);
  const to = path.join(packDir, file);
  fs.copyFileSync(from, to);
}
fs.rmSync(tmp, { recursive: true, force: true });
const size = FILES.map((f) => fs.statSync(path.join(packDir, f)).size).reduce((a, b) => a + b, 0);
console.log(`✓ 安装完成：${packDir}（${(size / 1048576).toFixed(1)} MB）`);
console.log("  在 SecAgent 设置 → 语音识别 中选择「本地增强（SenseVoice 附加包）」即可启用。");
