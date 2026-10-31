/**
 * 敏感工具确认闸门域真源（B3 自 ipc-sessions.ts 拆出）。
 *
 * pending 确认注册表 + 5min 超时 + 「不再提示」签名持久化
 * （直写 yaml，不走全量 settings 重写）。行为与拆出前一致。
 */
import fs from "node:fs";
import crypto from "node:crypto";
import YAML from "yaml";
import { configPath } from "../config.js";
import { DEFAULT_WORKSPACE } from "../paths.js";
import { logMain } from "./main-log.js";
import { checkToolCall, approvalSignature, type GuardCheckRequest } from "../tool-guard.js";

const pendingToolConfirmations = new Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout; request: { tool: string; arguments: Record<string, unknown> }; windowHooks?: ToolConfirmWindowHooks }>();

/** 看起来会以全局组合键作用于"当前前台窗口"的命令（alt+F4 / SendKeys / xdotool 等）。 */
const GLOBAL_KEY_COMBO = /alt\s*\+\s*f4|%\{?f4\}?|sendkeys|keybd_event|xdotool\s+key|appactivate/i;

/** 窗口回调包：请求到达时把应用唤到前台（后台时弹层点不到），批准
 *  全局组合键类命令前把应用窗口退回后台（否则 Alt+F4 关掉的就是
 *  刚被唤起的本应用自己——R57 用户反馈）。 */
export interface ToolConfirmWindowHooks {
  raiseAppWindows?: () => void;
  yieldForeground?: () => void;
}

/** Pause the agent until the user approves a sensitive tool call (Codex-style). */
export function confirmSensitiveToolCall(
  sessionId: string,
  confirmation: { tool: string; arguments: Record<string, unknown>; reason: string },
  sendToAppWindows: (channel: string, payload: unknown) => void,
  windowHooks: ToolConfirmWindowHooks = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmationId = `tool-confirm-${crypto.randomUUID()}`;
    const timer = setTimeout(() => {
      pendingToolConfirmations.delete(confirmationId);
      logMain("tool.confirm.timeout", { confirmationId });
      resolve(false);
    }, 5 * 60_000);
    pendingToolConfirmations.set(confirmationId, { resolve, timer, request: { tool: confirmation.tool, arguments: confirmation.arguments }, windowHooks });
    logMain("tool.confirm.request", { confirmationId, sessionId, tool: confirmation.tool });
    sendToAppWindows("runtime:tool-confirmation", { confirmationId, sessionId, ...confirmation });
    // R57：每一次新确认都唤起应用窗口——之前只在首个请求时可见，
    // 后续确认（应用已回后台）需要用户手动切前台才能点"允许一次"。
    try { windowHooks.raiseAppWindows?.(); } catch (error) { logMain("tool.confirm.raise.failed", { error: error instanceof Error ? error.message : String(error) }); }
  });
}

/** Resolve a pending confirmation from the renderer; expired ids are rejected. */
export function resolveToolConfirmation(payload: { confirmationId: string; approved: boolean; always?: boolean }): { ok: boolean; error?: string } {
  const pending = pendingToolConfirmations.get(payload.confirmationId);
  if (!pending) return { ok: false, error: "确认请求已过期" };
  pendingToolConfirmations.delete(payload.confirmationId);
  clearTimeout(pending.timer);
  if (payload.approved && payload.always) {
    // Derive signature in the main process from the stored request, never trust renderer-supplied values
    const { request } = pending;
    const decision = checkToolCall(request, { enabled: true, approved: [] });
    const sig = approvalSignature(request, decision);
    if (sig) appendGuardApproval(sig);
  }
  logMain("tool.confirm.reply", { confirmationId: payload.confirmationId, approved: payload.approved, always: Boolean(payload.always) });
  // R57：批准的是全局组合键类命令时，先把本应用窗口让出前台，
  // 让 Alt+F4 之类作用于用户原本所在的前台窗口而非本应用。
  if (payload.approved) {
    const command = JSON.stringify(pending.request.arguments ?? {});
    if (GLOBAL_KEY_COMBO.test(command)) {
      logMain("tool.confirm.yield-foreground", { tool: pending.request.tool });
      try { pending.windowHooks?.yieldForeground?.(); } catch (error) { logMain("tool.confirm.yield.failed", { error: error instanceof Error ? error.message : String(error) }); }
    }
  }
  pending.resolve(payload.approved);
  return { ok: true };
}

/** Persist a "不再提示" approval straight into the yaml without a full settings rewrite. */
function appendGuardApproval(signature: string): void {
  try {
    const file = configPath(DEFAULT_WORKSPACE);
    const raw = YAML.parse(fs.readFileSync(file, "utf8")) as { guard?: { approved?: string[] } };
    const approved = new Set(raw?.guard?.approved || []);
    approved.add(signature);
    raw.guard = { ...(raw.guard || {}), approved: [...approved] };
    fs.writeFileSync(file, YAML.stringify(raw), "utf8");
  } catch (error) {
    logMain("tool.confirm.persist.failed", { error: error instanceof Error ? error.message : String(error) });
  }
}
