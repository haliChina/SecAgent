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
/* react-bits 真源直译：reactbits.dev/micro/voicepill（ts-tailwind 源）  */
/* ------------------------------------------------------------------ */
export type VoiceRecorderShape = 'pill' | 'rounded';
export type VoiceRecorderMode = 'auto' | 'hold' | 'toggle';
export type VoiceRecorderSource = 'simulated' | 'mic';
export type VoiceRecorderStopReason =
  | 'release'
  | 'tap'
  | 'key'
  | 'escape'
  | 'blur'
  | 'disabled'
  | 'mic-denied'
  | 'cancel'
  | 'unmount';

export interface VoiceRecorderProps {
  accentColor?: string;
  iconColor?: string;
  background?: string;
  size?: number;
  shape?: VoiceRecorderShape;
  reach?: number;
  showTime?: boolean;
  waveform?: boolean;
  slideToCancel?: boolean;
  cancelDistance?: number;
  attack?: number;
  release?: number;
  sensitivity?: number;
  floor?: number;
  openDuration?: number;
  pressScale?: number;
  mode?: VoiceRecorderMode;
  holdAfter?: number;
  reactive?: VoiceRecorderSource;
  disabled?: boolean;
  ariaLabel?: string;
  onStart?: (info: { source: VoiceRecorderSource }) => void;
  onStop?: (info: { reason: VoiceRecorderStopReason; duration: number }) => void;
  className?: string;
}

interface AudioBits {
  ctx: AudioContext;
  stream?: MediaStream | null;
  src?: MediaStreamAudioSourceNode | null;
  analyser?: AnalyserNode | null;
  buf?: Uint8Array<ArrayBuffer> | null;
}

interface State {
  listening: boolean;
  pointerId: number | null;
  ownPress: boolean;
  downX: number;
  sliding: boolean;
  hist: number[];
  tick: number;
  acc: number;
  downAt: number;
  startedAt: number;
  raf: number;
  last: number;
  env: number;
  t0: number;
  audio: AudioBits | null;
}

interface Cfg {
  attack: number;
  release: number;
  sensitivity: number;
  floor: number;
  mode: VoiceRecorderMode;
  holdAfter: number;
  reactive: VoiceRecorderSource;
  showTime: boolean;
  waveform: boolean;
  slideToCancel: boolean;
  cancelDistance: number;
  accentColor: string;
  onStart?: VoiceRecorderProps['onStart'];
  onStop?: VoiceRecorderProps['onStop'];
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const LOOP = 4.8;
const SYLLABLES = [
  [0.1, 0.16, 0.9],
  [0.3, 0.12, 0.7],
  [0.5, 0.2, 1],
  [0.95, 0.14, 0.8],
  [1.15, 0.1, 0.6],
  [1.3, 0.22, 0.95],
  [1.9, 0.16, 0.85],
  [2.12, 0.12, 0.7],
  [2.3, 0.18, 0.9],
  [2.55, 0.1, 0.5],
  [3.05, 0.24, 1],
  [3.4, 0.12, 0.75],
  [3.6, 0.16, 0.9]
];
const MIC_BINS = [
  [1, 4],
  [4, 11],
  [11, 33]
];
const MIC_GAIN = 2.2;
const DT_MAX = 0.05;
const SLIDE_MIN = 4;
const WAVE_EVERY = 4;
const WAVE_MAX = 80;

const simulatedLevel = (t: number) => {
  const u = t % LOOP;
  let a = 0.06;
  for (const [s, d, p] of SYLLABLES) {
    const x = (u - s) / d;
    if (x >= 0 && x <= 1) a = Math.max(a, p * 0.5 * (1 - Math.cos(2 * Math.PI * x)));
  }
  return a * (0.7 + 0.3 * Math.abs(Math.sin(2 * Math.PI * 7.1 * u)));
};
const micLevel = (analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>) => {
  analyser.getByteFrequencyData(buf);
  let total = 0;
  for (const [lo, hi] of MIC_BINS) {
    let s = 0;
    for (let i = lo; i < hi; i += 1) s += buf[i];
    total += s / ((hi - lo) * 255);
  }
  return (total / MIC_BINS.length) * MIC_GAIN;
};
const drawWave = (s: State, canvas: HTMLCanvasElement, level: number, color: string, floor: number) => {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(1, Math.round(rect.width * dpr));
  const H = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  s.acc = Math.max(s.acc, level);
  s.tick = (s.tick + 1) % WAVE_EVERY;
  if (s.tick === 0) {
    s.hist.push(s.acc);
    s.acc = 0;
    if (s.hist.length > WAVE_MAX) s.hist.shift();
  }
  const bw = 2 * dpr;
  const step = 3 * dpr;
  const shift = (s.tick / WAVE_EVERY) * step;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = color;
  for (let i = 0; i < s.hist.length; i += 1) {
    const v = s.hist[s.hist.length - 1 - i];
    const x = W - (i + 1) * step - shift;
    if (x + bw < 0) break;
    const h = Math.max(bw, (floor + (1 - floor) * v) * H);
    const t = Math.min(1, Math.max(0, (x + bw / 2) / (W * 0.55)));
    const fade = t * t * (3 - 2 * t);
    ctx.globalAlpha = (0.35 + 0.65 * v) * fade;
    ctx.beginPath();
    ctx.roundRect(x, (H - h) / 2, bw, h, bw / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const openMic = async (s: State) => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
  s.audio ??= { ctx: new Ctx() };
  const a = s.audio;
  if (a.ctx.state === 'suspended') a.ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (!s.listening) {
    stream.getTracks().forEach(t => t.stop());
    return;
  }
  a.stream = stream;
  a.src = a.ctx.createMediaStreamSource(stream);
  a.analyser = a.ctx.createAnalyser();
  a.analyser.fftSize = 256;
  a.analyser.smoothingTimeConstant = 0;
  a.src.connect(a.analyser);
  a.buf = new Uint8Array(a.analyser.frequencyBinCount);
};
const closeMic = (s: State) => {
  const a = s.audio;
  if (!a?.stream) return;
  a.stream.getTracks().forEach(t => t.stop());
  a.src?.disconnect();
  a.stream = null;
  a.src = null;
  a.analyser = null;
  a.buf = null;
};

export const VoiceRecorder = ({
  accentColor = '#f5f5f5',
  iconColor = '#a1a1aa',
  background = '#27272a',
  size = 28,
  shape = 'pill',
  reach = 8,
  showTime = true,
  waveform = true,
  slideToCancel = true,
  cancelDistance = 64,
  attack = 40,
  release = 240,
  sensitivity = 1,
  floor = 0.1,
  openDuration = 200,
  pressScale = 0.95,
  mode = 'auto',
  holdAfter = 300,
  reactive = 'simulated',
  disabled = false,
  ariaLabel = 'Dictate',
  onStart,
  onStop,
  className = ''
}: VoiceRecorderProps) => {
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [input, setInput] = useState('pointer');
  const timeRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLButtonElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const st = useRef<State>({
    listening: false,
    pointerId: null,
    ownPress: false,
    downX: 0,
    sliding: false,
    hist: [],
    tick: 0,
    acc: 0,
    downAt: 0,
    startedAt: 0,
    raf: 0,
    last: 0,
    env: 0,
    t0: 0,
    audio: null
  });
  const cfg = useRef<Cfg>({} as Cfg);
  cfg.current = {
    attack,
    release,
    sensitivity,
    floor,
    mode,
    holdAfter,
    reactive,
    showTime,
    waveform,
    slideToCancel,
    cancelDistance,
    accentColor,
    onStart,
    onStop
  };

  const frame = (now: number) => {
    const s = st.current;
    const c = cfg.current;
    const dt = Math.min((now - s.last) / 1000, DT_MAX);
    s.last = now;
    let target = 0;
    if (s.listening) {
      if (s.audio?.analyser) target = micLevel(s.audio.analyser, s.audio.buf as Uint8Array<ArrayBuffer>);
      else if (c.reactive !== 'mic') target = simulatedLevel((now - s.t0) / 1000);
    }
    target = Math.min(1, target * c.sensitivity);
    const tau = Math.max(1, target > s.env ? c.attack : c.release) / 1000;
    s.env += (target - s.env) * (1 - Math.exp(-dt / tau));
    if (s.listening && c.showTime && timeRef.current) {
      const text = clock(now - s.startedAt);
      if (timeRef.current.textContent !== text) timeRef.current.textContent = text;
    }
    if (s.listening && c.waveform && waveRef.current) drawWave(s, waveRef.current, s.env, c.accentColor, c.floor);
    s.raf = s.listening ? requestAnimationFrame(frame) : 0;
  };

  const begin = (kind: 'pointer' | 'key') => {
    const s = st.current;
    const c = cfg.current;
    if (s.listening || disabled) return;
    s.listening = true;
    s.hist = [];
    s.tick = 0;
    s.acc = 0;
    s.env = 0;
    s.startedAt = performance.now();
    s.t0 = s.startedAt;
    s.last = s.startedAt;
    if (timeRef.current) timeRef.current.textContent = '0:00';
    setListening(true);
    setInput(kind);
    if (!s.raf) s.raf = requestAnimationFrame(frame);
    c.onStart?.({ source: c.reactive });
    if (c.reactive === 'mic') openMic(s).catch(() => end('mic-denied'));
  };
  const end = (reason: VoiceRecorderStopReason) => {
    const s = st.current;
    const c = cfg.current;
    if (!s.listening) return;
    s.listening = false;
    closeMic(s);
    setListening(false);
    setInput(reason === 'key' || reason === 'escape' ? 'key' : 'pointer');
    c.onStop?.({ reason, duration: Math.round(performance.now() - s.startedAt) });
  };

  const settleSlide = () => {
    const s = st.current;
    const root = rootRef.current;
    s.sliding = false;
    if (!root) return;
    delete root.dataset.sliding;
    root.style.setProperty('--vp-slide', '0px');
    root.style.setProperty('--vp-cancel', '0');
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = st.current;
    const c = cfg.current;
    const root = rootRef.current;
    if (!root || s.pointerId !== e.pointerId || !c.slideToCancel || !s.listening || !s.ownPress) return;
    const dx = e.clientX - s.downX;
    if (!s.sliding && dx > -SLIDE_MIN) return;
    s.sliding = true;
    root.dataset.sliding = '';
    const pull = Math.min(c.cancelDistance + 24, Math.max(0, -dx));
    root.style.setProperty('--vp-slide', `${-pull}px`);
    const progress = Math.min(1, pull / c.cancelDistance);
    root.style.setProperty('--vp-cancel', progress.toFixed(3));
    if (progress >= 1) {
      settleSlide();
      end('cancel');
    }
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = st.current;
    if (disabled || e.button !== 0 || !e.isPrimary || s.pointerId !== null) return;
    s.pointerId = e.pointerId;
    s.downX = e.clientX;
    s.downAt = performance.now();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setPressed(true);
    s.ownPress = !s.listening;
    if (!s.listening) begin('pointer');
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = st.current;
    const c = cfg.current;
    if (e.pointerId !== s.pointerId) return;
    s.pointerId = null;
    setPressed(false);
    if (s.sliding) settleSlide();
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (!s.listening) return;
    const held = performance.now() - s.downAt;
    const isHold = c.mode === 'hold' || (c.mode === 'auto' && held >= c.holdAfter);
    if (s.ownPress) {
      if (isHold) end('release');
    } else {
      end(held < c.holdAfter ? 'tap' : 'release');
    }
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') {
      end('escape');
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      if (st.current.listening) end('key');
      else begin('key');
    }
  };
  const onClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0 && st.current.pointerId === null && !(e.nativeEvent as globalThis.PointerEvent).pointerType) {
      if (st.current.listening) end('key');
      else begin('key');
    }
  };

  useEffect(() => {
    if (!pressed) return undefined;
    const stop = () => end('blur');
    const onVis = () => {
      if (document.hidden) stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressed]);
  useEffect(() => {
    if (disabled) end('disabled');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);
  useEffect(() => {
    const s = st.current;
    return () => {
      end('unmount');
      cancelAnimationFrame(s.raf);
      s.audio?.ctx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const radius = shape === 'rounded' ? Math.round(size * 0.29) : size / 2;
  const hit = Math.max(0, Math.min(10, (44 - size) / 2));
  const timeSize = Math.max(10, Math.round(size * 0.36));
  const clockW = showTime ? Math.round(timeSize * 2.5) + 4 : 0;
  const waveW = waveform ? Math.round(size * 1.9) : 0;
  const extra = clockW + waveW;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={listening}
      className={`rb-vp group relative isolate m-0 inline-grid cursor-pointer touch-none place-items-center border-0 bg-transparent p-0 outline-none select-none [width:var(--vp-size)] [height:var(--vp-size)] [border-radius:var(--vp-radius)] [color:var(--vp-icon)] [font-family:inherit] [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [transition:transform_160ms_cubic-bezier(0.23,1,0.32,1),color_150ms_ease] before:absolute before:[inset:calc(-1*var(--vp-hit))] before:content-[''] data-[state=listening]:z-[1] data-[state=listening]:[color:var(--vp-accent)] data-[pressed]:[transform:scale(var(--vp-press))] disabled:pointer-events-none disabled:cursor-default disabled:opacity-55 motion-reduce:[transform:none]! motion-reduce:[transition:color_150ms_ease]${className ? ` ${className}` : ''}`}
      data-state={listening ? 'listening' : 'idle'}
      data-pressed={pressed ? '' : undefined}
      data-input={input}
      data-time={showTime ? '' : undefined}
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onContextMenu={e => e.preventDefault()}
      style={
        {
          '--vp-accent': accentColor,
          '--vp-icon': iconColor,
          '--vp-bg': background,
          '--vp-size': `${size}px`,
          '--vp-radius': `${radius}px`,
          '--vp-reach': `${reach}px`,
          '--vp-extra': `${extra}px`,
          '--vp-clock-w': `${clockW}px`,
          '--vp-wave-w': `${waveW}px`,
          '--vp-stop': `${Math.round(size * 0.32)}px`,
          '--vp-icon-size': `${Math.round(size * 0.54)}px`,
          '--vp-time-size': `${timeSize}px`,
          '--vp-open': `${openDuration}ms`,
          '--vp-press': pressScale,
          '--vp-hit': `${hit}px`
        } as CSSProperties
      }
    >
      <span
        className="pointer-events-none absolute [inset:0_0_0_calc(-1*(var(--vp-reach)+var(--vp-extra)))] [border-radius:var(--vp-radius)] [background:var(--vp-bg)] [clip-path:inset(0_0_0_calc(var(--vp-reach)+var(--vp-extra))_round_var(--vp-radius))] [transition:clip-path_var(--vp-open)_cubic-bezier(0.23,1,0.32,1),background-color_150ms_ease] [@media(hover:hover)_and_(pointer:fine)]:group-enabled:group-data-[state=idle]:group-hover:[background:color-mix(in_srgb,var(--vp-icon)_10%,var(--vp-bg))] group-data-[state=listening]:[clip-path:inset(0_0_round_var(--vp-radius))] group-data-[input=key]:[transition-duration:0ms] motion-reduce:[transition:background-color_150ms_ease]"
        aria-hidden="true"
      />
      {waveform ? (
        <canvas
          ref={waveRef}
          className="pointer-events-none absolute top-[18%] h-[64%] opacity-0 [right:calc(100%+var(--vp-clock-w))] [width:var(--vp-wave-w)] [filter:blur(2px)] [transform:translateX(var(--vp-slide))] [transition:opacity_200ms_ease,filter_200ms_ease,transform_240ms_cubic-bezier(0.23,1,0.32,1)] group-data-[state=listening]:[opacity:calc(1-var(--vp-cancel))] group-data-[state=listening]:[filter:blur(0)] group-data-[sliding]:[transition-property:opacity,filter] motion-reduce:[filter:none]! motion-reduce:[transition-property:opacity]"
          aria-hidden="true"
        />
      ) : null}
      {slideToCancel ? (
        <span
          className="pointer-events-none absolute inset-y-0 right-full inline-flex items-center justify-center gap-[3px] leading-none font-medium [width:var(--vp-extra)] [color:var(--vp-accent)] [font-size:var(--vp-time-size)] [opacity:var(--vp-cancel)]"
          aria-hidden="true"
        >
          <ArrowLeftIcon size={12} strokeWidth={2.2} />
          <span>Cancel</span>
        </span>
      ) : null}
      {showTime ? (
        <span
          ref={timeRef}
          className="pointer-events-none absolute inset-y-0 right-full box-border grid place-items-center leading-none font-medium tabular-nums opacity-0 [width:var(--vp-clock-w)] [color:var(--vp-accent)] [font-size:var(--vp-time-size)] [filter:blur(2px)] [transform:translateX(var(--vp-slide))] [transition:opacity_200ms_ease,filter_200ms_ease,transform_240ms_cubic-bezier(0.23,1,0.32,1)] group-data-[state=listening]:[opacity:calc(1-var(--vp-cancel))] group-data-[state=listening]:[filter:blur(0)] group-data-[sliding]:[transition-property:opacity,filter] group-data-[input=key]:[transition-duration:0ms] motion-reduce:[filter:none]! motion-reduce:[transition-property:opacity]"
          aria-hidden="true"
        >
          0:00
        </span>
      ) : null}
      <span className="relative grid place-items-center [width:var(--vp-size)] [height:var(--vp-size)] [transform:translateX(var(--vp-slide))] [transition:transform_240ms_cubic-bezier(0.23,1,0.32,1)] group-data-[sliding]:[transition-property:opacity,filter] motion-reduce:[filter:none]! motion-reduce:[transition-property:opacity]">
        <span className="inline-flex [grid-area:1/1] [transition:opacity_200ms_ease,filter_200ms_ease,transform_200ms_cubic-bezier(0.23,1,0.32,1)] group-data-[state=listening]:opacity-0 group-data-[state=listening]:[filter:blur(2px)] group-data-[state=listening]:[transform:scale(0.7)] group-data-[input=key]:[transition-duration:0ms] motion-reduce:[filter:none]! motion-reduce:[transform:none]! motion-reduce:[transition:opacity_200ms_ease]">
          <MicIcon size={Math.round(size * 0.54)} strokeWidth={2} />
        </span>
        <span
          className="bg-current opacity-0 [grid-area:1/1] [width:var(--vp-stop)] [height:var(--vp-stop)] [border-radius:22%] [filter:blur(2px)] [transform:scale(0.6)] [transition:opacity_200ms_ease,filter_200ms_ease,transform_200ms_cubic-bezier(0.23,1,0.32,1)] group-data-[state=listening]:opacity-100 group-data-[state=listening]:[filter:blur(0)] group-data-[state=listening]:[transform:scale(1)] group-data-[input=key]:[transition-duration:0ms] motion-reduce:[filter:none]! motion-reduce:[transform:none]! motion-reduce:[transition:opacity_200ms_ease]"
          aria-hidden="true"
        />
      </span>
    </button>
  );
};


/* ------------------------------------------------------------------ */
/* react-bits 真源直译：reactbits.dev/micro/branchedmenu（ts-tailwind 源）  */
/* ------------------------------------------------------------------ */
export interface BranchedMenuChild {
  value: string;
  label: string;
  icon?: ReactNode | LucideIcon;
}

export interface BranchedMenuItem {
  label: string;
  value?: string;
  children?: BranchedMenuChild[];
}

export interface BranchedMenuProps {
  items?: BranchedMenuItem[];
  defaultOpen?: number | number[];
  defaultActive?: string;
  onSelect?: (value: string, item: BranchedMenuChild | BranchedMenuItem) => void;
  onToggle?: (index: number, open: boolean) => void;
  color?: string;
  accentColor?: string;
  lineColor?: string;
  width?: number;
  rowHeight?: number;
  indent?: number;
  trunk?: number;
  radius?: number;
  lineWidth?: number;
  fontSize?: number;
  drawDuration?: number;
  foldDuration?: number;
  className?: string;
}

const DEFAULT_ITEMS: BranchedMenuItem[] = [
  {
    label: 'Getting started',
    children: [
      { value: 'install', label: 'Installation', icon: DownloadIcon },
      { value: 'quick', label: 'Quick start', icon: RocketIcon },
      { value: 'config', label: 'Configuration', icon: SettingsIcon },
      { value: 'theming', label: 'Theming', icon: PaintbrushIcon }
    ]
  },
  {
    label: 'Components',
    children: [
      { value: 'buttons', label: 'Buttons', icon: MousePointer2Icon },
      { value: 'typography', label: 'Typography', icon: TypeIcon },
      { value: 'overlays', label: 'Overlays', icon: LayersIcon },
      { value: 'toasts', label: 'Toasts', icon: BellIcon }
    ]
  }
];
const PAD = 6;
const MARK = 16;

const renderIcon = (icon: ReactNode | LucideIcon) => {
  if (isValidElement(icon)) return icon;
  const Ico = icon as LucideIcon;
  return <Ico size={16} strokeWidth={1.8} />;
}
const toSet = (open: number | number[]) => new Set(Array.isArray(open) ? open : open >= 0 ? [open] : []);

export const BranchedMenu = ({
  items = DEFAULT_ITEMS,
  defaultOpen = 0,
  defaultActive = '',
  onSelect,
  onToggle,
  color = '#f5f5f5',
  accentColor = '#f5f5f5',
  lineColor = '#3f3f46',
  width = 240,
  rowHeight = 36,
  indent = 40,
  trunk = 14,
  radius = 10,
  lineWidth = 1.5,
  fontSize = 14,
  drawDuration = 400,
  foldDuration = 300,
  className = ''
}: BranchedMenuProps) => {
  const [open, setOpen] = useState<Set<number>>(() => toSet(defaultOpen));
  const [active, setActive] = useState(() => {
    if (defaultActive) return defaultActive;
    const first = items.find((it, i) => it.children && toSet(defaultOpen).has(i));
    return first?.children?.[0]?.value ?? '';
  });
  const navRef = useRef<HTMLElement>(null);
  const heads = useRef<(HTMLButtonElement | null)[]>([]);
  const markerRef = useRef<HTMLSpanElement>(null);
  const latest = useRef<{ onSelect?: BranchedMenuProps['onSelect']; onToggle?: BranchedMenuProps['onToggle'] }>({});
  latest.current = { onSelect, onToggle };

  const activeSection = items.findIndex(it => it.children?.some(kid => kid.value === active));
  const markerShown = activeSection >= 0 && open.has(activeSection);
  useLayoutEffect(() => {
    const place = (glide: boolean) => {
      const m = markerRef.current;
      const el = heads.current[activeSection];
      if (!m) return;
      const on = markerShown && el;
      if (!glide) m.style.transition = 'none';
      if (on) m.style.top = `${el.offsetTop + (el.offsetHeight - MARK) / 2}px`;
      m.toggleAttribute('data-on', Boolean(on));
      if (!glide) {
        void m.offsetHeight;
        m.style.transition = '';
      }
    };
    place(true);
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      place(false);
    });
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [activeSection, markerShown, items, fontSize, rowHeight]);

  const select = (value: string, item: BranchedMenuChild | BranchedMenuItem) => {
    setActive(value);
    latest.current.onSelect?.(value, item);
  };
  const toggle = (i: number) => {
    setOpen(prev => {
      const next = new Set(prev);
      const isOpen = !next.has(i);
      if (isOpen) next.add(i);
      else next.delete(i);
      latest.current.onToggle?.(i, isOpen);
      return next;
    });
  };

  const r = Math.min(radius, rowHeight / 2 - 2);
  const endX = indent - 8;
  const rowY = (k: number) => PAD + k * rowHeight + rowHeight / 2;
  const branch = (k: number) => `M ${trunk} ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const reach = (k: number) => `M ${trunk} 0 V ${rowY(k) - r} A ${r} ${r} 0 0 0 ${trunk + r} ${rowY(k)} H ${endX}`;
  const length = (k: number) => rowY(k) - r + (Math.PI * r) / 2 + (endX - trunk - r);

  return (
    <nav
      ref={navRef}
      className={`relative flex w-fit max-w-[min(var(--bm-w),100%)] flex-col pl-3.5 leading-[1.2] [color:var(--bm-ink)] [font-family:inherit] [font-size:var(--bm-font)] before:absolute before:top-2 before:bottom-0 before:left-0 before:w-0.5 before:rounded-[1px] before:[background:linear-gradient(to_bottom,var(--bm-line)_0%,var(--bm-line)_55%,transparent_100%)] before:content-['']${className ? ` ${className}` : ''}`}
      style={
        {
          '--bm-w': `${width}px`,
          '--bm-ink': color,
          '--bm-accent': accentColor,
          '--bm-line': lineColor,
          '--bm-font': `${fontSize}px`,
          '--bm-row': `${rowHeight}px`,
          '--bm-indent': `${indent}px`,
          '--bm-line-w': lineWidth,
          '--bm-draw': `${drawDuration}ms`,
          '--bm-muted': `color-mix(in srgb, ${color} 55%, transparent)`,
          '--bm-fold': `${foldDuration}ms`
        } as CSSProperties
      }
    >
      <span
        ref={markerRef}
        className="absolute -top-px left-0 z-[1] h-4 w-0.5 rounded-[1px] opacity-0 [background:var(--bm-accent)] [transition:top_220ms_cubic-bezier(0.23,1,0.32,1),opacity_150ms_ease] data-[on]:opacity-100 motion-reduce:[transition:opacity_150ms_ease]"
        aria-hidden="true"
      />
      {items.map((item, i) => {
        const kids = item.children;
        const isOpen = kids ? open.has(i) : false;
        const leafValue = item.value ?? item.label;
        const leafActive = !kids && leafValue === active;
        const bodyH = kids ? PAD * 2 + kids.length * rowHeight : 0;
        return (
          <div
            key={item.value ?? item.label}
            className="group/section flex flex-col"
            data-open={isOpen ? '' : undefined}
          >
            <button
              ref={el => {
                heads.current[i] = el;
              }}
              type="button"
              className="m-0 block cursor-pointer border-0 bg-transparent py-[9px] text-left font-medium outline-none [color:var(--bm-muted)] [font-family:inherit] [font-size:calc(var(--bm-font)+1px)] [-webkit-tap-highlight-color:transparent] [transition:color_200ms_ease] group-data-[open]/section:[color:var(--bm-ink)] data-[active]:[color:var(--bm-ink)] hover:[color:var(--bm-ink)]"
              aria-expanded={kids ? isOpen : undefined}
              aria-current={leafActive ? 'true' : undefined}
              data-active={leafActive ? '' : undefined}
              onClick={() => (kids ? toggle(i) : select(leafValue, item))}
            >
              {item.label}
            </button>
            {kids ? (
              <div className="grid [grid-template-rows:0fr] [transition:grid-template-rows_var(--bm-fold)_cubic-bezier(0.23,1,0.32,1)] group-data-[open]/section:[grid-template-rows:1fr] motion-reduce:transition-none">
                <div className="min-h-0 overflow-hidden">
                  <div className="relative box-border py-1.5" style={{ height: bodyH }}>
                    <svg
                      className="pointer-events-none absolute top-0 left-0 overflow-visible opacity-0 [transition:opacity_200ms_ease] group-data-[open]/section:opacity-100 group-data-[open]/section:[transition:opacity_250ms_ease_100ms]"
                      width={indent}
                      height={bodyH}
                      aria-hidden="true"
                    >
                      <path
                        className="fill-none [stroke:var(--bm-line)] [stroke-width:var(--bm-line-w)] [stroke-linecap:round] [stroke-linejoin:round]"
                        d={`M ${trunk} 0 V ${rowY(kids.length - 1) - r}`}
                      />
                      {kids.map((kid, k) => (
                        <path
                          key={kid.value}
                          className="fill-none [stroke:var(--bm-line)] [stroke-width:var(--bm-line-w)] [stroke-linecap:round] [stroke-linejoin:round]"
                          d={branch(k)}
                        />
                      ))}
                      {kids.map((kid, k) => (
                        <path
                          key={kid.value}
                          className="fill-none [stroke:var(--bm-accent)] [stroke-width:var(--bm-line-w)] [stroke-linecap:round] [stroke-linejoin:round] [transition:stroke-dashoffset_var(--bm-draw)_cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
                          d={reach(k)}
                          style={{
                            strokeDasharray: length(k),
                            strokeDashoffset: kid.value === active ? 0 : length(k)
                          }}
                        />
                      ))}
                    </svg>
                    {kids.map(kid => (
                      <button
                        key={kid.value}
                        type="button"
                        className="m-0 box-border flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-0 pr-0 text-left outline-none [height:var(--bm-row)] [padding-left:var(--bm-indent)] [color:var(--bm-muted)] [font-family:inherit] [-webkit-tap-highlight-color:transparent] [transition:color_200ms_ease] hover:[color:var(--bm-ink)] data-[active]:font-medium data-[active]:[color:var(--bm-accent)]"
                        aria-current={kid.value === active ? 'true' : undefined}
                        data-active={kid.value === active ? '' : undefined}
                        tabIndex={isOpen ? 0 : -1}
                        onClick={() => select(kid.value, kid)}
                      >
                        {kid.icon ? (
                          <span className="inline-flex flex-none" aria-hidden="true">
                            {renderIcon(kid.icon)}
                          </span>
                        ) : null}
                        <span className="whitespace-nowrap">{kid.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
};
