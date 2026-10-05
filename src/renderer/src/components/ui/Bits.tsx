/**
 * UI Bits — 参考组件的自研复刻（A 清爽浅色 · Notion/Linear 系）。
 *
 * 设计参考与实现来源（R13 起逐组件对照 GitHub 源码忠实移植，不再目测仿制）：
 *  - rareui（github.com/swamimalode07/rare-ui，MIT）: matrixorb / deletebutton /
 *    scrollprogress / hooksidebar / voicenote / animatedcounter —— 本文件内各
 *    组件头注释标注了对应源文件与逐项参数；零依赖动效内核以同式 spring 物理
 *    替代 motion/react（visualDuration/bounce → k/c/m 反解）。
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
import { Fragment, createContext, memo, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* 零依赖动效内核 —— 物理与 motion/react type:"spring" 同式               */
/* ------------------------------------------------------------------ */
type SpringConfig = { stiffness: number; damping: number; mass?: number };

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// motion/react 的 visualDuration + bounce 反解 (k, c, m)（m=1）：
// ω=2π/duration；L=-ln(bounce)，阻尼比 ζ=L/√(π²+L²)；k=ω²，c=2ζω。
// 与 motion 同族解法，保证弹跳节奏与原版一致。
function visualSpring(duration: number, bounce: number): SpringConfig {
  const omega = (Math.PI * 2) / Math.max(0.01, duration);
  const L = -Math.log(Math.min(0.999, Math.max(1e-3, bounce)));
  const zeta = L / Math.sqrt(Math.PI * Math.PI + L * L);
  return { stiffness: omega * omega, damping: 2 * zeta * omega, mass: 1 };
}

// 全局单 rAF 逐帧推进（半隐式欧拉，dt 钳 50ms），活跃 spring 共帧、静止即休眠
class SpringValue {
  private value: number;
  private target: number;
  private velocity = 0;
  private readonly cfg: SpringConfig;
  private readonly listeners = new Set<(value: number) => void>();
  private active = false;

  constructor(initial: number, cfg: SpringConfig) {
    this.value = initial;
    this.target = initial;
    this.cfg = cfg;
  }
  get(): number { return this.value; }
  set(target: number): void {
    if (!Number.isFinite(target)) return;
    this.target = target;
    this.wake();
  }
  jump(value: number): void {
    if (!Number.isFinite(value)) return;
    this.value = this.target = value;
    this.velocity = 0;
    this.listeners.forEach((fn) => fn(value)); // 立即落值（reduced-motion 路径）
  }
  subscribe(fn: (value: number) => void): () => void {
    this.listeners.add(fn);
    fn(this.value);
    return () => { this.listeners.delete(fn); };
  }
  private wake(): void {
    if (this.active) return;
    this.active = true;
    springTicker.add(this);
  }
  /** 由 ticker 调用；返回 false 表示已静止 */
  step(dt: number): boolean {
    const { stiffness, damping, mass = 1 } = this.cfg;
    this.velocity += ((-stiffness * (this.value - this.target) - damping * this.velocity) / mass) * dt;
    this.value += this.velocity * dt;
    if (Math.abs(this.value - this.target) < 0.004 && Math.abs(this.velocity) < 0.02) {
      this.value = this.target;
      this.velocity = 0;
      this.listeners.forEach((fn) => fn(this.value));
      this.active = false;
      return false;
    }
    this.listeners.forEach((fn) => fn(this.value));
    return true;
  }
  destroy(): void {
    this.listeners.clear();
    springTicker.delete(this);
    this.active = false;
  }
}

const springTicker = (() => {
  const springs = new Set<SpringValue>();
  let raf = 0;
  let last = 0;
  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    springs.forEach((s) => { if (!s.step(dt)) springs.delete(s); });
    raf = springs.size ? requestAnimationFrame(frame) : 0;
  };
  return {
    add(s: SpringValue): void {
      springs.add(s);
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
    delete(s: SpringValue): void { springs.delete(s); },
  };
})();

function useSpringValue(initial: number, cfg: SpringConfig): SpringValue {
  const ref = useRef<SpringValue | null>(null);
  if (ref.current === null) ref.current = new SpringValue(initial, cfg);
  useEffect(() => () => ref.current?.destroy(), []);
  return ref.current;
}

/* ------------------------------------------------------------------ */
/* ScrollProgress (rareui scrollprogress) — 底部悬浮进度 pill + 节列表     */
/* 忠实移植自 swamimalode07/rare-ui components/ui/scroll-progress.tsx：   */
/* 环形进度（spring 120/30/0.3）+ 当前节名（模糊交叉淡入 .22s）+ 点击     */
/* 展开节列表（SIZE_SPRING = bounce .16 / duration .5，条目错峰 blur-in， */
/* 选中高亮弹簧跟随）+ 选中滚动定位（700ms 滚动锁）。                     */
/* ------------------------------------------------------------------ */
export type ScrollProgressSection = { id: string; label: string };

const SP_SIZE_SPRING = visualSpring(0.5, 0.16);

export function ScrollProgress({ container, sections = [], offset = 120, className }: {
  container: React.RefObject<HTMLElement | null>;
  sections?: ScrollProgressSection[];
  offset?: number;
  className?: string;
}) {
  const reduced = useRef(prefersReducedMotion()).current;

  const [activeId, setActiveId] = useState(sections[0]?.id);
  const [open, setOpen] = useState(false);

  const scrollLock = useRef(false);
  const scrollLockTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 环形进度：监听容器 scrollTop，spring(120, 30, 0.3) 平滑（与原版一致）
  const progress = useSpringValue(0, { stiffness: 120, damping: 30, mass: 0.3 });
  const ringRef = useRef<SVGCircleElement>(null);
  const RING_C = 2 * Math.PI * 10;

  useEffect(() => {
    const scroller = container.current ?? window;
    const update = (): void => {
      if (scrollLock.current) return;
      const element = container.current;
      if (!element) return;
      const max = element.scrollHeight - element.clientHeight;
      progress.set(max > 4 ? Math.min(1, Math.max(0, element.scrollTop / max)) : 0);
      const anchor = element.getBoundingClientRect().top + offset;
      let active: ScrollProgressSection | undefined;
      for (let i = sections.length - 1; i >= 0; i -= 1) {
        const top = document.getElementById(sections[i].id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= anchor) { active = sections[i]; break; }
      }
      setActiveId(active?.id ?? sections[0]?.id);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [container, sections, offset, progress]);

  useEffect(() => progress.subscribe((p) => {
    if (ringRef.current) ringRef.current.style.strokeDasharray = `${p * RING_C} ${RING_C}`;
  }), [progress]);

  const label = sections.find((s) => s.id === activeId)?.label;

  const labelVersion = useRef(0);
  const prevLabel = useRef(label);
  if (label !== prevLabel.current) {
    prevLabel.current = label;
    labelVersion.current += 1;
  }

  const collapsedRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [collapsedSize, setCollapsedSize] = useState<{ width: number; height: number }>();
  const [openSize, setOpenSize] = useState<{ width: number; height: number }>();
  const [labelWidth, setLabelWidth] = useState<number>();

  // 离屏 sizer 实测两种形态尺寸（与原版同法），fonts.ready + RO 兜底
  useLayoutEffect(() => {
    const measure = (): void => {
      if (labelRef.current) setLabelWidth(labelRef.current.offsetWidth);
      if (collapsedRef.current) setCollapsedSize({ width: collapsedRef.current.offsetWidth, height: collapsedRef.current.offsetHeight });
      if (openRef.current) setOpenSize({ width: openRef.current.offsetWidth, height: openRef.current.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (labelRef.current) ro.observe(labelRef.current);
    if (collapsedRef.current) ro.observe(collapsedRef.current);
    if (openRef.current) ro.observe(openRef.current);
    void document.fonts?.ready.then(measure).catch(() => undefined);
    return () => ro.disconnect();
  }, [sections]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => clearTimeout(scrollLockTimer.current), []);

  const selectSection = (id: string): void => {
    scrollLock.current = true;
    clearTimeout(scrollLockTimer.current);
    scrollLockTimer.current = setTimeout(() => { scrollLock.current = false; }, reduced ? 0 : 700);
    setActiveId(id);
    setOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  // 容器宽高/圆角：与原版同一 spring（bounce .16 / duration .5）逐帧写样式
  const width = useSpringValue(0, SP_SIZE_SPRING);
  const height = useSpringValue(0, SP_SIZE_SPRING);
  const radius = useSpringValue(16, SP_SIZE_SPRING);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const size = open ? openSize : collapsedSize;
  const sizeInitRef = useRef(false);
  useLayoutEffect(() => {
    if (!size) return;
    if (!sizeInitRef.current) {
      // 首次测量直接落位（对应原版 initial={false}），不播「从 0 长出」
      sizeInitRef.current = true;
      width.jump(size.width);
      height.jump(size.height);
      radius.jump(open ? 26 : size.height / 2);
      return;
    }
    if (reduced) { width.jump(size.width); height.jump(size.height); radius.jump(open ? 26 : size.height / 2); return; }
    width.set(size.width);
    height.set(size.height);
    radius.set(open ? 26 : size.height / 2);
  }, [size, open, reduced, width, height, radius]);
  useEffect(() => {
    const apply = (): void => {
      const el = surfaceRef.current;
      if (!el) return;
      el.style.width = `${width.get()}px`;
      el.style.height = `${height.get()}px`;
      el.style.borderRadius = `${radius.get()}px`;
    };
    const unsubs = [width.subscribe(apply), height.subscribe(apply), radius.subscribe(apply)];
    return () => unsubs.forEach((u) => u());
  }, [width, height, radius]);

  // 列表内选中高亮：测量选中项位置，弹簧跟随（对应原版 layoutId shared element）
  const hlTop = useSpringValue(0, SP_SIZE_SPRING);
  const hlHeight = useSpringValue(0, SP_SIZE_SPRING);
  const highlightRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(`[data-section-id="${activeId}"]`);
    if (!active) return;
    const top = active.offsetTop;
    const h = active.offsetHeight;
    if (reduced) { hlTop.jump(top); hlHeight.jump(h); return; }
    hlTop.set(top);
    hlHeight.set(h);
  }, [open, activeId, sections, reduced, hlTop, hlHeight]);
  useEffect(() => {
    const apply = (): void => {
      const el = highlightRef.current;
      if (!el) return;
      el.style.top = `${hlTop.get()}px`;
      el.style.height = `${hlHeight.get()}px`;
    };
    const unsubs = [hlTop.subscribe(apply), hlHeight.subscribe(apply)];
    return () => unsubs.forEach((u) => u());
  }, [hlTop, hlHeight]);

  return (
    <div ref={rootRef} className={`scroll-progress ${className ?? ""}`} data-open={open || undefined}>
      {/* 离屏 sizer：实测收起 / 展开两种形态的自然尺寸 */}
      <div className="scroll-progress-sizers" aria-hidden="true">
        <div ref={collapsedRef} className="scroll-progress-pill-sizer">
          <span className="scroll-progress-ring-sizer" />
          <span ref={labelRef} className="scroll-progress-label-sizer">{label}</span>
        </div>
        <div ref={openRef} className="scroll-progress-list-sizer">
          {sections.map((s) => (
            <div key={s.id} className="scroll-progress-item-sizer">
              <span className="scroll-progress-dot-sizer" />
              <span className="whitespace-nowrap">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {size && (
        <div ref={surfaceRef} className="scroll-progress-surface">
          {!open && (
            <button type="button" className="scroll-progress-pill" onClick={() => setOpen(true)} aria-label="显示章节列表" aria-expanded={false}>
              <span className="shrink-0">
                <svg viewBox="0 0 24 24" className="scroll-progress-ring" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" fill="none" strokeWidth="2.5" className="scroll-progress-ring-track" />
                  <circle ref={ringRef} cx="12" cy="12" r="10" fill="none" strokeWidth="2.5" className="scroll-progress-ring-arc" />
                </svg>
              </span>
              <span className="scroll-progress-label-box" style={{ width: labelWidth }}>
                {label && <span key={labelVersion.current} className="scroll-progress-label">{label}</span>}
              </span>
            </button>
          )}
          {open && (
            <div ref={listRef} className="scroll-progress-list" role="list">
              {activeId && <span ref={highlightRef} className="scroll-progress-highlight" aria-hidden="true" />}
              {sections.map((s, i) => {
                const isActive = s.id === activeId;
                return (
                  <button
                    type="button"
                    key={s.id}
                    data-section-id={s.id}
                    className={`scroll-progress-item ${isActive ? "active" : ""}`}
                    style={{ animationDelay: `${0.04 + i * 0.03}s` }}
                    onClick={() => selectSection(s.id)}
                    role="listitem"
                  >
                    <span className={`scroll-progress-item-dot ${isActive ? "active" : ""}`} />
                    <span className="whitespace-nowrap">{s.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
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
 * 忠实移植 swamimalode07/rare-ui components/ui/matrix-orb.tsx：
 * props size(px，默认 240) / color / dots(默认 11) / state / level(0-1，缺省时
 * 由内置 envelope 伪电平驱动) / labels(可选状态文字)。
 * grid 档位 → spacing = size*0.74/(dots-1)，maxRadius = spacing*0.6；
 * 半径 = maxRadius * exp(-d²*1.7) * intensity * scale；d>1.12 剔除成圆；
 * 半径×DPR<0.5 的点呈雾不成点，剔除。三态 intensity：
 *  idle      0.62 + 0.12*sin(t*1.05 - d*2.4)
 *  listening 0.32 + amplitude*(0.34 + 0.38*ripple)，ripple = 0.5+0.5*sin(d*4.2 - t*3)
 *  thinking  三轨道热区叠加 0.26 + 0.8*min(1, heat)
 * 电平平滑 ATTACK .22 / RELEASE .08；状态权重 BLEND .16（帧率补偿），切换
 * 从当前画面混合；scale 三态呼吸（idle .88 / listening 1 / thinking .92，
 * 弹簧 180/26）。缓冲按 devicePixelRatio 重建（上限 4）。
 * reduced-motion：静态一帧，state/level 变更重绘。
 * 应用适配（原版没有）：stream prop 走 useStreamLevel（ASR 采集流电平，
 * 组件绝不开流，Codex R5）；默认色取应用 accent #F97316（原版 #F75001）。
 */
const MO_STATES: OrbState[] = ["idle", "listening", "thinking"];
const MO_SCALE: Record<OrbState, number> = { idle: 0.88, listening: 1, thinking: 0.92 };
const MO_STIFFNESS = 180;
const MO_DAMPING = 26;
const MO_ATTACK = 0.22;
const MO_RELEASE = 0.08;
const MO_BLEND = 0.16;
const MO_ORBITERS = [
  { radius: 0.62, speed: 2.2, phase: 0, spread: 0.42 },
  { radius: 0.4, speed: -1.7, phase: 2.1, spread: 0.36 },
  { radius: 0.8, speed: 1.15, phase: 4, spread: 0.34 },
];

// 不取 Math.abs：谷底的尖角正是节拍感的一部分（原版注释）
function moEnvelope(t: number): number {
  const slow = 0.5 + 0.5 * Math.sin(t * 0.62 + 0.4);
  const fast = 0.5 + 0.5 * Math.sin(t * 1.9 + 1.1);
  return 0.22 + 0.78 * (0.45 + 0.55 * slow) * fast;
}

function moIntensityOf(state: OrbState, d: number, nx: number, ny: number, t: number, amplitude: number): number {
  if (state === "listening") {
    const ripple = 0.5 + 0.5 * Math.sin(d * 4.2 - t * 3);
    return 0.32 + amplitude * (0.34 + 0.38 * ripple);
  }
  if (state === "thinking") {
    let heat = 0;
    for (const o of MO_ORBITERS) {
      const a = t * o.speed + o.phase;
      const dx = nx - Math.cos(a) * o.radius;
      const dy = ny - Math.sin(a) * o.radius;
      heat += Math.exp(-(dx * dx + dy * dy) / (o.spread * o.spread));
    }
    return 0.26 + 0.8 * Math.min(1, heat);
  }
  return 0.62 + 0.12 * Math.sin(t * 1.05 - d * 2.4);
}

// 缩放改变 devicePixelRatio，旧缓冲被拉伸发糊：RO/resize 监听重建
function subscribeToZoom(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function useDevicePixelRatio(): number {
  return useSyncExternalStore(
    subscribeToZoom,
    () => Math.min(window.devicePixelRatio || 1, 4),
    () => 1,
  );
}

export function MatrixOrb({ size = 240, state = "idle", level, color = "#F97316", dots = 11, stream, labels }: {
  size?: number;
  state?: OrbState;
  level?: number;
  color?: string;
  dots?: number;
  stream?: MediaStream | null;
  labels?: Partial<Record<OrbState, string>>;
}) {
  const streamLevel = useStreamLevel(state === "listening" ? stream : null);
  const live = level ?? streamLevel;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stateRef.current = state;
    levelRef.current = live;
  }, [state, live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // 用 buffer/size 而非 dpr 做缩放，取整时变换仍精确（原版注释）
    const buffer = Math.max(1, Math.round(size * dpr));
    canvas.width = buffer;
    canvas.height = buffer;
    ctx.setTransform(buffer / size, 0, 0, buffer / size, 0, 0);
    ctx.fillStyle = color;
  }, [size, dpr, color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const grid = Math.max(3, Math.round(dots));
    const half = (grid - 1) / 2;
    const spacing = (size * 0.74) / (grid - 1);
    const maxRadius = spacing * 0.6;
    const center = size / 2;

    const weights: Record<OrbState, number> = { idle: 0, listening: 0, thinking: 0 };
    weights[stateRef.current] = 1;

    // 非有限 level 会卡死平滑器（原版注释）
    const levelAt = (t: number): number => {
      const v = levelRef.current;
      return v === undefined || !Number.isFinite(v) ? moEnvelope(t) : Math.min(1, Math.max(0, v));
    };

    const draw = (t: number, amplitude: number, scale: number): void => {
      ctx.clearRect(0, 0, size, size);
      for (let iy = 0; iy < grid; iy += 1) {
        for (let ix = 0; ix < grid; ix += 1) {
          const nx = (ix - half) / half;
          const ny = (iy - half) / half;
          const d = Math.hypot(nx, ny);
          // 1.12 而非方形角点的 1.41，轮廓才成圆（原版注释）
          if (d > 1.12) continue;

          let blended = 0;
          for (const s of MO_STATES) {
            if (weights[s] < 0.001) continue;
            blended += weights[s] * moIntensityOf(s, d, nx, ny, t, amplitude);
          }

          const intensity = Math.min(1, Math.max(0, blended));
          const radius = maxRadius * Math.exp(-d * d * 1.7) * intensity * scale;
          // 半设备像素以下渲染成雾不成点（原版注释）
          if (radius * dpr < 0.5) continue;

          ctx.beginPath();
          ctx.arc(
            center + (ix - half) * spacing * scale,
            center + (iy - half) * spacing * scale,
            radius,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    };

    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      redrawRef.current = () => {
        const current = stateRef.current;
        for (const s of MO_STATES) weights[s] = s === current ? 1 : 0;
        draw(0, levelAt(0), MO_SCALE[current]);
      };
      redrawRef.current();
      return () => { redrawRef.current = null; };
    }

    let raf = 0;
    let t = 0;
    let amplitude = 0;
    let scale = MO_SCALE[stateRef.current];
    let velocity = 0;
    let last = performance.now();

    // 状态留在 deps 外是刻意的：循环改目标、从不重启（原版注释）
    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;

      const current = stateRef.current;
      const target = levelAt(t);
      const rate = target > amplitude ? MO_ATTACK : MO_RELEASE;
      amplitude += (target - amplitude) * (1 - Math.pow(1 - rate, dt * 60));

      // 状态权重逐帧混合，打断切换时从当前画面过渡（原版注释）
      const step = 1 - Math.pow(1 - MO_BLEND, dt * 60);
      for (const s of MO_STATES) {
        weights[s] += ((s === current ? 1 : 0) - weights[s]) * step;
      }

      velocity += (-MO_STIFFNESS * (scale - MO_SCALE[current]) - MO_DAMPING * velocity) * dt;
      scale += velocity * dt;

      draw(t, amplitude, scale);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, [size, color, dots, dpr]);

  useEffect(() => {
    redrawRef.current?.();
  }, [state, live]);

  return (
    <div data-slot="matrix-orb" data-state={state} className="matrix-orb" {...(labels ? {} : { "aria-hidden": true })}>
      <canvas ref={canvasRef} className="matrix-orb-canvas" style={{ width: size, height: size }} aria-hidden="true" />
      {labels && (
        <span role="status" aria-live="polite" className="matrix-orb-label">
          {labels[state]}
        </span>
      )}
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

// 本地日历日的稳定 id（ScrollProgress 节锚点 + DaySeparator 挂载用）。
// 不用 ISO 前缀：UTC 截断在 UTC+8 的 0-8 点会把相邻本地日折叠成同一天。
export function daySeparatorId(iso: string): string {
  const date = new Date(iso);
  return `day-${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function DaySeparator({ label, id }: { label: string; id?: string }) {
  // role="separator" + aria-label：日期是消息流的时间地标，读屏用户切换
  // 消息时需要这层上下文，不能从无障碍树里拿掉（R8 a11y）。
  // id 供 ScrollProgress 的节锚点定位（rareui 节列表按 document.getElementById 找）。
  return (
    <div id={id} className="day-separator" role="separator" aria-label={label}>
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
/* DeleteButton (rareui deletebutton) — 展开式两钮确认删除                 */
/* 忠实移植自 swamimalode07/rare-ui components/ui/delete-button.tsx：     */
/* 48px 方块（垃圾桶，开盖 -35°/桶壁塌落）点击向右展开 84px 凹槽面板，     */
/* 内嵌 ✓/× 双圆钮；确认后触发键换成打勾（描画动画），取消则垃圾桶回弹。  */
/* HOLD: deleted 1400ms / kept 600ms；Esc = 保留；sr-only 状态播报。      */
/* ------------------------------------------------------------------ */
const DB_TILE = 48;
const DB_PANEL = 84;
const DB_HINGE = "3px 6px";
const DB_LID_OPEN = -35;
const DB_WALL_TOP = 6;
const DB_WALL_TOP_OPEN = 13.5;
const DB_WALL_BASE = 20;
const DB_HOLD = { deleted: 1400, kept: 600 } as const;
const DB_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const DB_LID_EASE = "cubic-bezier(0.34, 1.1, 0.64, 1)";

const dbBezier = (x1: number, y1: number, x2: number, y2: number) => (t: number): number => {
  let u = t;
  for (let i = 0; i < 8; i += 1) {
    const x = 3 * u * (1 - u) ** 2 * x1 + 3 * u * u * (1 - u) * x2 + u ** 3 - t;
    if (Math.abs(x) < 1e-5) break;
    const dx = 3 * (1 - u) ** 2 * x1 + 6 * u * (1 - u) * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  return 3 * u * (1 - u) ** 2 * y1 + 3 * u * u * (1 - u) * y2 + u ** 3;
};

function dbWallsPath(top: number): string {
  return `M19 ${top}v${DB_WALL_BASE - top}a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V${top}`;
}

export function DeleteButton({ onConfirm, onCancel, ariaLabel }: { onConfirm?: () => void; onCancel?: () => void; ariaLabel?: string }) {
  const reduced = useRef(prefersReducedMotion()).current;
  const [open, setOpen] = useState(false);
  // 面板卸载延迟一个 OUT 周期，让退场渐隐与宽度收缩同帧收尾
  const [panelShown, setPanelShown] = useState(false);
  const [status, setStatus] = useState<"idle" | "deleted" | "kept">("idle");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wallsRef = useRef<SVGPathElement>(null);
  const tweenRef = useRef(0);

  useEffect(() => {
    if (open) { setPanelShown(true); return; }
    const timer = window.setTimeout(() => setPanelShown(false), reduced ? 0 : 320);
    return () => window.clearTimeout(timer);
  }, [open, reduced]);

  // 桶壁 d 插值（.56s EASE，与原版 WALL 过渡一致）
  useEffect(() => {
    const path = wallsRef.current;
    if (!path) return;
    const from = open ? DB_WALL_TOP : DB_WALL_TOP_OPEN;
    const to = open ? DB_WALL_TOP_OPEN : DB_WALL_TOP;
    cancelAnimationFrame(tweenRef.current);
    if (reduced) { path.setAttribute("d", dbWallsPath(to)); return; }
    const ease = dbBezier(0.32, 0.72, 0, 1);
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - startedAt) / 560);
      path.setAttribute("d", dbWallsPath(from + (to - from) * ease(t)));
      if (t < 1) tweenRef.current = requestAnimationFrame(tick);
    };
    tweenRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(tweenRef.current);
  }, [open, reduced]);

  useEffect(() => () => cancelAnimationFrame(tweenRef.current), []);

  const settle = useCallback((next: "deleted" | "kept"): void => {
    setStatus(next);
    setOpen(false);
    window.setTimeout(() => {
      setStatus("idle");
      triggerRef.current?.focus({ preventScroll: true });
    }, DB_HOLD[next]);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        settle("kept");
        onCancel?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, settle, onCancel]);

  return (
    <div className={`delete-button ${open ? "open" : ""} ${status} ${reduced ? "reduced" : ""}`} data-status={status}>
      <button
        ref={triggerRef}
        type="button"
        className="delete-trigger"
        style={{ width: open ? DB_TILE + DB_PANEL : DB_TILE }}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {status === "deleted" ? (
          <svg key="check" className="delete-check" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path className="delete-check-path" d="M4 12.5 9.5 18 20 7" />
          </svg>
        ) : (
          <svg key={`bin-${status}`} className={`delete-bin ${status === "kept" ? "settle" : ""}`} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path ref={wallsRef} d={dbWallsPath(DB_WALL_TOP)} />
            <g className="delete-lid">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </g>
          </svg>
        )}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "deleted" ? "已删除" : status === "kept" ? "已保留" : ""}
      </span>
      {panelShown && (
        <div className={`delete-panel ${open ? "shown" : "closing"}`} style={{ width: DB_PANEL }} aria-hidden={!open}>
          <span className="delete-panel-recess" aria-hidden="true" />
          <button type="button" className="delete-circle" aria-label="确认删除" onClick={() => { onConfirm?.(); settle("deleted"); }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12.5 9.5 18 20 7" stroke="var(--accent)" />
            </svg>
          </button>
          <button type="button" className="delete-circle" aria-label="取消" onClick={() => { onCancel?.(); settle("kept"); }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6 18 18M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
    </div>
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
/* AnimatedCounter (rareui animatedcounter) — 逐位滚轮数字动画            */
/* 忠实移植自 swamimalode07/rare-ui components/ui/animated-counter.tsx：  */
/* 每位数字是 0-9 纵向滚轮（尾部补 0 使 9→0 环绕落在同面）；滚轮方向感知  */
/* （值增上滚、值减下滚）；1.5em 行高 + 上下渐隐遮罩；列按键（从右数第几位）
/* 定位，进位/退位时整组横移（FLIP 弹簧，pace 与滚轮同速）；分位符/小数点  */
/* 作为 mark 淡入。sr-only 输出完整数值供读屏。                           */
/* ------------------------------------------------------------------ */
const AC_FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const AC_WHEEL = [...AC_FACES, 0];
const AC_LINE = 1.5;
const AC_FADE = `linear-gradient(to bottom,
  rgba(0,0,0,0) 0%,
  rgba(0,0,0,0.06) 5.5%,
  rgba(0,0,0,0.5) 11%,
  rgba(0,0,0,0.94) 16.5%,
  #000 22%,
  #000 78%,
  rgba(0,0,0,0.94) 83.5%,
  rgba(0,0,0,0.5) 89%,
  rgba(0,0,0,0.06) 94.5%,
  rgba(0,0,0,0) 100%)`;
const AC_MAX_DECIMALS = 15;
const AC_MAX_PAD = 24;
const AC_MIN_DURATION = 0.01;
const AC_MAX_DURATION = 60;

const acMod = (n: number, m: number): number => ((n % m) + m) % m;
const acClamp = (n: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, Number.isFinite(n) ? n : low));
const acIsDigit = (char: string): boolean => char >= "0" && char <= "9";

// 一次性构建，React 不必每次变更都 reconcile 每位 21 个 span（原版注释）
const AC_SIZER = AC_FACES.map((face) => (
  <span key={face} aria-hidden="true" className="ac-sizer-face">{face}</span>
));
const AC_STACK = AC_WHEEL.map((face, index) => (
  <span key={index} className="ac-wheel-face" style={{ height: `${AC_LINE}em` }}>{face}</span>
));

export type CounterGrouping = "western" | "indian";

const AC_EVERY_THREE = /\B(?=(\d{3})+(?!\d))/g;
const AC_EVERY_TWO = /\B(?=(\d{2})+(?!\d))/g;

function acGroup(whole: string, separator: string, grouping: CounterGrouping): string {
  if (!separator) return whole;
  if (grouping !== "indian") return whole.replace(AC_EVERY_THREE, separator);
  const head = whole.slice(0, -3);
  if (!head) return whole;
  return `${head.replace(AC_EVERY_TWO, separator)}${separator}${whole.slice(-3)}`;
}

type AcShape = { amount: number; scaled: number; places: number; pace: number; width: number };

function acMeasure(value: number, decimals: number, padStart: number, duration: number): AcShape {
  // NaN 会让「与上次值相等」的判断永远为真（原版注释）
  const amount = Number.isFinite(value) ? value : 0;
  const places = acClamp(Math.trunc(decimals), 0, AC_MAX_DECIMALS);
  const pad = acClamp(Math.trunc(padStart), 1, AC_MAX_PAD);
  // 超过 MAX_SAFE_INTEGER 数位是噪声，超过 1e21 String() 会转科学计数（原版注释）
  const scaled = Math.min(Number.MAX_SAFE_INTEGER, Math.round(Math.abs(amount) * 10 ** places));
  return {
    amount,
    scaled,
    places,
    pace: acClamp(duration, AC_MIN_DURATION, AC_MAX_DURATION),
    width: Math.max(String(scaled).length, places + pad),
  };
}

function acFormat({ scaled, places, width }: AcShape, separator: string, decimalSeparator: string, grouping: CounterGrouping): string {
  const raw = String(scaled).padStart(width, "0");
  const whole = acGroup(raw.slice(0, raw.length - places) || "0", separator, grouping);
  return places ? `${whole}${decimalSeparator}${raw.slice(raw.length - places)}` : whole;
}

// 按从右数的距离作 key：进位时整组列横移，而不是整列重挂（原版注释）
type AcCell =
  | { kind: "digit"; key: number; digit: number }
  | { kind: "mark"; key: string; char: string };

function acToCells(chars: string, width: number): AcCell[] {
  const cells: AcCell[] = [];
  let seen = 0;
  // 只有数字推进位次，多字符分隔符才不会撞 key（原版注释）
  let run = 0;
  for (const char of chars) {
    if (acIsDigit(char)) {
      run = 0;
      cells.push({ kind: "digit", key: width - seen++, digit: Number(char) });
    } else {
      cells.push({ kind: "mark", key: `mark-${width - seen}-${run++}`, char });
    }
  }
  return cells;
}

const AcDigit = memo(function AcDigit({ digit, from, dir, duration, reduced, cellKey }: {
  digit: number;
  from: number;
  dir: number;
  duration: number;
  reduced: boolean;
  cellKey: string;
}) {
  const cfg = useMemo(() => visualSpring(duration, 0.18), [duration]);
  const pos = useSpringValue(from, cfg);
  const goal = useRef(from);
  // 只读不依赖：单独一次方向反转不应重启每一列（原版注释）
  const heading = useRef(dir);
  useEffect(() => { heading.current = dir; }, [dir]);

  const innerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (reduced) {
      goal.current = digit;
      pos.jump(digit);
      return;
    }
    // 只有目标面变化、或反向需要绕远路时才重新瞄准（原版注释）
    if (acMod(goal.current, 10) !== digit) {
      // 从滚轮当前位置瞄准：连续变化的值不会积压整圈待转（原版注释）
      const at = pos.get();
      goal.current = heading.current < 0 ? at - acMod(at - digit, 10) : at + acMod(digit - at, 10);
    }
    pos.set(goal.current);
  }, [digit, reduced, pos]);

  useEffect(() => pos.subscribe((p) => {
    if (innerRef.current) innerRef.current.style.transform = `translateY(${(-acMod(p, 10) * 100) / AC_WHEEL.length}%)`;
  }), [pos]);

  return (
    <span data-cell={cellKey} className="animated-counter-digit" style={{ height: `${AC_LINE}em`, lineHeight: AC_LINE, maskImage: AC_FADE, WebkitMaskImage: AC_FADE }}>
      {/* 取最宽字面作列宽，兜底非表格数字字体（原版注释） */}
      {AC_SIZER}
      <span ref={innerRef} className="animated-counter-wheel">{AC_STACK}</span>
    </span>
  );
});

export function AnimatedCounter({
  value,
  decimals = 0,
  duration = 0.6,
  padStart = 1,
  separator = ",",
  decimalSeparator = ".",
  grouping = "western",
  prefix,
  suffix,
  className,
  style,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  padStart?: number;
  separator?: string;
  decimalSeparator?: string;
  grouping?: CounterGrouping;
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useRef(prefersReducedMotion()).current;

  const shape = acMeasure(value, decimals, padStart, duration);
  const chars = acFormat(shape, separator, decimalSeparator, grouping);
  const cells = acToCells(chars, shape.width);
  const negative = shape.amount < 0 && shape.scaled > 0;

  const [previous, setPrevious] = useState(shape.amount);
  const [dir, setDir] = useState(1);
  if (previous !== shape.amount) {
    setDir(shape.amount >= previous ? 1 : -1);
    setPrevious(shape.amount);
  }

  // 挂载时的初始面；后来出现的位置从 0 起滚入（原版注释）
  const [seed] = useState(() => {
    const faces: Record<number, number> = {};
    for (const cell of cells) if (cell.kind === "digit") faces[cell.key] = cell.digit;
    return faces;
  });

  // FLIP：列数变化时整组横移用弹簧过渡（对应原版 popLayout 的 layout 动画）
  const flip = useSpringValue(1, useMemo(() => visualSpring(shape.pace, 0.18), [shape.pace]));
  const cellX = useRef(new Map<string, number>());
  const pending = useRef<Array<[HTMLElement, number]>>([]);
  const gridRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const before = cellX.current;
    const after = new Map<string, number>();
    grid.querySelectorAll<HTMLElement>("[data-cell]").forEach((el) => {
      if (el.dataset.cell) after.set(el.dataset.cell, el.getBoundingClientRect().left);
    });
    const moves: Array<[HTMLElement, number]> = [];
    after.forEach((x, key) => {
      const prev = before.get(key);
      if (prev === undefined || Math.abs(x - prev) < 0.5) return;
      const el = grid.querySelector<HTMLElement>(`[data-cell="${CSS.escape(key)}"]`);
      if (el) moves.push([el, prev - x]);
    });
    cellX.current = after;
    if (!moves.length || reduced) { pending.current = []; return; }
    pending.current = moves;
    flip.jump(0);
    flip.set(1);
  }, [chars, reduced, flip]);
  useEffect(() => flip.subscribe((p) => {
    for (const [el, dx] of pending.current) el.style.transform = `translateX(${(dx * (1 - p)).toFixed(3)}px)`;
  }), [flip]);

  return (
    <span data-slot="animated-counter" className={`animated-counter ${className ?? ""}`} style={style}>
      <span className="sr-only">{chars}</span>
      {prefix != null && <span className="animated-counter-fixed" data-cell="prefix">{prefix}</span>}
      <span className="animated-counter-grid" ref={gridRef} aria-hidden="true">
        {negative && <span className="animated-counter-fixed" data-cell="sign">-</span>}
        {cells.map((cell) => cell.kind === "digit"
          ? <AcDigit key={cell.key} cellKey={String(cell.key)} digit={cell.digit} from={seed[cell.key] ?? 0} dir={dir} duration={shape.pace} reduced={reduced} />
          : <span key={cell.key} data-cell={cell.key} className="animated-counter-mark">{cell.char}</span>)}
      </span>
      {suffix != null && <span className="animated-counter-fixed" data-cell="suffix">{suffix}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* HookSidebar (rareui hooksidebar) — 钩式侧导航（设置页）                 */
/* 忠实移植自 swamimalode07/rare-ui components/ui/hook-sidebar.tsx：      */
/* 1px 虚线（repeating-gradient 2px 实/2px 空）自列表顶垂下，末端接 12×7   */
/* SVG 圆弧钩（M0.5 0a6 6 0 0 0 6 6H12，dashed 时 strokeDasharray 2 2）。  */
/* 双轨：灰 hover 轨（预览落点）+ 彩色 active 轨，均为 spring 420/34/0.7  */
/* 驱动 top——线高与钩顶同源同弹簧，逐帧严格同步（不脱节）。               */
/* hover 在 active 上方时 hover 轨只画拐角段。                            */
/* ------------------------------------------------------------------ */
const HK_CORNER = 6;
const HK_DASH = "repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)";
const HK_SPRING: SpringConfig = { stiffness: 420, damping: 34, mass: 0.7 };

function HookRail({ from = 0, y, visible, color, dashed, className }: {
  from?: number;
  y: number | null;
  visible: boolean;
  color?: string;
  dashed: boolean;
  className?: string;
}) {
  const reduced = useRef(prefersReducedMotion()).current;
  const sy = useSpringValue(y ?? 0, HK_SPRING);
  const sf = useSpringValue(from, HK_SPRING);
  const lineRef = useRef<HTMLSpanElement>(null);
  const hookRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (y === null) return;
    if (reduced) { sy.jump(y); sf.jump(from); return; }
    sy.set(y);
    sf.set(from);
  }, [y, from, reduced, sy, sf]);

  useEffect(() => {
    const apply = (): void => {
      const cy = sy.get();
      const cf = sf.get();
      if (lineRef.current) {
        lineRef.current.style.top = `${cf}px`;
        lineRef.current.style.height = `${Math.max(0, cy - HK_CORNER - cf)}px`;
      }
      if (hookRef.current) hookRef.current.style.top = `${cy - HK_CORNER}px`;
    };
    const unsubs = [sy.subscribe(apply), sf.subscribe(apply)];
    return () => unsubs.forEach((u) => u());
  }, [sy, sf]);

  return (
    <span ref={rootRef} aria-hidden="true" className={`hook-rail ${className ?? ""}`} style={{ color, opacity: visible && y !== null ? 1 : 0 }}>
      <span ref={lineRef} className="hook-line" style={{ backgroundImage: dashed ? HK_DASH : undefined }} />
      <svg ref={hookRef} className="hook-tab" viewBox="0 0 12 7" width="12" height="7" fill="none">
        <path d="M0.5 0a6 6 0 0 0 6 6H12" stroke="currentColor" strokeWidth="1" strokeDasharray={dashed ? "2 2" : undefined} />
      </svg>
    </span>
  );
}

export function HookSidebar({ activeId, items, onSelect }: {
  activeId: string;
  items: Array<{ id: string; label: string; dividerBefore?: boolean }>;
  onSelect: (id: string) => void;
}) {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  const rowAt = (index: number): { top: number; height: number } | null => {
    const el = itemRefs.current[index];
    return el ? { top: el.offsetTop, height: el.offsetHeight } : null;
  };

  const activeRow = activeIndex >= 0 ? rowAt(activeIndex) : null;
  const activeY = activeRow ? activeRow.top + activeRow.height / 2 : null;
  const hoverRow = hoverIndex !== null ? rowAt(hoverIndex) : null;
  const hoverY = hoverRow ? hoverRow.top + hoverRow.height / 2 : null;

  const showHover = (pointerInside || focusInside) && hoverIndex !== null && hoverIndex !== activeIndex;
  // 悬停在 active 上方：hover 轨只画拐角；在下方：从 active 垂到 hover 项（原版 `activeY ?? 0`）
  const hoverFrom = hoverIndex !== null && activeIndex >= 0 && hoverIndex < activeIndex
    ? Math.max(0, (hoverY ?? 0) - HK_CORNER)
    : (activeY ?? 0);

  const select = (index: number): void => {
    if (index === activeIndex) return;
    onSelect(items[index].id);
  };

  return (
    <nav className="hook-sidebar settings-nav" aria-label="设置导航">
      <div className="hook-sidebar-list" onPointerLeave={() => setPointerInside(false)} onMouseLeave={() => setPointerInside(false)}>
        <HookRail y={activeY} visible dashed className="hook-rail-active" />
        <HookRail from={hoverFrom} y={hoverY} visible={showHover} dashed className="hook-rail-hover" />
        {items.map((item, index) => {
          const isActive = index === activeIndex;
          const setRef = (el: HTMLElement | null): void => {
            itemRefs.current[index] = el;
          };
          return (
            <Fragment key={item.id}>
              {item.dividerBefore && <div className="settings-nav-divider" role="separator" />}
              <button
                type="button"
                ref={setRef}
                data-active={isActive}
                className={isActive ? "active" : ""}
                aria-current={isActive ? "true" : undefined}
                onMouseEnter={() => { setHoverIndex(index); setPointerInside(true); }}
                onFocus={() => { setHoverIndex(index); setFocusInside(true); }}
                onBlur={() => setFocusInside(false)}
                onClick={() => select(index)}
              >
                {item.label}
              </button>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* VoiceNote / VoiceNoteGroup (rareui voicenote) — 语音消息播放器         */
/* 忠实移植自 swamimalode07/rare-ui components/ui/voice-note.tsx：       */
/* 胶囊 = 播放/暂停键（SVG 形变 morph，spring .34/.2）+ 波形条（进度     */
/* clip-inset 揭示，seeded LCG 生成）+ 剩余时间（点按切换 1/1.5/2 倍速）  */
/* + 极光滑轨（四颗光点绕 pill 周长巡航，播放时转速 SPIN_UP .45s 升降）。 */
/* 无 src 时走 performance.now 计时；src 时 <audio> 驱动；组内互斥播放。   */
/* 拖拽/键盘（←→ ±5s、Home/End）可寻址。                                  */
/* ------------------------------------------------------------------ */
const VN_CONTROL_RATIO = 0.76;
const VN_ICON_RATIO = 0.72;
const VN_BLUR_RATIO = 0.32;
const VN_PEAK_RATIO = 0.68;
const VN_PULSE_SPEED = 0.6;
const VN_SPIN_UP = 0.45;
const VN_MIN_AMPLITUDE = 0.14;
const VN_PLAYING_GLOW = 0.62;
const VN_SPEEDS = [1, 1.5, 2];
const VN_SEEK_STEP = 5;

const VN_MIDDLE_MASK = "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.3) 46%, rgba(0,0,0,0.3) 54%, #000 100%)";

// 每颗光点都贴在 pill 轮廓线上，clip 只留内半（原版注释）
const VN_BLOBS = [
  { size: 2, alpha: 0.5, lap: 11, offset: 0.04, pulse: 0.12 },
  { size: 1.5, alpha: 0.4, lap: 17, offset: 0.19, pulse: 0.14 },
  { size: 2.3, alpha: 0.45, lap: 23, offset: 0.47, pulse: 0.1 },
  { size: 1.2, alpha: 0.35, lap: 13, offset: 0.71, pulse: 0.16 },
] as const;

// 巡航时钟不从 0 起步，光点不会排成一条线（原版注释）
const VN_START_AT = 6.2;

// 沿 pill 外轮廓走：上边 → 右圆角 → 下边 → 左圆角（原版注释）
function vnPointOnPill(distance: number, width: number, height: number): [number, number] {
  const radius = height / 2;
  const straight = Math.max(0, width - height);
  const arc = Math.PI * radius;
  const perimeter = 2 * straight + 2 * arc;

  let d = distance % perimeter;
  if (d < 0) d += perimeter;

  if (d < straight) return [radius + d, 0];
  d -= straight;
  if (d < arc) {
    const a = -Math.PI / 2 + d / radius;
    return [width - radius + radius * Math.cos(a), radius + radius * Math.sin(a)];
  }
  d -= arc;
  if (d < straight) return [width - radius - d, height];
  d -= straight;
  const a = Math.PI / 2 + d / radius;
  return [radius + radius * Math.cos(a), radius + radius * Math.sin(a)];
}

// 三角沿中线剖开，得到和暂停条相同的两个四点四边形（原版注释）
const VN_PLAY_SHAPE = [7.7, 5.8, 13, 8.9, 13, 15.1, 7.7, 18.2, 13, 8.9, 18.3, 12, 18.3, 12, 13, 15.1];
const VN_PAUSE_SHAPE = [8.2, 6.8, 10.9, 6.8, 10.9, 17.2, 8.2, 17.2, 13.1, 6.8, 15.8, 6.8, 15.8, 17.2, 13.1, 17.2];

function vnToPath(shape: number[]): string {
  let d = "";
  for (let quad = 0; quad < shape.length; quad += 8) {
    d += `M${shape[quad]} ${shape[quad + 1]}`;
    for (let point = 2; point < 8; point += 2) {
      d += ` L${shape[quad + point]} ${shape[quad + point + 1]}`;
    }
    d += " Z";
  }
  return d;
}

const vnMorph = (from: number[], to: number[], t: number): string =>
  vnToPath(from.map((value, i) => value + (to[i] - value) * t));

const VN_PLAY_PATH = vnToPath(VN_PLAY_SHAPE);
const VN_PAUSE_PATH = vnToPath(VN_PAUSE_SHAPE);

// stroke 把路径的尖角抹圆（原版注释）
const VN_ICON_PAINT = {
  fill: "currentColor",
  stroke: "currentColor",
  strokeWidth: 1.2,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

const VN_SIZES = {
  sm: { height: 40, gap: 8, bar: 2, barGap: 2, pad: 12, font: 11 },
  md: { height: 52, gap: 10, bar: 3, barGap: 3, pad: 14, font: 12 },
  lg: { height: 64, gap: 12, bar: 3, barGap: 4, pad: 16, font: 14 },
} as const;

const vnClamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

const vnFormatTime = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

// sin 与 ** 跨引擎不保证位级一致，结果取三位小数稳定渲染（原版注释）
function vnBuildWaveform(count: number, seed: number): number[] {
  let state = (seed >>> 0) + 0x9e3779b9;
  return Array.from({ length: count }, (_, i) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    const noise = state / 0x100000000;
    const envelope = Math.sin((Math.PI * (i + 0.5)) / count) ** 0.55;
    const swell = 0.5 + 0.5 * Math.sin(i * 0.9 + seed);
    const amplitude = envelope * (0.3 + 0.5 * noise + 0.2 * swell);
    return Math.round(vnClamp(amplitude, VN_MIN_AMPLITUDE, 1) * 1000) / 1000;
  });
}

type VnGroupContext = { claim: (id: string, pause: () => void) => void };

const VnGroupContext = createContext<VnGroupContext | null>(null);

// map 放 ref 里，抢占播放不会重渲染组内其它 note（原版注释）
export function VoiceNoteGroup({ children }: { children: ReactNode }) {
  const notes = useRef(new Map<string, () => void>());
  const claim = useCallback((id: string, pause: () => void) => {
    notes.current.set(id, pause);
    notes.current.forEach((stop, other) => { if (other !== id) stop(); });
  }, []);
  const value = useMemo(() => ({ claim }), [claim]);
  return <VnGroupContext.Provider value={value}>{children}</VnGroupContext.Provider>;
}

export function VoiceNote({
  src,
  duration = 53,
  waveform,
  bars = 40,
  seed = 7,
  playing,
  defaultPlaying = false,
  onPlayingChange,
  onEnded,
  accent = "#F97316",
  size = "md",
  seekable = true,
  speeds = VN_SPEEDS,
  onSpeedChange,
  className,
}: {
  src?: string;
  duration?: number;
  waveform?: number[];
  bars?: number;
  seed?: number;
  playing?: boolean;
  defaultPlaying?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  onEnded?: () => void;
  accent?: string;
  size?: keyof typeof VN_SIZES;
  seekable?: boolean;
  speeds?: number[];
  onSpeedChange?: (speed: number) => void;
  className?: string;
}) {
  const metrics = VN_SIZES[size];
  const control = Math.round(metrics.height * VN_CONTROL_RATIO);
  // 播放键与上下边的距离 = 与左边的距离（原版注释）
  const inset = Math.round((metrics.height - control) / 2);
  const reduced = useRef(prefersReducedMotion()).current;

  const amplitudes = useMemo(() => waveform ?? vnBuildWaveform(Math.max(1, bars), seed), [waveform, bars, seed]);

  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const scrubbing = useRef(false);
  // 无音频文件时进度条的性能基线（原版注释）
  const startedAt = useRef(0);

  const [metaDuration, setMetaDuration] = useState<number | null>(null);
  const [playingState, setPlayingState] = useState(defaultPlaying);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  const [speed, setSpeed] = useState(speeds[0] ?? 1);

  const id = useId();
  const group = useContext(VnGroupContext);

  // 文件必须先报告长度，条才可信；否则禁用（原版注释）
  const loading = !!src && metaDuration === null && !failed;
  const blocked = loading || failed;

  const total = metaDuration ?? duration;
  const isControlled = playing !== undefined;
  const isPlaying = isControlled ? playing : playingState;

  // 新回调身份不该打断在播的条（原版注释）
  const callbacks = useRef({ onEnded, onPlayingChange });
  useEffect(() => {
    callbacks.current = { onEnded, onPlayingChange };
  }, [onEnded, onPlayingChange]);

  const commitPlaying = useCallback((next: boolean) => {
    if (!isControlled) setPlayingState(next);
    callbacks.current.onPlayingChange?.(next);
  }, [isControlled]);

  const applyProgress = useCallback((ratio: number) => {
    progress.current = ratio;
    if (clipRef.current) clipRef.current.style.clipPath = `inset(0 ${(1 - ratio) * 100}% 0 0)`;
  }, []);

  const seekTo = useCallback((ratio: number) => {
    const next = vnClamp(ratio);
    applyProgress(next);
    setElapsed(Math.floor(next * total));
    startedAt.current = performance.now() - (next * total * 1000) / speed;
    const audio = audioRef.current;
    if (audio && Number.isFinite(total)) audio.currentTime = next * total;
  }, [total, speed, applyProgress]);

  const reset = useCallback(() => {
    // 帧循环和 audio 元素都可能报告同一个结束（原版注释）
    if (progress.current === 0) return;
    applyProgress(0);
    setElapsed(0);
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;
    commitPlaying(false);
    callbacks.current.onEnded?.();
  }, [commitPlaying, applyProgress]);

  useEffect(() => {
    if (!isPlaying || total <= 0) return;
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
    audio?.play().catch(() => commitPlaying(false));
    startedAt.current = performance.now() - (progress.current * total * 1000) / speed;

    let frame = 0;
    const tick = (now: number): void => {
      const seconds = audio ? audio.currentTime : ((now - startedAt.current) / 1000) * speed;
      const ratio = vnClamp(seconds / total);
      applyProgress(ratio);
      // 只取整秒，标签是唯一重渲染的东西（原版注释）
      setElapsed(Math.floor(seconds));
      if (ratio < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      reset();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      audio?.pause();
    };
  }, [isPlaying, total, speed, applyProgress, commitPlaying, reset]);

  const scrub = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect?.width) seekTo((event.clientX - rect.left) / rect.width);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!seekable || blocked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbing.current = true;
    scrub(event);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!seekable || blocked || total <= 0) return;
    const at = progress.current * total;
    const to = {
      ArrowLeft: at - VN_SEEK_STEP,
      ArrowRight: at + VN_SEEK_STEP,
      Home: 0,
      End: total,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    seekTo(to / total);
  };

  const remaining = total - elapsed;

  const handleControl = (): void => {
    if (isPlaying) {
      commitPlaying(false);
      return;
    }
    commitPlaying(true);
    // 抢到播放权时停掉同组其它条（原版注释）
    group?.claim(id, () => commitPlaying(false));
  };

  const cycleSpeed = (): void => {
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    onSpeedChange?.(next);
    const audio = audioRef.current;
    if (audio) audio.playbackRate = next;
  };

  return (
    <div
      data-slot="voice-note"
      data-playing={isPlaying || undefined}
      data-loading={loading || undefined}
      data-error={failed || undefined}
      className={`voice-note ${className ?? ""}`}
      style={{ height: metrics.height, gap: metrics.gap, paddingLeft: inset, paddingRight: metrics.pad }}
    >
      <div className="voice-note-shell" aria-hidden="true" />
      <VnAurora accent={accent} height={metrics.height} playing={isPlaying} reduced={reduced} />

      <button
        type="button"
        className="voice-note-control"
        onClick={handleControl}
        disabled={blocked}
        aria-label={isPlaying ? "暂停语音消息" : "播放语音消息"}
        style={{ width: control, height: control }}
      >
        <VnTransportIcon playing={isPlaying} size={Math.round(control * VN_ICON_RATIO)} reduced={reduced} />
      </button>

      <div
        ref={trackRef}
        className={`voice-note-track ${seekable && !blocked ? "seekable" : ""} ${blocked ? "blocked" : ""}`}
        {...(seekable ? {
          role: "slider",
          tabIndex: 0,
          "aria-label": "寻址",
          "aria-valuemin": 0,
          "aria-valuemax": Math.round(total),
          "aria-valuenow": elapsed,
          "aria-valuetext": `${vnFormatTime(elapsed)} / ${vnFormatTime(total)}`,
        } : {})}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => { if (scrubbing.current) scrub(event); }}
        onPointerUp={() => { scrubbing.current = false; }}
        onPointerCancel={() => { scrubbing.current = false; }}
        onKeyDown={handleKeyDown}
      >
        <VnBars amplitudes={amplitudes} metrics={metrics} variant="base" />
        <div ref={clipRef} className="voice-note-clip" aria-hidden="true">
          <VnBars amplitudes={amplitudes} metrics={metrics} variant="full" />
        </div>
      </div>

      <button type="button" className={`voice-note-time ${speeds.length > 1 ? "clickable" : ""}`} style={{ fontSize: metrics.font }} onClick={speeds.length > 1 ? cycleSpeed : undefined} aria-label={speeds.length > 1 ? `播放速度 ${speed} 倍，点按切换` : undefined} disabled={speeds.length <= 1}>
        {vnFormatTime(remaining)}
        {speeds.length > 1 && <span className="voice-note-speed-chip">{speed}×</span>}
      </button>

      {src && (
        <audio
          ref={audioRef}
          className="sr-only"
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            setMetaDuration(Number.isFinite(value) ? value : duration);
          }}
          onError={() => setFailed(true)}
          // 文件可能在自报时长前停住，帧循环走不到终点（原版注释）
          onEnded={reset}
        />
      )}
    </div>
  );
}

function VnBars({ amplitudes, metrics, variant }: { amplitudes: number[]; metrics: (typeof VN_SIZES)[keyof typeof VN_SIZES]; variant: "base" | "full" }) {
  return (
    <div className={`voice-note-bars ${variant}`} style={{ gap: metrics.barGap }}>
      {amplitudes.map((amplitude, i) => (
        <span key={i} className="voice-note-bar" style={{ minWidth: metrics.bar, height: `${(amplitude * VN_PEAK_RATIO * 100).toFixed(2)}%` }} />
      ))}
    </div>
  );
}

function VnAurora({ accent, height, playing, reduced }: { accent: string; height: number; playing: boolean; reduced: boolean }) {
  // 巡航时钟只在播放时推进，暂停时光点原地不动（原版注释）
  const clock = useRef(VN_START_AT);
  const rate = useRef(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<Array<HTMLSpanElement | null>>([]);
  const width = useRef(0);

  const place = useCallback((t: number) => {
    if (width.current === 0) return;
    const perimeter = 2 * Math.max(0, width.current - height) + Math.PI * height;
    VN_BLOBS.forEach((blob, i) => {
      const node = nodes.current[i];
      if (!node) return;
      const travelled = blob.offset + t / blob.lap;
      const [x, y] = vnPointOnPill(travelled * perimeter, width.current, height);
      const phase = blob.offset * Math.PI * 2;
      const scale = 1 + Math.sin(t * VN_PULSE_SPEED + phase) * blob.pulse;
      node.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    });
  }, [height]);

  useEffect(() => {
    const node = fieldRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      width.current = entry.contentRect.width;
      // 立即摆位：resize 或 reduced-motion 观众都不该看到光点叠成一坨（原版注释）
      place(clock.current);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [place]);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      // 后台标签页的长帧间隔不该把光点甩飞（原版注释）
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = playing ? 1 : 0;
      rate.current += (target - rate.current) * (1 - Math.exp(-delta / VN_SPIN_UP));
      clock.current += delta * rate.current;
      place(clock.current);
      if (playing || rate.current > 0.002) {
        frame = requestAnimationFrame(loop);
        return;
      }
      rate.current = 0;
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, reduced, place]);

  return (
    <div className="voice-note-glow" aria-hidden="true">
      <div
        ref={fieldRef}
        className={`voice-note-glow-field ${playing ? "lit" : ""}`}
        style={{ filter: `blur(${height * VN_BLUR_RATIO}px)`, maskImage: VN_MIDDLE_MASK, WebkitMaskImage: VN_MIDDLE_MASK }}
      >
        <span
          className="voice-note-glow-static"
          style={{ background: `radial-gradient(70% 170% at 8% 115%, ${accent} 0%, transparent 62%), radial-gradient(55% 150% at 40% 130%, ${accent} 0%, transparent 58%)` }}
        />
        {VN_BLOBS.map((blob, i) => (
          <span
            key={i}
            ref={(node) => { nodes.current[i] = node; }}
            className="voice-note-glow-blob"
            style={{
              width: blob.size * height,
              height: blob.size * height,
              marginLeft: (-blob.size * height) / 2,
              marginTop: (-blob.size * height) / 2,
              background: accent,
              opacity: blob.alpha,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function VnTransportIcon({ playing, size, reduced }: { playing: boolean; size: number; reduced: boolean }) {
  const pathRef = useRef<SVGPathElement>(null);
  const morph = useSpringValue(playing ? 1 : 0, useMemo(() => visualSpring(0.34, 0.2), []));
  const previous = useRef(playing);

  useEffect(() => {
    if (previous.current === playing) return;
    previous.current = playing;
    if (reduced) {
      morph.jump(playing ? 1 : 0);
      if (pathRef.current) pathRef.current.setAttribute("d", playing ? VN_PAUSE_PATH : VN_PLAY_PATH);
      return;
    }
    morph.set(playing ? 1 : 0);
  }, [playing, reduced, morph]);

  useEffect(() => morph.subscribe((t) => {
    // 弹簧可能过冲，落定在精确路径上（原版注释）
    if (!pathRef.current) return;
    pathRef.current.setAttribute("d", t >= 1 ? VN_PAUSE_PATH : t <= 0 ? VN_PLAY_PATH : vnMorph(VN_PLAY_SHAPE, VN_PAUSE_SHAPE, vnClamp(t)));
  }), [morph]);

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path ref={pathRef} d={playing ? VN_PAUSE_PATH : VN_PLAY_PATH} {...VN_ICON_PAINT} />
    </svg>
  );
}
