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
  appendRotated(path.join(logDir, "electron-main.jsonl"), line);
  if (stage.startsWith("companion.")) appendRotated(path.join(logDir, "companion-install.jsonl"), line);
}

/* R75（审计 P1-6）：实测 electron-main.jsonl 累积 275MB 且从不清理——写日志
   本身轻，但文件无限长拖慢启动时的诊断读取、遥测导出，也浪费磁盘。超过
   50MB 轮转：现文件改存 .1（覆盖旧 .1），重新起头。截断比保留两份全量更
   有效——日志的消费场景（排障）只关心最近事件。 */
const LOG_ROTATE_BYTES = 50 * 1024 * 1024;
const rotateChecked = new Set<string>();
const logWriteCounter = { writes: 0 };

function appendRotated(file: string, line: string): void {
  try {
    if (!rotateChecked.has(file)) {
      rotateChecked.add(file);
      try {
        const size = fs.statSync(file).size;
        if (size > LOG_ROTATE_BYTES) fs.renameSync(file, `${file}.1`);
      } catch { /* 文件不存在——首写 */ }
    }
    fs.appendFileSync(file, line, "utf8");
    // 每千次写重新 stat 一次体积（appendFileSync 本身不触发检查）
    logWriteCounter.writes += 1;
    if (logWriteCounter.writes >= 1000) {
      logWriteCounter.writes = 0;
      rotateChecked.clear();
    }
  } catch {
    /* 日志失败不阻断主流程 */
  }
}
