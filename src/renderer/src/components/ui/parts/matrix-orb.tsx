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
 * 组件绝不开流，Codex R5）；默认色取应用 accent #2563EB（白蓝主题）。
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

export function MatrixOrb({ size = 240, state = "idle", level, color = "#2563EB", dots = 11, stream, labels }: {
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
