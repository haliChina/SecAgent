/**
 * TTS 磁盘缓存：重复朗读同一段文本时直接复用音频，避免每次唤醒/重读都打一次
 * 在线 TTS。key = sha256(provider|voice|rate|text)，文件落在工作区 tts-cache/。
 * 命中时刷新时间戳作为 LRU；写入后按条目数与总字节做一次裁剪（60s 节流）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_WORKSPACE } from "./paths.js";

const CACHE_DIR = path.join(DEFAULT_WORKSPACE, "tts-cache");
const EXTENSION = ".audio";
const MAX_ENTRIES = 512;
const MAX_BYTES = 64 * 1024 * 1024;
const PRUNE_INTERVAL_MS = 60_000;

interface TtsCacheKey {
  provider: string;
  voice: string;
  rate: string;
  text: string;
}

let lastPrune = 0;

function cacheFile(key: TtsCacheKey): string {
  const digest = crypto.createHash("sha256").update(`${key.provider}\u0000${key.voice}\u0000${key.rate}\u0000${key.text}`).digest("hex");
  return path.join(CACHE_DIR, `${digest}${EXTENSION}`);
}

/** 命中返回音频字节；未命中/读取失败返回 undefined。 */
export function readTtsCache(key: TtsCacheKey): Buffer | undefined {
  const file = cacheFile(key);
  try {
    const data = fs.readFileSync(file);
    const now = new Date();
    try { fs.utimesSync(file, now, now); } catch { /* LRU 时间戳刷新失败不影响命中 */ }
    return data.length ? data : undefined;
  } catch {
    return undefined;
  }
}

/** 原子写入（临时文件 + rename），失败静默——缓存永远只是加速手段。 */
export function writeTtsCache(key: TtsCacheKey, data: Buffer): void {
  if (!data.length) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = cacheFile(key);
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch {
    return;
  }
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  pruneTtsCache();
}

/** LRU 裁剪：按最近使用时间淘汰，直到条目数与总字节回到上限内。 */
function pruneTtsCache(): void {
  try {
    const entries = fs.readdirSync(CACHE_DIR)
      .filter((name) => name.endsWith(EXTENSION))
      .map((name) => {
        const file = path.join(CACHE_DIR, name);
        try {
          const stat = fs.statSync(file);
          return { file, size: stat.size, lastUsed: stat.mtimeMs };
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is { file: string; size: number; lastUsed: number } => !!entry);
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (entries.length <= MAX_ENTRIES && total <= MAX_BYTES) return;
    entries.sort((a, b) => a.lastUsed - b.lastUsed);
    let count = entries.length;
    for (const entry of entries) {
      if (count <= MAX_ENTRIES && total <= MAX_BYTES) break;
      try {
        fs.rmSync(entry.file, { force: true });
        total -= entry.size;
        count -= 1;
      } catch { /* 单个删除失败继续淘汰下一个 */ }
    }
  } catch { /* 缓存目录不可读时保持现状 */ }
}
