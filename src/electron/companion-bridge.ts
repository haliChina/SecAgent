/**
 * 伴随软件安装的提权桥（B2 自 main.ts 拆出，纯搬家）。
 *
 * Windows 上写对方软件的插件目录（Program Files 等）需要管理员令牌。
 * SecAgent 本身提权启动时直接复用自身令牌；否则按需拉起 UAC worker
 * （WindowsCompanionExecutor），并跨 IPC 调用串行化安装批次——
 * 批量安装与手动安装并发关闭/重启同一宿主会产生重复 UAC worker、
 * 宿主单例对话框与竞争包扫描。
 */
import { getWindowsProcessElevation, WindowsCompanionExecutor } from "../companion-package.js";
import { logMain } from "./main-log.js";

export async function createCompanionExecutor(): Promise<WindowsCompanionExecutor | undefined> {
  if (process.platform !== "win32") return undefined;
  const elevation = await getWindowsProcessElevation(logMain);
  // An administrator-launched SecAgent already has permission to write the
  // protected companion directories. Reusing that token avoids a second UAC
  // worker and lets restarted companions keep the same privilege level.
  if (elevation === true) {
    logMain("companion.executor.same-token", { elevated: true });
    return undefined;
  }
  // The executor logs its own startup stages ("elevated.start.*", "elevated.ready")
  // unprefixed; route them under "companion." so they land in
  // companion-install.jsonl next to the operations they explain.
  const executor = new WindowsCompanionExecutor((stage, data) => logMain(stage.startsWith("companion.") ? stage : `companion.${stage}`, data));
  logMain("companion.executor.created", { elevated: elevation === false ? false : "unknown" });
  return executor;
}

// A batch install and a manually clicked install can arrive through different
// IPC calls. They must not close/restart the same companion concurrently: that
// creates duplicate UAC workers, singleton dialogs and competing package scans.
let companionInstallQueue: Promise<void> = Promise.resolve();
export function withCompanionInstallLock<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const queuedAt = Date.now();
  logMain("companion.install.queue.wait", { label });
  const run = companionInstallQueue.then(async () => {
    const startedAt = Date.now();
    logMain("companion.install.queue.begin", { label, waitMs: startedAt - queuedAt });
    try {
      return await operation();
    } finally {
      logMain("companion.install.queue.end", { label, durationMs: Date.now() - startedAt });
    }
  });
  companionInstallQueue = run.then(() => undefined, () => undefined);
  return run;
}
