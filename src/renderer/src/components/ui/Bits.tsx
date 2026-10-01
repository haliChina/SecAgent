/**
 * UI Bits — 参考组件的自研复刻（A 清爽浅色 · Notion/Linear 系）。
 *
 * 设计参考：
 *  - rareui.com: matrixorb / deletebutton / scrollprogressindicator / hooksidebar / voicenote / animatedcounter
 *  - assistant-ui.com: tool-error / guardrail-notice / message-actions / error-state /
 *    message-queue / stopped-run / day-separator / speaker-identity / regenerate-menu /
 *    computer-use / number-ticker
 *  - reactbits.dev: voice-pill / thought-line / branched-menu
 *
 * 约束：纯 React + 全局 styles.css，零新增 npm 依赖（Electron 打包友好）。
 * 交互状态同时用文字/形状表达；触屏目标 ≥44px；动画尊重 prefers-reduced-motion。
 */
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* ScrollProgressIndicator (rareui) — 消息流顶部细进度条                   */
/* ------------------------------------------------------------------ */
export function ScrollProgress({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // 会话历史异步加载、流式输出都会改变 scrollHeight：监听内容变化（ResizeObserver + MutationObserver），
    // 并用 rAF 合并高频事件（流式逐字符时避免每帧多次强制布局）。
    let frame = 0;
    const update = (): void => {
      const max = element.scrollHeight - element.clientHeight;
      setProgress(max > 4 ? Math.min(1, Math.max(0, element.scrollTop / max)) : 1);
    };
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    update();
    element.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const mutations = new MutationObserver(schedule);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      element.removeEventListener("scroll", schedule);
      resize.disconnect();
      mutations.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [container]);
  return (
    <div className="scroll-progress" role="presentation">
      <div className="scroll-progress-bar" style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MatrixOrb (rareui) — 空状态装饰：CSS 球面点阵 + 缓慢自转               */
/* ------------------------------------------------------------------ */
export function MatrixOrb({ size = 96 }: { size?: number }) {
  const dots: Array<{ x: number; y: number; z: number }> = [];
  const rings = 7;
  const perRing = 14;
  for (let ring = 0; ring < rings; ring += 1) {
    const phi = (ring / (rings - 1)) * Math.PI;
    for (let i = 0; i < perRing; i += 1) {
      const theta = (i / perRing) * Math.PI * 2;
      dots.push({
        x: Math.sin(phi) * Math.cos(theta),
        y: Math.cos(phi),
        z: Math.sin(phi) * Math.sin(theta)
      });
    }
  }
  return (
    <div className="matrix-orb" style={{ width: size, height: size }} aria-hidden="true">
      <div className="matrix-orb-core" />
      <div className="matrix-orb-dots">
        {dots.map((dot, index) => (
          <span
            key={index}
            style={{
              left: `${50 + dot.x * 42}%`,
              top: `${50 - dot.y * 42}%`,
              opacity: 0.25 + dot.z * 0.35,
              animationDelay: `${(index % perRing) * 90}ms`
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DaySeparator (assistant-ui) — 消息流日期分隔                           */
/* ------------------------------------------------------------------ */
export function daySeparatorLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const startOfDay = (value: Date): number => Math.floor(value.getTime() / 86_400_000);
  const days = startOfDay(now) - startOfDay(date);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="day-separator" role="presentation">
      <span className="day-separator-line" />
      <span className="day-separator-label">{label}</span>
      <span className="day-separator-line" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ThoughtLine (reactbits) — 思考中 → 已思考 X 秒                        */
/* ------------------------------------------------------------------ */
export function ThoughtLine({ label, elapsedSeconds, done }: { label: string; elapsedSeconds?: number; done?: boolean }) {
  return (
    <div className={`thought-line ${done ? "done" : ""}`} role="status">
      <span className="thought-line-spinner" aria-hidden="true" />
      <span className="thought-line-label">
        {done ? `已思考${elapsedSeconds !== undefined ? ` ${Math.max(1, Math.round(elapsedSeconds))} 秒` : ""}` : label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* VoicePill (reactbits) — 录音电平 pill（模拟电平；真实录音由宿主接线）     */
/* ------------------------------------------------------------------ */
export function VoicePill({ recording, label }: { recording: boolean; label: string }) {
  const bars = 14;
  return (
    <div className={`voice-pill ${recording ? "recording" : ""}`} aria-live="polite">
      <span className="voice-pill-dot" aria-hidden="true" />
      <span className="voice-pill-label">{label}</span>
      <span className="voice-pill-wave" aria-hidden="true">
        {recording && Array.from({ length: bars }, (_, index) => (
          <i key={index} style={{ animationDelay: `${index * 60}ms`, height: `${8 + ((index * 7) % 22)}px` }} />
        ))}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DeleteButton (rareui) — 两段式确认删除                                  */
/* ------------------------------------------------------------------ */
export function DeleteButton({ onConfirm, ariaLabel, children = "删除" }: { onConfirm: () => void; ariaLabel?: string; children?: ReactNode }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 2600);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`delete-button ${armed ? "armed" : ""}`}
      aria-label={ariaLabel}
      aria-pressed={armed}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      <span className="delete-button-icon" aria-hidden="true">×</span>
      <span className="delete-button-copy">{armed ? "确认删除" : children}</span>
    </button>
  );
}

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

/* ------------------------------------------------------------------ */
/* SpeakerTag (assistant-ui speaker-identity) — 说话人标签                 */
/* ------------------------------------------------------------------ */
export function SpeakerTag({ name }: { name: string }) {
  return <span className="speaker-tag"><span className="speaker-tag-dot" aria-hidden="true" />{name}</span>;
}

/* ------------------------------------------------------------------ */
/* VoiceNote (rareui voicenote) — 语音便签回放条                          */
/* ------------------------------------------------------------------ */
export function VoiceNote({ durationSeconds }: { durationSeconds: number }) {
  const [playing, setPlaying] = useState(false);
  const bars = 26;
  return (
    <div className="voice-note" role="group" aria-label={`语音消息 ${durationSeconds} 秒`}>
      <button
        type="button"
        className={`voice-note-play ${playing ? "playing" : ""}`}
        aria-label={playing ? "暂停播放" : "播放语音"}
        aria-pressed={playing}
        onClick={() => setPlaying((current) => !current)}
      >
        <span aria-hidden="true">{playing ? "❙❙" : "▶"}</span>
      </button>
      <span className="voice-note-wave" aria-hidden="true">
        {Array.from({ length: bars }, (_, index) => (
          <i key={index} style={{ height: `${6 + ((index * 11) % 18)}px`, animationDelay: `${index * 40}ms` }} />
        ))}
      </span>
      <span className="voice-note-duration">{durationSeconds}″</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AnimatedCounter (rareui animatedcounter / assistant-ui number-ticker)  */
/* ------------------------------------------------------------------ */
export function AnimatedCounter({
  value,
  format,
  durationMs = 900,
  style
}: { value: number; format?: (value: number) => string; durationMs?: number; style?: CSSProperties }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return <span className="animated-counter" style={style}>{format ? format(display) : Math.round(display).toLocaleString()}</span>;
}

/* ------------------------------------------------------------------ */
/* MessageQueue (assistant-ui) — 排队中的消息指示                         */
/* ------------------------------------------------------------------ */
export function MessageQueue({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="message-queue" role="status">
      <span className="message-queue-badge">{count}</span>
      <span>{count === 1 ? "一条消息排队中" : `${count} 条消息排队中`}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ComputerUseCard (assistant-ui computer-use) — 截图/识图工具预览          */
/* ------------------------------------------------------------------ */
export function ComputerUseCard({ tool, summary }: { tool: string; summary: string }) {
  return (
    <div className="computer-use-card" role="figure" aria-label={`${tool} 结果`}>
      <div className="computer-use-viewport" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      <div className="computer-use-copy">
        <strong>{tool}</strong>
        <p>{summary}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RegenerateMenu (assistant-ui) — 重新生成菜单                          */
/* ------------------------------------------------------------------ */
export function RegenerateMenu({ onRegenerate }: { onRegenerate: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="regenerate-menu">
      <button
        type="button"
        className={`regenerate-trigger ${open ? "open" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">↻</span>
        <span>{busy ? "生成中…" : "重新生成"}</span>
      </button>
      {open && (
        <div className="regenerate-options" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); setBusy(true); onRegenerate(); window.setTimeout(() => setBusy(false), 800); }}
          >
            再试一次
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HookSidebar (rareui hooksidebar) — 钩式侧导航（设置页）                 */
/* ------------------------------------------------------------------ */
export function HookSidebar({ activeId, items, onSelect }: {
  activeId: string;
  items: Array<{ id: string; label: string; dividerBefore?: boolean }>;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="hook-sidebar settings-nav" aria-label="Settings navigation">
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.dividerBefore && <div className="settings-nav-divider" role="separator" />}
          <button
            type="button"
            className={activeId === item.id ? "active" : ""}
            aria-current={activeId === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            <span className="hook-tab" aria-hidden="true" />
            {item.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
