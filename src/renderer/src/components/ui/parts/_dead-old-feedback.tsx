/**
 * UI Bits — 参考组件移植（A 清爽浅色 · Notion/Linear 系）。
 *
 * R14 起放弃自研动效（弹簧物理/CSS 过渡替代方案与原版手感差距过大）：
 * 直接引入 rare-ui 同款动画引擎 motion/react，组件按 GitHub 源码直译，
 * 类名原样保留（Tailwind utilities），动效参数与原版逐项一致。
 *
 * 设计参考与实现来源：
 *  - rareui（github.com/swamimalode07/rare-ui，MIT）: matrixorb / deletebutton /
 *    scrollprogress / hooksidebar / voicenote / animatedcounter —— 逐行直译自
 *    components/ui/ 下源文件，仅做 Electron/无路由环境适配（见各组件注释）。
 *  - assistant-ui.com: tool-error / guardrail-notice / message-actions / error-state /
 *    message-queue / stopped-run / day-separator / speaker-identity / regenerate-menu /
 *    computer-use / number-ticker
 *  - reactbits.dev: voice-pill / thought-line / branched-menu
 *
 * 设计参考致谢：rareui.com / assistant-ui.com / reactbits.dev（详见 README 开源致谢）。
 *
 * 交互状态同时用文字/形状表达；触屏目标 ≥44px；动画尊重 prefers-reduced-motion。
 */
import { Fragment, createContext, isValidElement, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref, type RefObject } from "react";
import { AnimatePresence, animate, motion, useMotionTemplate, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue, type Transition } from "motion/react";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import { AlertCircleIcon, Loader2Icon, RotateCwIcon, ArrowUpIcon, XIcon, RefreshCwIcon, UserIcon, WrenchIcon, BotIcon, MousePointer2Icon, MicIcon, ArrowLeftIcon, DownloadIcon, RocketIcon, SettingsIcon, PaintbrushIcon, TypeIcon, LayersIcon, BellIcon, ChevronDownIcon, PaperclipIcon, CalendarIcon, ChartLineIcon, FileIcon, GlobeIcon, MailIcon, PlusIcon, SparklesIcon, CheckIcon, ShieldIcon, CopyIcon, ThumbsUpIcon, ThumbsDownIcon, EllipsisIcon, SquareIcon, ArrowRightIcon, CircleAlertIcon } from "lucide-react";

/** rare-ui 的 cn 为 twMerge(clsx(...))；本项目无 Tailwind 类冲突合并需求，clsx 等价 */
const cn = clsx;

/* ------------------------------------------------------------------ */
/* MessageActions (assistant-ui) — 消息操作行：复制/重试，就地确认          */
/* ------------------------------------------------------------------ */
export function MessageActions({ onCopy, onRetry }: { onCopy?: () => void; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="message-actions" role="toolbar" aria-label="消息操作">
      {onCopy && (
        <button type="button" className="message-action" onClick={() => { onCopy(); setCopied(true); }}>
          <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
          <span>{copied ? "已复制" : "复制"}</span>
        </button>
      )}
      {onRetry && (
        <button type="button" className="message-action" onClick={onRetry}>
          <span aria-hidden="true">↻</span>
          <span>重试</span>
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ToolErrorCard (assistant-ui tool-error) — 工具调用失败卡                */
/* ------------------------------------------------------------------ */
export function ToolErrorCard({ tool, message, attempts }: { tool: string; message: string; attempts?: number }) {
  return (
    <div className="tool-error-card" role="alert">
      <div className="tool-error-head">
        <span className="tool-error-badge" aria-hidden="true">!</span>
        <strong>{tool} 调用失败</strong>
        {attempts !== undefined && attempts > 1 && <span className="tool-error-attempts">已尝试 {attempts} 次</span>}
      </div>
      <p className="tool-error-message">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ErrorStateCard (assistant-ui error-state) — 连接/运行错误状态           */
/* ------------------------------------------------------------------ */
export function ErrorStateCard({ title, detail, action }: { title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="error-state-card" role="alert">
      <div className="error-state-icon" aria-hidden="true">!</div>
      <div className="error-state-body">
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
        {action}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GuardrailNotice (assistant-ui) — 护栏提示（幻觉检测、拦截说明）          */
/* ------------------------------------------------------------------ */
export function GuardrailNotice({ title, detail }: { title: string; detail?: ReactNode }) {
  return (
    <div className="guardrail-notice" role="note">
      <span className="guardrail-icon" aria-hidden="true">◇</span>
      <div className="guardrail-body">
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StoppedRunTag (assistant-ui stopped-run) — 运行被停止标记               */
/* ------------------------------------------------------------------ */
export function StoppedRunTag({ at }: { at?: string }) {
  return (
    <div className="stopped-run-tag" role="presentation">
      <span className="stopped-run-square" aria-hidden="true" />
      <span>已停止{at ? ` · ${at}` : ""}</span>
    </div>
  );
}
