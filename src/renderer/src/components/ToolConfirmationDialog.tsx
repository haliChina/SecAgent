/**
 * 敏感操作确认弹层（B4 自 App.tsx 拆出）。
 *
 * 纯展示 + 回调；审批语义（签名计算/桥接应答）留在 App 层。
 */
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
  return <div className="tool-confirmation-overlay" role="dialog" aria-modal="true" aria-label="敏感操作确认">
    <div className="tool-confirmation-card">
      <h3>模型请求执行敏感操作</h3>
      <p className="tool-confirmation-reason">{confirmation.reason}</p>
      <div className="tool-confirmation-detail"><strong>{confirmation.tool}</strong><pre>{JSON.stringify(confirmation.arguments, null, 2).slice(0, 2000)}</pre></div>
      <p className="settings-help">允许后该操作将在本机执行。如不信任此请求请拒绝；拒绝后模型会收到拦截说明并尝试其他方式。</p>
      <div className="tool-confirmation-actions">
        <button type="button" className="secondary-button" onClick={() => onResolve(false)}>拒绝</button>
        <button type="button" className="secondary-button" onClick={() => onResolve(true, true)}>总是允许此类</button>
        <button type="button" className="primary-button" onClick={() => onResolve(true)}>允许一次</button>
      </div>
    </div>
  </div>;
}
