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

const pendingToolConfirmations = new Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout; request: { tool: string; arguments: Record<string, unknown> } }>();

/** Pause the agent until the user approves a sensitive tool call (Codex-style). */
export function confirmSensitiveToolCall(
  sessionId: string,
  confirmation: { tool: string; arguments: Record<string, unknown>; reason: string },
  sendToAppWindows: (channel: string, payload: unknown) => void
): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmationId = `tool-confirm-${crypto.randomUUID()}`;
    const timer = setTimeout(() => {
      pendingToolConfirmations.delete(confirmationId);
      logMain("tool.confirm.timeout", { confirmationId });
      resolve(false);
    }, 5 * 60_000);
    pendingToolConfirmations.set(confirmationId, { resolve, timer, request: { tool: confirmation.tool, arguments: confirmation.arguments } });
    logMain("tool.confirm.request", { confirmationId, sessionId, tool: confirmation.tool });
    sendToAppWindows("runtime:tool-confirmation", { confirmationId, sessionId, ...confirmation });
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
