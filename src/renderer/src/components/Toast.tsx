/** R82 浮层提示：会话操作失败原先插在消息流顶部，用户滚到下方时
 * 根本看不见。改为固定在输入栏上方的 toast，错误用 role=alert，
 * 成功/信息用 role=status；7 秒自动消退，也可手动关闭。 */
import { useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastTone = "error" | "success" | "info";

export function Toast({ message, tone = "error", onClose }: { message: string; tone?: ToastTone; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => closeRef.current(), 7000);
    return () => window.clearTimeout(timer);
  }, [message, tone]);
  if (!message) return null;
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;
  return <div className={`app-toast ${tone}`} role={tone === "error" ? "alert" : "status"}>
    <Icon size={16} aria-hidden />
    <p>{message}</p>
    <button type="button" aria-label="关闭提示" onClick={onClose}><X size={14} aria-hidden /></button>
  </div>;
}
