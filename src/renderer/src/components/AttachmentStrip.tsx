/**
 * R87：历史消息附件只带骨架（dataUrl 为空）；图片在接近视口时才通过
 * sessions:attachment 按需读取。这样切换长会话时不会把全部 base64 图片
 * 同时解码进渲染进程，显著降低 8GB OPS 的峰值内存。
 */
import { useEffect, useRef, useState } from "react";

function AttachmentThumb({ attachment, messageId, removable, onRemove, onOpen }: {
  attachment: ChatAttachment;
  messageId?: string;
  removable?: boolean;
  onRemove?: (id: string) => void;
  onOpen?: (attachment: ChatAttachment) => void;
}) {
  const [src, setSrc] = useState(attachment.dataUrl || "");
  const [failed, setFailed] = useState(false);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSrc(attachment.dataUrl || "");
    setFailed(false);
  }, [attachment.id, attachment.dataUrl]);

  useEffect(() => {
    if (src || failed || !messageId || !attachment.id) return;
    const holder = holderRef.current;
    if (!holder) return;
    let cancelled = false;
    let observer: IntersectionObserver | undefined;
    const load = (): void => {
      void window.secagent.loadAttachment(messageId, attachment.id).then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      }).catch(() => {
        if (!cancelled) setFailed(true);
      });
    };
    if (!("IntersectionObserver" in window)) {
      load();
      return () => { cancelled = true; };
    }
    observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer?.disconnect();
      load();
    }, { rootMargin: "360px 0px" });
    observer.observe(holder);
    return () => { cancelled = true; observer?.disconnect(); };
  }, [src, failed, messageId, attachment.id]);

  const canPreview = Boolean(onOpen && src);
  return <div className={`attachment-card ${src ? "" : "attachment-loading"}`} ref={holderRef} title={attachment.name}>
    {src ? (
      canPreview
        ? <button type="button" className="attachment-preview-button" aria-label={`预览 ${attachment.name}`} onClick={() => onOpen?.({ ...attachment, dataUrl: src })}>
            <img src={src} alt={attachment.name} loading="lazy" decoding="async" />
          </button>
        : <img src={src} alt={attachment.name} loading="lazy" decoding="async" />
    ) : <span className="attachment-placeholder" role="status" aria-label={failed ? `${attachment.name} 加载失败` : `正在加载 ${attachment.name}`}>
        {failed ? "!" : ""}
      </span>}
    {removable && <button type="button" className="attachment-remove" aria-label={`移除 ${attachment.name}`} onClick={() => onRemove?.(attachment.id)}>×</button>}
  </div>;
}

export function AttachmentStrip({ attachments, messageId, removable = false, onRemove, onOpen }: { attachments: ChatAttachment[]; messageId?: string; removable?: boolean; onRemove?: (id: string) => void; onOpen?: (attachment: ChatAttachment) => void }) {
  if (!attachments.length) return null;
  return <div className={`attachment-strip ${removable ? "composer-attachment-strip" : "message-attachment-strip"}`}>
    {attachments.map((attachment) => <AttachmentThumb
      key={attachment.id}
      attachment={attachment}
      messageId={messageId}
      removable={removable}
      onRemove={onRemove}
      onOpen={onOpen}
    />)}
  </div>;
}