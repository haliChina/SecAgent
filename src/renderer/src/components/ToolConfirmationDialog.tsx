/**
 * 敏感操作确认弹层（B4 自 App.tsx 拆出；P3-4 键盘接管版）。
 *
 * 纯展示 + 回调；审批语义（签名计算/桥接应答）留在 App 层。
 * 键盘接管（P3-4）：Enter 允许一次 / Shift+Enter 总是允许此类 /
 * Esc 拒绝；挂载即夺取焦点，防止输入落到 composer（pending 期间
 * 对话框是唯一合法操作面）。后端 5min 超时兜底已有。
 */
import { useEffect, useRef } from "react";

interface ToolConfirmationRequest {
  confirmationId: string;
  tool: string;
  arguments: Record<string, unknown>;
  reason: string;
}

export function ToolConfirmationDialog({ confirmation, onResolve }: {
  confirmation: ToolConfirmationRequest;
  onResolve: (approved: boolean, always?: boolean) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  // 键盘接管在组件内部完成：弹层挂载期生效，卸载自动解绑
  useEffect(() => {
    cardRef.current?.focus();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Enter") { event.preventDefault(); onResolveRef.current(true, event.shiftKey); }
      else if (event.key === "Escape") { event.preventDefault(); onResolveRef.current(false); }
    };
    document.addEventListener("keydown", onKeydown, true);
    return () => document.removeEventListener("keydown", onKeydown, true);
  }, []);

  return <div className="tool-confirmation-overlay" role="dialog" aria-modal="true" aria-label="敏感操作确认">
    <div className="tool-confirmation-card" ref={cardRef} tabIndex={-1}>
      <h3>模型请求执行敏感操作</h3>
      <p className="tool-confirmation-reason">{confirmation.reason}</p>
      <div className="tool-confirmation-detail"><strong>{confirmation.tool}</strong><pre>{JSON.stringify(confirmation.arguments, null, 2).slice(0, 2000)}</pre></div>
      <p className="settings-help">允许后该操作将在本机执行。如不信任此请求请拒绝；拒绝后模型会收到拦截说明并尝试其他方式。</p>
      <p className="tool-confirmation-keys">Enter 允许一次 · Shift+Enter 总是允许此类 · Esc 拒绝</p>
      <div className="tool-confirmation-actions">
        <button type="button" className="secondary-button" onClick={() => onResolve(false)}>拒绝</button>
        <button type="button" className="secondary-button" onClick={() => onResolve(true, true)}>总是允许此类</button>
        <button type="button" className="primary-button" onClick={() => onResolve(true)}>允许一次</button>
      </div>
    </div>
  </div>;
}
