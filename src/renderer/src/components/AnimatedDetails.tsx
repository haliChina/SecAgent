import { ReactNode, useEffect, useRef, useState } from "react";

export function AnimatedDetails({ className, summary, children, autoOpen = false, stickyAutoOpen = false, summaryRef }: { className: string; summary: ReactNode; children: ReactNode; autoOpen?: boolean; stickyAutoOpen?: boolean; summaryRef?: { current: HTMLButtonElement | null } }) {
  const [open, setOpen] = useState(false);
  // stickyAutoOpen（流式推理面板用）：autoOpen 只负责"首次自动展开"，之后锁死，
  // 不再随 autoOpen 的布尔抖动反复收起（根因：流式逐字输出时 activity.content
  // 每帧变化 → activeStepKind/length 条件翻转 → setOpen 每帧切换 → 整框上下跳）。
  // 用户手动收起后也不会被 autoOpen 重新拉开；重置只发生在组件重新挂载（新一轮）。
  const everAutoOpenedRef = useRef(false);

  useEffect(() => {
    if (autoOpen) {
      if (!everAutoOpenedRef.current) {
        everAutoOpenedRef.current = true;
        setOpen(true);
      }
      return;
    }
    if (!stickyAutoOpen) setOpen(false);
  }, [autoOpen, stickyAutoOpen]);

  const expanded = open;
  return <div className={`${className} animated-details ${expanded ? "is-open" : ""}`}>
    <button ref={summaryRef} type="button" className="details-summary" aria-expanded={expanded} onClick={() => setOpen((current) => !current)}>
      {summary}
    </button>
    <div className="details-panel" aria-hidden={!expanded}><div className="details-panel-inner">{children}</div></div>
  </div>;
}
