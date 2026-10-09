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
/* VoiceNote / VoiceNoteGroup (rareui voicenote) — 语音消息播放器        */
/* 逐行直译自 swamimalode07/rare-ui components/ui/voice-note.tsx：       */
/* 胶囊播放器（播放/暂停 SVG 形变 morph、LCG 波形、进度 clip-inset、     */
/* 倍速切换、四颗光点绕 pill 巡航 mix-blend、组内互斥、拖拽/键盘寻址）。 */
/* 适配：aria-label 中文化；accent 默认取应用主题橙。                     */
/* ------------------------------------------------------------------ */
const VN_GLOW: Transition = { duration: 0.5, ease: [0.22, 1, 0.36, 1] };
const VN_ICON: Transition = { type: "spring", duration: 0.34, bounce: 0.2 };
const VN_TAP: Transition = { type: "spring", duration: 0.25, bounce: 0.3 };
const VN_INSTANT: Transition = { duration: 0 };

const VN_PLAYING_GLOW = 0.62;

const VN_SPEEDS = [1, 1.5, 2];

// all proportional to the bar height, so every size keeps the same look
const VN_CONTROL_RATIO = 0.76;
const VN_ICON_RATIO = 0.72;
const VN_BLUR_RATIO = 0.32;
const VN_PEAK_RATIO = 0.68;

const VN_PULSE_SPEED = 0.6;

// seconds for the orbit to reach full speed, and to coast back down
const VN_SPIN_UP = 0.45;

const VN_MIDDLE_MASK =
  "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.3) 46%, rgba(0,0,0,0.3) 54%, #000 100%)";

// each light is centred on the outline, so the clip keeps only its inner half
const VN_BLOBS = [
  { size: 2, alpha: 0.5, lap: 11, offset: 0.04, pulse: 0.12 },
  { size: 1.5, alpha: 0.4, lap: 17, offset: 0.19, pulse: 0.14 },
  { size: 2.3, alpha: 0.45, lap: 23, offset: 0.47, pulse: 0.1 },
  { size: 1.2, alpha: 0.35, lap: 13, offset: 0.71, pulse: 0.16 },
] as const;

// the laps only pull the lights apart over time, so the clock starts mid flow rather than lined up
const VN_START_AT = 6.2;

// walks the outline of a pill: top edge, right cap, bottom edge, left cap
const vnPointOnPill = (distance: number, width: number, height: number): [number, number] => {
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
    return [
      width - radius + radius * Math.cos(a),
      radius + radius * Math.sin(a),
    ];
  }
  d -= arc;
  if (d < straight) return [width - radius - d, height];
  d -= straight;
  const a = Math.PI / 2 + d / radius;
  return [
    radius + radius * Math.cos(a),
    radius + radius * Math.sin(a),
  ];
};

// the triangle is split down the middle, giving it the same two four-point quads as the bars
const VN_PLAY_SHAPE = [
  7.7, 5.8, 13, 8.9, 13, 15.1, 7.7, 18.2, 13, 8.9, 18.3, 12, 18.3, 12, 13, 15.1,
];
const VN_PAUSE_SHAPE = [
  8.2, 6.8, 10.9, 6.8, 10.9, 17.2, 8.2, 17.2, 13.1, 6.8, 15.8, 6.8, 15.8, 17.2,
  13.1, 17.2,
];

const vnToPath = (shape: number[]): string => {
  let d = "";
  for (let quad = 0; quad < shape.length; quad += 8) {
    d += `M${shape[quad]} ${shape[quad + 1]}`;
    for (let point = 2; point < 8; point += 2) {
      d += ` L${shape[quad + point]} ${shape[quad + point + 1]}`;
    }
    d += " Z";
  }
  return d;
};

const vnMorph = (from: number[], to: number[], t: number): string =>
  vnToPath(from.map((value, i) => value + (to[i] - value) * t));

const VN_PLAY_PATH = vnToPath(VN_PLAY_SHAPE);
const VN_PAUSE_PATH = vnToPath(VN_PAUSE_SHAPE);

// stroke rounds the corners the path leaves sharp
const VN_ICON_PAINT = {
  fill: "currentColor",
  stroke: "currentColor",
  strokeWidth: 1.2,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

const VN_SIZES = {
  sm: { height: 40, gap: 8, bar: 2, barGap: 2, pad: 12, text: "text-[11px]" },
  md: { height: 52, gap: 10, bar: 3, barGap: 3, pad: 14, text: "text-xs" },
  lg: { height: 64, gap: 12, bar: 3, barGap: 4, pad: 16, text: "text-sm" },
} as const;

const VN_SEEK_STEP = 5;
const VN_MIN_AMPLITUDE = 0.14;

const vnClamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));

const vnFormatTime = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

// sin and ** are not bit identical across engines, so the result is rounded to survive hydration
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

// keeps the map out of state, so claiming a turn never re-renders the other notes
export function VoiceNoteGroup({ children }: { children: ReactNode }) {
  const notes = useRef(new Map<string, () => void>());

  const claim = useCallback((id: string, pause: () => void) => {
    notes.current.set(id, pause);
    notes.current.forEach((stop, other) => other !== id && stop());
  }, []);

  const value = useMemo(() => ({ claim }), [claim]);

  return (
    <VnGroupContext.Provider value={value}>
      {children}
    </VnGroupContext.Provider>
  );
}

export type VoiceNoteProps = Omit<ComponentProps<"div">, "onEnded"> & {
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
};

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
  accent = "#2563EB",
  size = "md",
  seekable = true,
  speeds = VN_SPEEDS,
  onSpeedChange,
  className,
  style,
  ...props
}: VoiceNoteProps) {
  const metrics = VN_SIZES[size];
  const control = Math.round(metrics.height * VN_CONTROL_RATIO);
  // the control sits as far from the left edge as it does from the top and bottom
  const inset = Math.round((metrics.height - control) / 2);
  const shouldReduceMotion = useReducedMotion();

  const amplitudes = useMemo(
    () => waveform ?? vnBuildWaveform(Math.max(1, bars), seed),
    [waveform, bars, seed],
  );

  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  // performance.now() baseline for the clip that has no audio file behind it
  const startedAt = useRef(0);

  const [metaDuration, setMetaDuration] = useState<number | null>(null);
  const [playingState, setPlayingState] = useState(defaultPlaying);
  const [elapsed, setElapsed] = useState(0);
  const [failed, setFailed] = useState(false);
  const [speed, setSpeed] = useState(speeds[0] ?? 1);

  const id = useId();
  const group = useContext(VnGroupContext);

  // a file has to report its length before the bar can be trusted, or pressed
  const loading = !!src && metaDuration === null && !failed;
  const blocked = loading || failed;

  const total = metaDuration ?? duration;
  const isControlled = playing !== undefined;
  const isPlaying = isControlled ? playing : playingState;

  const progress = useMotionValue(0);
  const clipPath = useTransform(
    progress,
    (p) => `inset(0 ${(1 - p) * 100}% 0 0)`,
  );

  // a new callback identity would otherwise restart the running clip
  const callbacks = useRef({ onEnded, onPlayingChange });
  useEffect(() => {
    callbacks.current = { onEnded, onPlayingChange };
  }, [onEnded, onPlayingChange]);

  const commitPlaying = useCallback(
    (next: boolean) => {
      if (!isControlled) setPlayingState(next);
      callbacks.current.onPlayingChange?.(next);
    },
    [isControlled],
  );

  const seekTo = useCallback(
    (ratio: number) => {
      const next = vnClamp(ratio);
      progress.set(next);
      setElapsed(Math.floor(next * total));
      startedAt.current = performance.now() - (next * total * 1000) / speed;
      const audio = audioRef.current;
      if (audio && Number.isFinite(total)) audio.currentTime = next * total;
    },
    [progress, total, speed],
  );

  const reset = useCallback(() => {
    // the frame loop and the audio element can both report the end of the same clip
    if (progress.get() === 0) return;
    progress.set(0);
    setElapsed(0);
    const audio = audioRef.current;
    if (audio) audio.currentTime = 0;
    commitPlaying(false);
    callbacks.current.onEnded?.();
  }, [progress, commitPlaying]);

  useEffect(() => {
    if (!isPlaying || total <= 0) return;
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
    audio?.play().catch(() => commitPlaying(false));
    startedAt.current =
      performance.now() - (progress.get() * total * 1000) / speed;

    let frame = 0;
    const tick = (now: number) => {
      const seconds = audio
        ? audio.currentTime
        : ((now - startedAt.current) / 1000) * speed;
      const ratio = vnClamp(seconds / total);
      progress.set(ratio);
      // whole seconds only, so the label is the one thing that re-renders
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
  }, [isPlaying, total, speed, progress, commitPlaying, reset]);

  const scrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect?.width) seekTo((event.clientX - rect.left) / rect.width);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!seekable || blocked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbing.current = true;
    scrub(event);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!seekable || blocked || total <= 0) return;
    const at = progress.get() * total;
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
  const slider = seekable
    ? {
        role: "slider" as const,
        tabIndex: 0,
        "aria-label": "寻址",
        "aria-valuemin": 0,
        "aria-valuemax": Math.round(total),
        "aria-valuenow": elapsed,
        "aria-valuetext": `${vnFormatTime(elapsed)} / ${vnFormatTime(total)}`,
      }
    : undefined;
  const glow = isPlaying ? VN_PLAYING_GLOW : 0;

  const handleControl = () => {
    if (isPlaying) {
      commitPlaying(false);
      return;
    }
    commitPlaying(true);
    // taking a turn stops whatever else is playing in the same group
    group?.claim(id, () => commitPlaying(false));
  };

  const cycleSpeed = () => {
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length]!;
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
      className={cn(
        "relative isolate inline-flex select-none items-center",
        className,
      )}
      style={{
        height: metrics.height,
        gap: metrics.gap,
        paddingLeft: inset,
        paddingRight: metrics.pad,
        ...style,
      }}
      {...props}
    >
      <div className="absolute inset-0 -z-10 rounded-full bg-[#F4F4F9] dark:bg-[#1C1C1C]" />
      <VnAurora
        accent={accent}
        height={metrics.height}
        glow={glow}
        playing={isPlaying}
        reduced={!!shouldReduceMotion}
      />

      <motion.button
        data-slot="voice-note-control"
        type="button"
        onClick={handleControl}
        disabled={blocked}
        aria-label={isPlaying ? "暂停语音消息" : "播放语音消息"}
        whileTap={shouldReduceMotion || blocked ? undefined : { scale: 0.9 }}
        transition={shouldReduceMotion ? VN_INSTANT : VN_TAP}
        style={{ width: control, height: control }}
        className="z-10 flex shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-white text-black outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#868593]"
      >
        <VnTransportIcon
          playing={isPlaying}
          size={Math.round(control * VN_ICON_RATIO)}
          reduced={!!shouldReduceMotion}
        />
      </motion.button>

      <div
        ref={trackRef}
        data-slot="voice-note-track"
        {...slider}
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => scrubbing.current && scrub(event)}
        onPointerUp={() => (scrubbing.current = false)}
        onPointerCancel={() => (scrubbing.current = false)}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative h-full flex-1 touch-none rounded-sm outline-none transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#868593]",
          seekable && !blocked && "cursor-pointer",
          blocked && "opacity-40",
        )}
      >
        <VnBars
          amplitudes={amplitudes}
          metrics={metrics}
          className="bg-black/30 dark:bg-white/40"
        />
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{ clipPath }}
        >
          <VnBars
            amplitudes={amplitudes}
            metrics={metrics}
            className="bg-black dark:bg-white"
          />
        </motion.div>
      </div>

      <VnTimeLabel
        speed={speed}
        text={metrics.text}
        onCycle={speeds.length > 1 ? cycleSpeed : undefined}
      >
        {vnFormatTime(remaining)}
      </VnTimeLabel>

      {src && (
        <audio
          ref={audioRef}
          className="hidden"
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration;
            setMetaDuration(Number.isFinite(value) ? value : duration);
          }}
          onError={() => setFailed(true)}
          // a file can stop just short of its own duration, so the frame loop may never reach the end
          onEnded={reset}
        />
      )}
    </div>
  );
}

function VnAurora({ accent, height, glow, playing, reduced }: {
  accent: string;
  height: number;
  glow: number;
  playing: boolean;
  reduced: boolean;
}) {
  // lap time, advanced only while the clip runs, so pausing leaves every light where it is
  const clock = useRef(VN_START_AT);
  const rate = useRef(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const nodes = useRef<(HTMLSpanElement | null)[]>([]);
  const width = useRef(0);

  const place = useCallback(
    (t: number) => {
      if (width.current === 0) return;
      const perimeter =
        2 * Math.max(0, width.current - height) + Math.PI * height;

      VN_BLOBS.forEach((blob, i) => {
        const node = nodes.current[i];
        if (!node) return;
        const travelled = blob.offset + t / blob.lap;
        const [x, y] = vnPointOnPill(
          travelled * perimeter,
          width.current,
          height,
        );
        const phase = blob.offset * Math.PI * 2;
        const scale = 1 + Math.sin(t * VN_PULSE_SPEED + phase) * blob.pulse;
        node.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      });
    },
    [height],
  );

  useEffect(() => {
    const node = fieldRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      width.current = entry.contentRect.width;
      // place them at once, so a resize or a reduced motion viewer never sees them stacked
      place(clock.current);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [place]);

  useEffect(() => {
    if (reduced) return;

    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      // a long frame gap, from a background tab, must not throw the lights across the bar
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;

      const target = playing ? 1 : 0;
      rate.current +=
        (target - rate.current) * (1 - Math.exp(-delta / VN_SPIN_UP));
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
    <div
      data-slot="voice-note-glow"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-full mix-blend-multiply dark:mix-blend-screen"
    >
      <motion.div
        ref={fieldRef}
        aria-hidden
        className="absolute inset-0"
        style={{
          filter: `blur(${height * VN_BLUR_RATIO}px)`,
          maskImage: VN_MIDDLE_MASK,
          WebkitMaskImage: VN_MIDDLE_MASK,
        }}
        // without this the field paints at full strength for a frame before the first animation
        initial={false}
        animate={{ opacity: glow }}
        transition={reduced ? VN_INSTANT : VN_GLOW}
      >
        <span
          className="absolute inset-0"
          style={{
            background: `radial-gradient(70% 170% at 8% 115%, ${accent} 0%, transparent 62%), radial-gradient(55% 150% at 40% 130%, ${accent} 0%, transparent 58%)`,
          }}
        />
        {VN_BLOBS.map((blob, i) => (
          <span
            key={i}
            ref={(node) => {
              nodes.current[i] = node;
            }}
            className="absolute left-0 top-0 rounded-full"
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
      </motion.div>
    </div>
  );
}

function VnTransportIcon({ playing, size, reduced }: {
  playing: boolean;
  size: number;
  reduced: boolean;
}) {
  const shape = useMotionValue(playing ? VN_PAUSE_PATH : VN_PLAY_PATH);
  const previous = useRef(playing);

  useEffect(() => {
    if (previous.current === playing) return;
    previous.current = playing;
    shape.set(playing ? VN_PAUSE_PATH : VN_PLAY_PATH);
    if (reduced) return;

    const from = playing ? VN_PLAY_SHAPE : VN_PAUSE_SHAPE;
    const to = playing ? VN_PAUSE_SHAPE : VN_PLAY_SHAPE;
    const controls = animate(0, 1, {
      ...VN_ICON,
      onUpdate: (t) => shape.set(vnMorph(from, to, vnClamp(t))),
      // the spring can overshoot, so land on the exact path
      onComplete: () => shape.set(playing ? VN_PAUSE_PATH : VN_PLAY_PATH),
    });
    return () => controls.stop();
  }, [playing, reduced, shape]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
    >
      <motion.path d={shape} {...VN_ICON_PAINT} />
    </svg>
  );
}

function VnTimeLabel({ speed, text, onCycle, children }: {
  speed: number;
  text: string;
  onCycle?: () => void;
  children: ReactNode;
}) {
  const className = cn(
    "flex shrink-0 items-center gap-1 font-semibold tabular-nums text-[#868593]",
    text,
  );

  if (!onCycle) {
    return (
      <span data-slot="voice-note-time" className={className}>
        {children}
      </span>
    );
  }

  return (
    <button
      data-slot="voice-note-time"
      type="button"
      onClick={onCycle}
      aria-label={`播放速度 ${speed} 倍，点按切换`}
      className={cn(
        className,
        "cursor-pointer rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#868593]",
      )}
    >
      {children}
      {speed !== 1 && (
        <span className="rounded-full bg-black/10 px-1 py-px text-[0.85em] leading-none text-black/70 dark:bg-white/15 dark:text-white/80">
          {speed}×
        </span>
      )}
    </button>
  );
}

const VnBars = memo(function VnBars({
  amplitudes,
  metrics,
  className,
}: {
  amplitudes: number[];
  metrics: (typeof VN_SIZES)[keyof typeof VN_SIZES];
  className: string;
}) {
  return (
    <div
      className="flex h-full w-full items-center"
      style={{ gap: metrics.barGap }}
    >
      {amplitudes.map((amplitude, i) => (
        <span
          key={i}
          className={cn("flex-1 rounded-full", className)}
          style={{
            minWidth: metrics.bar,
            height: `${(amplitude * VN_PEAK_RATIO * 100).toFixed(2)}%`,
          }}
        />
      ))}
    </div>
  );
});
