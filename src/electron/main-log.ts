/**
 * 主进程 JSONL 日志（B2 自 main.ts 拆出，纯搬家）。
 *
 * logs/electron-main.jsonl 全量；companion.* 前缀阶段同步追加到
 * companion-install.jsonl（安装器排障专用流）。
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_WORKSPACE } from "../paths.js";

export function logMain(stage: string, data: unknown = {}): void {
  const logDir = path.join(DEFAULT_WORKSPACE, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), stage, data }) + "\n";
  fs.appendFileSync(path.join(logDir, "electron-main.jsonl"), line, "utf8");
  if (stage.startsWith("companion.")) fs.appendFileSync(path.join(logDir, "companion-install.jsonl"), line, "utf8");
}
