import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function ImagePreviewDialog({ attachment, onClose }: { attachment: ChatAttachment; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // showModal 让背景真正 inert，并由浏览器处理 Tab 圈禁与嵌套弹窗。
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialogRef} className="image-preview-backdrop" aria-label={`预览 ${attachment.name}`}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="image-preview">
      <button type="button" className="image-preview-close" aria-label="关闭图片预览" autoFocus onClick={onClose}><X size={20} aria-hidden /></button>
      <img src={attachment.dataUrl} alt={attachment.name} />
    </div>
  </dialog>;
}
