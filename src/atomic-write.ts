import fs from "node:fs";
import path from "node:path";

/**
 * 原子写文件：同目录临时文件写完后 rename 替换。
 *
 * 背景（架构审查）：plugin-manager 的 plugins.json 早已用 tmp+rename，但
 * 配置（secagent.yaml/.env）、会话（session.json/index.json）与模型健康状态
 * 仍是直接 writeFileSync——进程崩溃或断电恰好落在写入中途时，目标文件会
 * 留下半截 JSON/YAML，下次启动整个设置或会话无法解析（表现为「配置丢失」）。
 * rename 在同一文件系统内是原子的：要么旧文件完整，要么新文件完整。
 */
export function writeFileAtomic(file: string, data: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 清理失败不应掩盖写入错误 */ }
    throw error;
  }
}
