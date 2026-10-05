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
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

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
 * 契约说明（2026-10-03 R7 升级为 Canvas 2D 真版）：三态 state: "idle" | "listening" | "thinking"。
 * 逐点半径 = spacing * 0.6 * exp(-d²*1.7) * intensity（rareui 签名逻辑），d 为到中心的
 * 归一化距离，d > 1.12 直接跳过保证圆形轮廓；半径×DPR < 0.5 半像素剔除防糊。
 * 三态肉眼可辨：idle 极缓呼吸（全点同相，~11s 周期）/ listening 正弦涟漪由中心
 * 向外传播 + RMS 电平驱动点大小与亮度 / thinking 外环热区沿轨道游走（~5.7s/圈）
 * + 加速涟漪。listening 电平来自 App 传入的 ASR 采集流（组件绝不开流，Codex R5）。
 * 尺寸由容器决定（em 派生）：空状态 min(200px,30vw)，dock 28px；密度自适应
 * （<48px 用 9 点阵，否则 11——R9 校回 rareui 原版密度：11 档点距/点径比留
 * 出 ~2.2px 白缝，点阵透气独立成形；21 档白缝只剩 ~1.1px，中心行亮点连成
 * 连续亮区，即「糊成一团/水波纹」的成因）。prefers-reduced-motion 静态
 * 一帧、document.hidden 停 rAF。DPR 上限 2。零新增依赖（Canvas 2D 原生 API）。
 */
export function MatrixOrb({ size, state = "idle", level, accent, stream }: { size?: number; state?: OrbState; level?: number; accent?: string; stream?: MediaStream | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamLevel = useStreamLevel(state === "listening" ? stream : null);
  const effectiveLevel = level ?? streamLevel;
  const liveRef = useRef({ state, effectiveLevel, accent });
  useEffect(() => {
    liveRef.current = { state, effectiveLevel, accent };
  });

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let cssWidth = 0;
    let cssHeight = 0;
    let dpr = 1;
    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssWidth = rect.width;
      cssHeight = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const draw = (time: number): void => {
      const { state, effectiveLevel, accent } = liveRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      const cx = cssWidth / 2;
      const cy = cssHeight / 2;
      const orbRadius = (Math.min(cssWidth, cssHeight) / 2) * 0.94;
      if (orbRadius <= 1) return;
      // 极淡底光保持球体感（深色主题：白色微体积光，替代浅色版的白色球心光晕）
      const glow = ctx.createRadialGradient(cx, cy, orbRadius * 0.1, cx, cy, orbRadius);
      glow.addColorStop(0, "rgba(255,255,255,.05)");
      glow.addColorStop(0.7, "rgba(255,255,255,.02)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, orbRadius, 0, Math.PI * 2);
      ctx.fill();

      const across = cssWidth < 48 ? 9 : 11;
      const spacing = (orbRadius * 2) / across;
      const hotspot = (time / 900) % (Math.PI * 2);
      ctx.fillStyle = accent || "#F97316";
      for (let gy = -across; gy <= across; gy += 1) {
        for (let gx = -across; gx <= across; gx += 1) {
          const px = gx * spacing;
          const py = gy * spacing;
          const d = Math.hypot(px, py) / orbRadius;
          if (d > 1.12) continue;
          let intensity: number;
          if (state === "listening") {
            const ripple = Math.sin(time / 260 - d * 7);
            intensity = 0.62 + 0.34 * ripple * (0.55 + 0.45 * effectiveLevel) + 0.5 * effectiveLevel * (1 - d * 0.55);
          } else if (state === "thinking") {
            const angle = Math.atan2(py, px);
            const angular = Math.atan2(Math.sin(angle - hotspot), Math.cos(angle - hotspot));
            const orbit = Math.exp(-((d - 0.82) ** 2) * 26);
            intensity = 0.6 + 0.2 * Math.sin(time / 170 - d * 9) + 1.15 * orbit * Math.exp(-(angular ** 2) * 3.2);
          } else {
            intensity = 0.78 + 0.16 * Math.sin(time / 1800 + d * 2.4);
          }
          const dotRadius = spacing * 0.6 * Math.exp(-d * d * 1.7) * Math.min(1.9, Math.max(0.25, intensity));
          if (dotRadius * dpr < 0.5) continue;
          const alpha = Math.min(0.95, (0.3 + 0.55 * Math.exp(-d * d * 1.5)) * (0.55 + 0.45 * Math.min(1, intensity / 1.3))) * (state === "listening" ? 0.75 + 0.45 * effectiveLevel : 1);
          ctx.globalAlpha = Math.min(1, Math.max(0.06, alpha));
          ctx.beginPath();
          ctx.arc(cx + px, cy + py, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (time: number): void => {
      draw(time);
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    if (reducedMotion) draw(1200);
    else raf = requestAnimationFrame(loop);

    const onVisibility = (): void => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reducedMotion) raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const style: CSSProperties = { ...(size !== undefined ? { fontSize: size } : {}), ...(accent ? ({ "--orb-accent": accent } as CSSProperties) : {}) };
  return (
    <div className={`matrix-orb matrix-orb--${state}`} style={style} aria-hidden="true" ref={containerRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AuroraBackdrop (reactbits Aurora · lightMode 移植) — 空状态极光衬底  */
/* ------------------------------------------------------------------ */
/**
 * 深底极光（Canvas 2D 零依赖移植，配色从 accent 橙 #F97316 派生）：四个漂移的低
 * 透明度光斑 lighter 叠加，底部整幅渐隐到页面底色 --bg-0——标题与输入区域始终近底色。
 * prefers-reduced-motion 静态一帧、document.hidden 停 rAF（不空烧 GPU）。
 * 矮屏（max-height:760px）由 CSS 压缩球尺寸，光带随容器等比收缩。
 */
export function AuroraBackdrop() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let cssWidth = 0;
    let cssHeight = 0;
    let dpr = 1;
    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssWidth = rect.width;
      cssHeight = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const blobs = [
      { rgb: "249, 115, 22", scale: 0.55, speed: 1 / 26000, phase: 0, y: 0.4 },
      { rgb: "139, 92, 246", scale: 0.42, speed: 1 / 19000, phase: 2.1, y: 0.28 },
      { rgb: "59, 130, 246", scale: 0.36, speed: 1 / 33000, phase: 4.4, y: 0.5 },
      { rgb: "234, 88, 12", scale: 0.3, speed: 1 / 22000, phase: 5.6, y: 0.34 }
    ];
    const draw = (time: number): void => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      if (cssWidth < 2 || cssHeight < 2) return;
      ctx.globalCompositeOperation = "lighter";
      const base = Math.min(cssWidth, cssHeight * 1.7);
      for (const blob of blobs) {
        const x = cssWidth * (0.5 + 0.34 * Math.sin(time * blob.speed + blob.phase));
        const y = cssHeight * (blob.y + 0.07 * Math.sin(time * blob.speed * 1.6 + blob.phase * 2));
        const r = Math.max(8, base * blob.scale);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(${blob.rgb},0.11)`);
        gradient.addColorStop(0.6, `rgba(${blob.rgb},0.04)`);
        gradient.addColorStop(1, "rgba(10,10,11,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, cssWidth, cssHeight);
      }
      ctx.globalCompositeOperation = "source-over";
      // 深色版：整幅渐隐到页面底色 --bg-0 (#0A0A0B)
      const fade = ctx.createLinearGradient(0, 0, 0, cssHeight);
      fade.addColorStop(0, "rgba(10,10,11,0)");
      fade.addColorStop(0.55, "rgba(10,10,11,.45)");
      fade.addColorStop(1, "rgba(10,10,11,1)");
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, cssWidth, cssHeight);
    };

    const loop = (time: number): void => {
      draw(time);
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    if (reducedMotion) draw(0);
    else raf = requestAnimationFrame(loop);

    const onVisibility = (): void => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reducedMotion) raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <div className="aurora-backdrop" ref={containerRef} aria-hidden="true"><canvas ref={canvasRef} /></div>;
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
  // role="separator" + aria-label：日期是消息流的时间地标，读屏用户切换
  // 消息时需要这层上下文，不能从无障碍树里拿掉（R8 a11y）。
  return (
    <div className="day-separator" role="separator" aria-label={label}>
      <span className="day-separator-line" aria-hidden="true" />
      <span className="day-separator-label">{label}</span>
      <span className="day-separator-line" aria-hidden="true" />
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
  // 取「当前显示值」而非上次动画起点作为新起点：动画中途 value 再变（如余额页
  // 连点刷新）时从当前读数续播，不会先跳回旧起点再重来（R8）。
  const displayRef = useRef(value);
  useEffect(() => {
    const from = displayRef.current;
    if (from === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (value - from) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return <span className="animated-counter" style={style}>{format ? format(display) : Math.round(display).toLocaleString()}</span>;
}

/* ------------------------------------------------------------------ */
/* HookSidebar (rareui hooksidebar) — 钩式侧导航（设置页）                 */
/* ------------------------------------------------------------------ */
/* 钩端竖笔高度（px），与 styles.css 的 .hook-tab height 保持一致 */
const HOOK_TAB_H = 12;

export function HookSidebar({ activeId, items, onSelect }: {
  activeId: string;
  items: Array<{ id: string; label: string; dividerBefore?: boolean }>;
  onSelect: (id: string) => void;
}) {
  // rareui 原版的激活指示器是「从第一个菜单项垂到选中项的 2px 虚线，末端右拐
  // 成钩」（对照用户提供的手绘风格参考图校形）。虚线长度依赖激活项在 nav 里
  // 的实际位置，只能 JS 量；ResizeObserver 兜底字体加载/窗口尺寸变化。
  // 线与钩都是 nav 级绝对定位元素、由同一次量算驱动（to 既是线终点也是钩顶），
  // 共用 top .18s ease 过渡——切换时两者每帧严格同步，不会出现「钩瞬移、线
  // 还在追赶」的错位（此前钩嵌在按钮内、随 React 重渲染跳变）。
  const navRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [hook, setHook] = useState<{ from: number; to: number } | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = activeRef.current;
    if (!nav || !active) { setHook(null); return; }
    const measure = () => {
      const first = nav.querySelector<HTMLButtonElement>("button");
      if (!first || !activeRef.current) return;
      setHook({
        from: first.offsetTop + first.offsetHeight / 2,
        // 虚线终点停在钩的实线竖笔起点（= 钩顶），避免点线与实线叠出 4px 粗段
        to: activeRef.current.offsetTop + activeRef.current.offsetHeight / 2 - HOOK_TAB_H
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeId, items]);

  return (
    <nav className="hook-sidebar settings-nav" aria-label="设置导航">
      {hook && <span className="hook-line" aria-hidden="true" style={{ top: hook.from, height: Math.max(0, hook.to - hook.from) }} />}
      {hook && <span className="hook-tab" aria-hidden="true" style={{ top: hook.to }} />}
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.dividerBefore && <div className="settings-nav-divider" role="separator" />}
          <button
            type="button"
            ref={activeId === item.id ? activeRef : undefined}
            className={activeId === item.id ? "active" : ""}
            aria-current={activeId === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
