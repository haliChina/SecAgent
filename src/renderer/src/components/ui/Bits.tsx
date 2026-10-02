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
 * 设计参考致谢：rareui.com / assistant-ui.com / reactbits.dev（详见 README 开源致谢）。
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
      setProgress(max > 4 ? Math.min(1, Math.max(0, element.scrollTop / max)) : 0);
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
/* MatrixOrb (rareui) — 三态状态球：空状态居中 / composer 上方常驻      */
/* ------------------------------------------------------------------ */
export type OrbState = "idle" | "listening" | "thinking";

/**
 * 从既有 MediaStream 取电平（0-1，EMA 平滑）。**绝不自己调 getUserMedia**
 * （Codex R5：orb 自开默认设备流会采错设备——用户配置的 deviceId 在 ASR 侧
 * `audioInputRef`——且单路采集驱动下会抢占设备、导致 ASR 失败）。只 attach
 * 一个 AnalyserNode 做分析，采集流由 App 侧 ASR 持有并经 prop 传入。
 * 流为 null / prefers-reduced-motion / 浏览器限制时电平恒 0（静态退化）。
 */
export function useStreamLevel(stream: MediaStream | null | undefined): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let context: AudioContext | null = null;
    let smoothed = 0;
    try {
      context = new AudioContext();
      if (context.state === "suspended") void context.resume().catch(() => undefined);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const tick = (): void => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) { const value = (samples[i] - 128) / 128; sum += value * value; }
        const rms = Math.sqrt(sum / samples.length);
        smoothed = smoothed * 0.82 + Math.min(1, rms * 3.4) * 0.18;
        setLevel(smoothed);
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* 流已停止或浏览器限制：电平保持 0，listening 态退化为静态呈现 */
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      context?.close().catch(() => undefined);
      setLevel(0);
    };
  }, [stream]);
  return level;
}

/**
 * 契约说明（2026-10-02 R5 修订）：三态组件 state: "idle" | "listening" | "thinking"。
 * idle = 极缓呼吸 + 26s 自转；listening = 从 App 传入的 ASR 采集流（stream prop）
 * 挂 AnalyserNode 取电平，组件自身**不开采集流**（设备选择权在 App 的
 * audioInputRef）；level prop 可外部注入覆盖（受控用法）。thinking = 加速自转。
 * accent 覆盖主题色（如工具面板配色）。尺寸由 font-size 派生（1em = 球直径）：
 * 不传 size 走 CSS（空状态 min(200px, 30vw)），常驻位传 size=28。
 * 零新增依赖（AnalyserNode 原生 API）。
 */
export function MatrixOrb({ size, state = "idle", level, accent, stream }: { size?: number; state?: OrbState; level?: number; accent?: string; stream?: MediaStream | null }) {
  const streamLevel = useStreamLevel(state === "listening" ? stream : null);
  const effectiveLevel = level ?? streamLevel;
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
  const style: CSSProperties = { ...(size !== undefined ? { fontSize: size } : {}), ...(accent ? ({ "--orb-accent": accent } as CSSProperties) : {}) };
  return (
    <div className={`matrix-orb matrix-orb--${state}`} style={style} aria-hidden="true">
      <div className="matrix-orb-core" style={{ transform: `scale(${1 + effectiveLevel * 0.2})` }} />
      <div className="matrix-orb-dots" style={{ opacity: 0.72 + effectiveLevel * 0.28 }}>
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
  // 用本地日历日零点的时间差计算天数（而非 UTC epoch 日或 month*32 数字键）：
  // UTC 截断会把本地 23 点后的消息算进「下一天」，偏移非整小时的时区（如
  // UTC+5:30）每天都漂移；数字键在月/年边界不按天递增（1/31→2/1 差 2、
  // 12/31→1/1 差 130）。Math.round 兼容 DST 切换日的 23/25 小时日。
  const localMidnight = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((localMidnight(now) - localMidnight(date)) / 86_400_000);
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
