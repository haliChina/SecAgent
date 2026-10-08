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
import { AnimatePresence, animate, motion, useMotionTemplate, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue, type Transition } from "motion/react";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import { AlertCircleIcon, Loader2Icon, RotateCwIcon, ArrowUpIcon, XIcon, RefreshCwIcon, UserIcon, WrenchIcon, BotIcon, MousePointer2Icon, MicIcon, ArrowLeftIcon, DownloadIcon, RocketIcon, SettingsIcon, PaintbrushIcon, TypeIcon, LayersIcon, BellIcon, ShieldIcon, CopyIcon, CheckIcon, ThumbsUpIcon, ThumbsDownIcon, EllipsisIcon, SquareIcon, ArrowRightIcon, CircleAlertIcon } from "lucide-react";

/** rare-ui 的 cn 为 twMerge(clsx(...))；本项目无 Tailwind 类冲突合并需求，clsx 等价 */
const cn = clsx;

/* ------------------------------------------------------------------ */
/* ScrollProgress (rareui scrollprogress) — 底部进度 pill + 节列表       */
/* 逐行直译自 swamimalode07/rare-ui components/ui/scroll-progress.tsx。  */
/* 环境适配仅两处：NodeNext/ES2022 无 Array.findLast（倒序循环等价）；   */
/* 底部偏移由 App 侧 className 以 Tailwind important 后缀覆盖。          */
/* ------------------------------------------------------------------ */
export type ScrollProgressSection = { id: string; label: string };

const SP_EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;
const SP_EASE_OUT = [0.22, 1, 0.36, 1] as const;
const SP_SIZE_SPRING = { type: "spring", bounce: 0.16, duration: 0.5 } as const;
const SP_LABEL_CROSSFADE = { duration: 0.22, ease: SP_EASE_OUT } as const;
const SP_LAYER_FADE = { duration: 0.24, ease: SP_EASE_IN_OUT } as const;

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type SpSize = { width: number; height: number };

export type ScrollProgressProps = ComponentProps<"div"> & {
  sections?: ScrollProgressSection[];
  containerRef?: RefObject<HTMLElement | null>;
  offset?: number;
};

export function ScrollProgress({ className, sections = [], containerRef, offset = 120, ...props }: ScrollProgressProps) {
  const layoutId = useId();
  const reduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll(
    containerRef ? { container: containerRef } : undefined
  );
  const progress = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.3,
  });

  const [activeId, setActiveId] = useState(sections[0]?.id)
  const [open, setOpen] = useState(false)

  const scrollLock = useRef(false)
  const scrollLockTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const scroller = containerRef?.current ?? window

    const update = () => {
      if (scrollLock.current) return
      const anchor =
        (containerRef?.current?.getBoundingClientRect().top ?? 0) + offset
      // ES2022 目标无 Array.prototype.findLast：倒序循环等价（取最后一个满足项）
      let active: ScrollProgressSection | undefined
      for (let i = sections.length - 1; i >= 0; i -= 1) {
        const top = document.getElementById(sections[i]!.id)?.getBoundingClientRect().top
        if (top !== undefined && top <= anchor) {
          active = sections[i]
          break
        }
      }
      setActiveId(active?.id ?? sections[0]?.id)
    }

    update()
    scroller.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      scroller.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [sections, containerRef, offset])

  const label = sections.find((s) => s.id === activeId)?.label

  const labelVersion = useRef(0)
  const prevLabel = useRef(label)
  if (label !== prevLabel.current) {
    prevLabel.current = label
    labelVersion.current += 1
  }

  const collapsedRef = useRef<HTMLDivElement>(null)
  const openRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const [collapsedSize, setCollapsedSize] = useState<SpSize>()
  const [openSize, setOpenSize] = useState<SpSize>()
  const [labelWidth, setLabelWidth] = useState<number>()

  useIsoLayoutEffect(() => {
    const measure = () => {
      if (labelRef.current) setLabelWidth(labelRef.current.offsetWidth)
      if (collapsedRef.current) {
        setCollapsedSize({
          width: collapsedRef.current.offsetWidth,
          height: collapsedRef.current.offsetHeight,
        })
      }
      if (openRef.current) {
        setOpenSize({
          width: openRef.current.offsetWidth,
          height: openRef.current.offsetHeight,
        })
      }
    }

    measure()
    const ro = new ResizeObserver(measure)
    if (labelRef.current) ro.observe(labelRef.current)
    if (collapsedRef.current) ro.observe(collapsedRef.current)
    if (openRef.current) ro.observe(openRef.current)
    void document.fonts?.ready.then(measure).catch(() => undefined)
    return () => ro.disconnect()
  }, [sections])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  useEffect(() => () => clearTimeout(scrollLockTimer.current), [])

  const selectSection = (id: string): void => {
    scrollLock.current = true
    clearTimeout(scrollLockTimer.current)
    scrollLockTimer.current = setTimeout(() => {
      scrollLock.current = false
    }, reduceMotion ? 0 : 700)
    setActiveId(id)
    setOpen(false)
    document.getElementById(id)?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    })
  }

  const size = open ? openSize : collapsedSize
  const radius = open ? 26 : (collapsedSize?.height ?? 32) / 2
  const squircle = "[corner-shape:squircle]"

  return (
    <div
      ref={rootRef}
      data-slot="scroll-progress"
      className={cn("fixed bottom-6 left-1/2 z-50 -translate-x-1/2", className)}
      {...props}
    >
      <div className="pointer-events-none invisible absolute" aria-hidden={true}>
        <div
          ref={collapsedRef}
          className="inline-flex items-center gap-2.5 py-1.5 pl-2 pr-4"
        >
          <span className="h-5 w-5" />
          <span
            ref={labelRef}
            className="whitespace-nowrap text-sm font-medium leading-none"
          >
            {label}
          </span>
        </div>
        <div ref={openRef} className="w-max p-1.5">
          {sections.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium leading-none"
            >
              <span className="h-1.5 w-1.5" />
              <span className="whitespace-nowrap">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {size && (
        <motion.div
          data-slot="scroll-progress-surface"
          className={cn(
            "absolute bottom-0 left-1/2 -translate-x-1/2 overflow-hidden border border-border/60 bg-background/70 shadow-lg backdrop-blur-md",
            squircle,
          )}
          initial={false}
          animate={{
            width: size.width,
            height: size.height,
            borderRadius: radius,
          }}
          transition={reduceMotion ? { duration: 0 } : SP_SIZE_SPRING}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {open ? (
              <motion.ul
                key="list"
                className="absolute inset-0 flex flex-col p-1.5"
                initial={{
                  opacity: 0,
                  filter: reduceMotion ? undefined : "blur(4px)",
                }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{
                  opacity: 0,
                  filter: reduceMotion ? undefined : "blur(4px)",
                }}
                transition={SP_LAYER_FADE}
              >
                {sections.map((s, i) => {
                  const isActive = s.id === activeId
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => selectSection(s.id)}
                        className={cn(
                          "relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-sm font-medium leading-none transition-colors",
                          squircle,
                          isActive
                            ? "text-foreground"
                            : "text-foreground/55 hover:text-foreground/80"
                        )}
                      >
                        {isActive && (
                          <motion.span
                            layoutId={`${layoutId}-active`}
                            className={cn(
                              "absolute inset-0 rounded-[14px] bg-foreground/10",
                              squircle
                            )}
                            transition={
                              reduceMotion ? { duration: 0 } : SP_SIZE_SPRING
                            }
                          />
                        )}
                        <motion.span
                          className={cn(
                            "relative h-1.5 w-1.5 shrink-0 rounded-full",
                            isActive ? "bg-foreground" : "bg-foreground/30"
                          )}
                          initial={
                            reduceMotion
                              ? undefined
                              : { opacity: 0, y: 4, filter: "blur(3px)" }
                          }
                          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                          transition={{
                            duration: 0.3,
                            ease: SP_EASE_IN_OUT,
                            delay: reduceMotion ? 0 : 0.04 + i * 0.03,
                          }}
                        />
                        <motion.span
                          className="relative whitespace-nowrap"
                          initial={
                            reduceMotion
                              ? undefined
                              : { opacity: 0, y: 4, filter: "blur(3px)" }
                          }
                          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                          transition={{
                            duration: 0.3,
                            ease: SP_EASE_IN_OUT,
                            delay: reduceMotion ? 0 : 0.04 + i * 0.03,
                          }}
                        >
                          {s.label}
                        </motion.span>
                      </button>
                    </li>
                  )
                })}
              </motion.ul>
            ) : (
              <motion.button
                key="pill"
                type="button"
                onClick={() => { if (sections.length > 1) setOpen(true); }}
                aria-label="显示章节列表"
                className="absolute inset-0 flex items-center gap-2.5 py-1.5 pl-2 pr-4"
                initial={{
                  opacity: 0,
                  filter: reduceMotion ? undefined : "blur(4px)",
                }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{
                  opacity: 0,
                  filter: reduceMotion ? undefined : "blur(4px)",
                }}
                transition={SP_LAYER_FADE}
              >
                <span className="shrink-0">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90" aria-hidden={true}>
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      fill="none"
                      strokeWidth="2.5"
                      className="stroke-foreground/15"
                    />
                    <motion.circle
                      cx="12"
                      cy="12"
                      r="10"
                      fill="none"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      className="stroke-foreground"
                      style={{ pathLength: progress }}
                    />
                  </svg>
                </span>

                <span
                  className="relative h-5 shrink-0"
                  style={{ width: labelWidth }}
                >
                  <AnimatePresence initial={false}>
                    {label && (
                      <motion.span
                        key={labelVersion.current}
                        data-slot="scroll-progress-label"
                        className="absolute inset-y-0 left-0 flex items-center whitespace-nowrap text-sm font-medium leading-none text-foreground"
                        initial={{
                          opacity: 0,
                          filter: reduceMotion ? undefined : "blur(1.5px)",
                        }}
                        animate={{ opacity: 1, filter: "blur(0px)" }}
                        exit={{
                          opacity: 0,
                          filter: reduceMotion ? undefined : "blur(1.5px)",
                        }}
                        transition={SP_LABEL_CROSSFADE}
                      >
                        {label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        </motion.div>
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

/* ------------------------------------------------------------------ */
/* AuroraBackdrop (reactbits Aurora · lightMode 移植) — 空状态极光衬底  */
/* ------------------------------------------------------------------ */
/**
 * 深底极光（Canvas 2D 零依赖移植，配色从 accent 蓝 #2563EB 派生）：四个漂移的低
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
      { rgb: "37, 99, 235", scale: 0.55, speed: 1 / 26000, phase: 0, y: 0.4 },
      { rgb: "96, 165, 250", scale: 0.42, speed: 1 / 19000, phase: 2.1, y: 0.28 },
      { rgb: "147, 197, 253", scale: 0.36, speed: 1 / 33000, phase: 4.4, y: 0.5 },
      { rgb: "59, 130, 246", scale: 0.3, speed: 1 / 22000, phase: 5.6, y: 0.34 }
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
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, cssWidth, cssHeight);
      }
      ctx.globalCompositeOperation = "source-over";
      // 浅色版：整幅渐隐到页面底色 --bg-0 (#FFFFFF)
      const fade = ctx.createLinearGradient(0, 0, 0, cssHeight);
      fade.addColorStop(0, "rgba(255,255,255,0)");
      fade.addColorStop(0.55, "rgba(255,255,255,.45)");
      fade.addColorStop(1, "rgba(255,255,255,1)");
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
/* DeleteButton (rareui deletebutton) — 展开式两钮确认删除               */
/* 逐行直译自 swamimalode07/rare-ui components/ui/delete-button.tsx：    */
/* 48px 垃圾桶（桶壁 motion 模板插值、盖 -35° spring LID）展开 84px 凹槽 */
/* 面板；✓ 描画 pathLength / × 圆钮 whileTap PRESS 弹簧；kept 回弹 nudge。 */
/* 适配：sr-only/aria-label 中文化；ariaLabel prop 供会话列表命名。       */
/* ------------------------------------------------------------------ */
const DB_HINGE = "3px 6px";
const DB_LID_OPEN = -35;
const DB_WALL_TOP = 6;
const DB_WALL_TOP_OPEN = 13.5;
const DB_WALL_BASE = 20;

const DB_TILE = 48;
const DB_PANEL = 84;
const DB_HOLD = { deleted: 1400, kept: 600 } as const;

const DB_EASE = [0.32, 0.72, 0, 1] as const;
const DB_EASE_LID = [0.34, 1.1, 0.64, 1] as const;

const DB_WIDTH = { duration: 0.62, ease: DB_EASE } as const;
const DB_LID = { duration: 0.6, ease: DB_EASE_LID } as const;
const DB_WALL = { duration: 0.56, ease: DB_EASE } as const;
const DB_IN = { duration: 0.44, ease: DB_EASE, delay: 0.14 } as const;
const DB_OUT = { duration: 0.3, ease: DB_EASE } as const;
const DB_TAP = { duration: 0.2, ease: DB_EASE } as const;
const DB_SWAP = { duration: 0.22, ease: DB_EASE } as const;
const DB_SETTLE = { duration: 0.45, ease: DB_EASE } as const;
const DB_PRESS = {
  type: "spring",
  stiffness: 520,
  damping: 18,
  mass: 0.5,
} as const;
const DB_INSTANT = { duration: 0 } as const;

const DB_SURFACE = "bg-[#F4F4F9] dark:bg-[#262626]";
const DB_RECESS = "bg-[#E7E7EF] dark:bg-[#1B1B1B]";
const DB_GLYPH = "text-[#868593] dark:text-[#9B9AA7]";
const DB_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[#868593]";
const DB_ACCENT = "#FF5F2E";

const DB_LIFT =
  "shadow-[0_0.5px_1px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.08),inset_0_0.5px_0_rgba(255,255,255,0.9)] dark:shadow-[0_0.5px_1px_rgba(0,0,0,0.35),0_1.5px_4px_rgba(0,0,0,0.3),inset_0_0.5px_0_rgba(255,255,255,0.05)]";

const DB_CIRCLE = `grid h-7 w-7 place-items-center rounded-full transition-colors duration-200 hover:bg-[#FAFAFD] dark:hover:bg-[#2C2C2C] ${DB_FOCUS} ${DB_SURFACE} ${DB_LIFT}`;

const DB_ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const dbPanelMotion = {
  hidden: { opacity: 0, x: -6, transition: DB_OUT },
  shown: { opacity: 1, x: 0, transition: { ...DB_IN, staggerChildren: 0.07 } },
};

const dbCircleMotion = {
  hidden: { opacity: 0, scale: 0.9, transition: DB_OUT },
  shown: { opacity: 1, scale: 1, transition: DB_IN },
};

function DbCircle({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;

  return (
    <motion.div className="flex" variants={reduced ? undefined : dbCircleMotion}>
      <motion.button
        type="button"
        aria-label={label}
        onClick={onClick}
        whileHover={reduced ? undefined : { scale: 1.03 }}
        whileTap={reduced ? undefined : { scale: 0.84 }}
        transition={DB_PRESS}
        className={DB_CIRCLE}
      >
        <svg
          {...DB_ICON}
          width="14"
          height="14"
          stroke="currentColor"
          strokeWidth="3.5"
        >
          {children}
        </svg>
      </motion.button>
    </motion.div>
  );
}

type DbStatus = "idle" | "deleted" | "kept";

export type DeleteButtonProps = Omit<
  ComponentProps<"div">,
  "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
> & {
  onConfirm?: () => void;
  onCancel?: () => void;
  /** 应用适配：覆盖默认 aria-label（会话列表传入「删除会话 xxx」） */
  ariaLabel?: string;
};

export function DeleteButton({ onConfirm, onCancel, ariaLabel, className, ...props }: DeleteButtonProps) {
  const reduced = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<DbStatus>("idle");
  const trigger = useRef<HTMLButtonElement>(null);
  const timing = (transition: Transition) => (reduced ? DB_INSTANT : transition);

  const top = useMotionValue(DB_WALL_TOP);
  const wall = useTransform(top, (y) => DB_WALL_BASE - y);
  const bin = useMotionTemplate`M19 ${top}v${wall}a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V${top}`;
  const settle = useMotionValue(1);

  useEffect(() => {
    const walls = animate(
      top,
      open ? DB_WALL_TOP_OPEN : DB_WALL_TOP,
      reduced ? DB_INSTANT : DB_WALL,
    );
    return () => walls.stop();
  }, [open, reduced, top]);

  useEffect(() => {
    if (status === "idle") return;
    const nudge =
      status === "kept" && !reduced
        ? animate(settle, [1, 0.86, 1], DB_SETTLE)
        : null;
    const done = setTimeout(() => setStatus("idle"), DB_HOLD[status]);
    return () => {
      nudge?.stop();
      clearTimeout(done);
    };
  }, [status, reduced, settle]);

  const resolve = (next: Exclude<DbStatus, "idle">) => {
    setOpen(false);
    setStatus(next);
    trigger.current?.focus();
    (next === "deleted" ? onConfirm : onCancel)?.();
  };

  return (
    <motion.div
      data-slot="delete-button"
      data-state={open ? "open" : "closed"}
      data-status={status}
      className={cn("relative h-12 rounded-2xl", DB_SURFACE, DB_GLYPH, className)}
      animate={{ width: open ? DB_TILE + DB_PANEL : DB_TILE }}
      transition={timing(DB_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) resolve("kept");
      }}
      {...props}
    >
      <motion.button
        ref={trigger}
        type="button"
        aria-label={ariaLabel ?? "删除"}
        aria-expanded={open}
        onClick={() => {
          if (open) return resolve("kept");
          setStatus("idle");
          setOpen(true);
        }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={DB_TAP}
        className={cn(
          "relative z-10 grid h-12 w-12 place-items-center rounded-2xl",
          DB_FOCUS,
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {status === "deleted" ? (
            <motion.svg
              key="done"
              {...DB_ICON}
              width="20"
              height="20"
              stroke={DB_ACCENT}
              strokeWidth="2.5"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={timing(DB_SWAP)}
            >
              <motion.path
                d="M4 12.5 9.5 18 20 7"
                initial={reduced ? undefined : { pathLength: 0 }}
                animate={reduced ? undefined : { pathLength: 1 }}
                transition={DB_SETTLE}
              />
            </motion.svg>
          ) : (
            <motion.svg
              key="bin"
              {...DB_ICON}
              width="20"
              height="20"
              stroke="currentColor"
              strokeWidth="2"
              className="overflow-visible"
              style={{ scale: settle }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={timing(DB_SWAP)}
            >
              <motion.path d={bin} />
              <motion.g
                style={{ transformBox: "view-box", transformOrigin: DB_HINGE }}
                animate={{ rotate: open ? DB_LID_OPEN : 0 }}
                transition={timing(DB_LID)}
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </motion.g>
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.button>

      <span role="status" aria-live="polite" className="sr-only">
        {status === "deleted" ? "已删除" : status === "kept" ? "已保留" : ""}
      </span>

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            style={{ width: DB_PANEL }}
            className={cn(
              "absolute inset-y-0 right-0 flex items-center justify-center gap-2 rounded-2xl",
              DB_RECESS,
            )}
            variants={reduced ? undefined : dbPanelMotion}
            initial="hidden"
            animate="shown"
            exit="hidden"
          >
            <span
              aria-hidden
              className={cn(
                "absolute -left-1.25 top-1/2 z-20 h-2.5 w-1.5 -translate-y-1/2 [clip-path:polygon(100%_0,0_50%,100%_100%)]",
                DB_RECESS,
              )}
            />
            <DbCircle label="确认删除" onClick={() => resolve("deleted")}>
              <path d="M4 12.5 9.5 18 20 7" stroke={DB_ACCENT} />
            </DbCircle>
            <DbCircle label="取消" onClick={() => resolve("kept")}>
              <path d="M6 6 18 18M18 6 6 18" />
            </DbCircle>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
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
/* AnimatedCounter (rareui animatedcounter) — 逐位滚轮数字动画           */
/* 逐行直译自 swamimalode07/rare-ui components/ui/animated-counter.tsx。 */
/* 每位 0-9 纵向滚轮（尾 0 环绕）、方向感知、1.5em 渐隐遮罩、popLayout  */
/* 进位整组横移（motion layout 动画，shifts/layoutDependency）。         */
/* ------------------------------------------------------------------ */
const AC_FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// the trailing 0 makes the wrap from 9 back to 0 land on an identical face
const AC_WHEEL = [...AC_FACES, 0];

// the air around each face is what the mask fades through, so a resting digit stays solid
const AC_LINE = 1.5;
// eased rather than a straight ramp; a linear fade of the same width reads as a hard edge
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

const AC_EASE = [0.22, 1, 0.36, 1] as const;
const AC_BOUNCE = 0.18;
const AC_LEAVE = { duration: 0.18, ease: AC_EASE } as const;
const AC_INSTANT = { duration: 0 } as const;

const acSpring = (duration: number): Transition => ({
  type: "spring",
  visualDuration: duration,
  bounce: AC_BOUNCE,
});

const AC_MAX_DECIMALS = 15;
const AC_MAX_PAD = 24;
const AC_MIN_DURATION = 0.01;
const AC_MAX_DURATION = 60;

const acMod = (n: number, m: number) => ((n % m) + m) % m;
const acClamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Number.isFinite(n) ? n : low));
const acIsDigit = (char: string) => char >= "0" && char <= "9";

// built once so React skips reconciling 21 spans per digit on every change
const AC_SIZER = AC_FACES.map((face) => (
  <span key={face} aria-hidden className="invisible [grid-area:1/1]">
    {face}
  </span>
));

const AC_STACK = AC_WHEEL.map((face, index) => (
  <span
    key={index}
    className="flex items-center justify-center"
    style={{ height: `${AC_LINE}em` }}
  >
    {face}
  </span>
));

export type CounterGrouping = "western" | "indian";

const AC_EVERY_THREE = /\B(?=(\d{3})+(?!\d))/g;
const AC_EVERY_TWO = /\B(?=(\d{2})+(?!\d))/g;

function acGroup(whole: string, separator: string, grouping: CounterGrouping) {
  if (!separator) return whole;
  if (grouping !== "indian") return whole.replace(AC_EVERY_THREE, separator);
  const head = whole.slice(0, -3);
  if (!head) return whole;
  return `${head.replace(AC_EVERY_TWO, separator)}${separator}${whole.slice(-3)}`;
}

type AcShape = {
  amount: number;
  scaled: number;
  places: number;
  pace: number;
  width: number;
};

function acMeasure(
  value: number,
  decimals: number,
  padStart: number,
  duration: number,
): AcShape {
  // NaN would make the previous-value comparison true forever
  const amount = Number.isFinite(value) ? value : 0;
  const places = acClamp(Math.trunc(decimals), 0, AC_MAX_DECIMALS);
  const pad = acClamp(Math.trunc(padStart), 1, AC_MAX_PAD);
  // past MAX_SAFE_INTEGER the digits are noise, and past 1e21 String() turns exponential
  const scaled = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.round(Math.abs(amount) * 10 ** places),
  );

  return {
    amount,
    scaled,
    places,
    pace: acClamp(duration, AC_MIN_DURATION, AC_MAX_DURATION),
    width: Math.max(String(scaled).length, places + pad),
  };
}

function acFormat({ scaled, places, width }: AcShape, separator: string, decimalSeparator: string, grouping: CounterGrouping) {
  const raw = String(scaled).padStart(width, "0");
  const whole = acGroup(raw.slice(0, raw.length - places) || "0", separator, grouping);
  return places
    ? `${whole}${decimalSeparator}${raw.slice(raw.length - places)}`
    : whole;
}

// keyed by distance from the right, so gaining a place moves columns rather than remounting them
type AcCell =
  | { kind: "digit"; key: number; digit: number }
  | { kind: "mark"; key: string; char: string };

function acToCells(chars: string, width: number): AcCell[] {
  const cells: AcCell[] = [];
  let seen = 0;
  // only digits advance the place, so a multi-character separator would repeat a key
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

// 应用适配（非原版行为）：每位最短路径——上升距离 ≤5 面向上滚，否则向下滚
function acNearestGoal(at: number, digit: number): number {
  const up = acMod(digit - at, 10);
  return up <= 5 ? at + up : at + up - 10;
}

function useAcWheel(
  from: number,
  digit: number,
  dir: number,
  duration: number,
  reduced: boolean,
  odometer: boolean,
) {
  const pos = useMotionValue(from);
  const goal = useRef(from);

  // read rather than depended on: a reversal alone must not restart every column
  const heading = useRef(dir);
  useEffect(() => {
    heading.current = dir;
  }, [dir]);

  useEffect(() => {
    if (reduced) {
      goal.current = digit;
      pos.set(digit);
      return;
    }
    // re-aim only when the face changed, or a reversal sends the wheel the long way round
    if (acMod(goal.current, 10) !== digit) {
      // aim from where the wheel is, so a moving value never queues up a backlog of turns
      const at = pos.get();
      goal.current = !odometer
        ? acNearestGoal(at, digit)
        : heading.current < 0
          ? at - acMod(at - digit, 10)
          : at + acMod(digit - at, 10);
    }
    const roll = animate(pos, goal.current, acSpring(duration));
    return () => roll.stop();
  }, [digit, duration, reduced, pos, odometer]);

  return useTransform(pos, (p) => `${(-acMod(p, 10) * 100) / AC_WHEEL.length}%`);
}

type AcSlotProps = {
  reduced: boolean;
  dep: number;
  shift: Transition;
};

const acShifts = ({ reduced, dep, shift }: AcSlotProps) => ({
  layout: !reduced,
  layoutDependency: dep,
  transition: shift,
});

const acFades = (reduced: boolean) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: reduced ? AC_INSTANT : AC_LEAVE },
});

function AcFixed({ children, ...slot }: AcSlotProps & { children: ReactNode }) {
  return (
    <motion.span {...acShifts(slot)} className="inline-block">
      {children}
    </motion.span>
  );
}

function AcMark({ char, ...slot }: AcSlotProps & { char: string }) {
  return (
    <motion.span
      data-slot="animated-counter-mark"
      {...acShifts(slot)}
      {...acFades(slot.reduced)}
      className="inline-block"
    >
      {char}
    </motion.span>
  );
}

const AcDigit = memo(function AcDigit({
  digit,
  from,
  dir,
  duration,
  odometer,
  ...slot
}: AcSlotProps & {
  digit: number;
  from: number;
  dir: number;
  duration: number;
  odometer: boolean;
}) {
  const y = useAcWheel(from, digit, dir, duration, slot.reduced, odometer);

  return (
    <motion.span
      data-slot="animated-counter-digit"
      {...acShifts(slot)}
      className="relative inline-grid overflow-hidden"
      style={{
        height: `${AC_LINE}em`,
        lineHeight: AC_LINE,
        maskImage: AC_FADE,
        WebkitMaskImage: AC_FADE,
      }}
    >
      {/* widest-face width, for fonts with no tabular figures */}
      {AC_SIZER}
      <motion.span style={{ y }} className="absolute inset-x-0 top-0">
        {AC_STACK}
      </motion.span>
    </motion.span>
  );
});

export type AnimatedCounterProps = Omit<
  ComponentProps<"span">,
  "children" | "prefix" | "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
> & {
  value: number;
  decimals?: number;
  duration?: number;
  padStart?: number;
  separator?: string;
  decimalSeparator?: string;
  grouping?: CounterGrouping;
  /** 滚动方向语义：true（默认）= 原版里程表——值降时所有位统一向下滚（反向位绕远路）；
   *  false = 每位最短路径（更符合直觉）。 */
  odometer?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export function AnimatedCounter({
  value,
  decimals = 0,
  duration = 0.6,
  padStart = 1,
  separator = ",",
  decimalSeparator = ".",
  grouping = "western",
  odometer = true,
  prefix,
  suffix,
  className,
  style,
  ...props
}: AnimatedCounterProps) {
  const reduced = useReducedMotion() ?? false;

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

  // faces at mount; a place that appears later starts from 0 and rolls in
  const [seed] = useState(() => {
    const faces: Record<number, number> = {};
    for (const cell of cells) {
      if (cell.kind === "digit") faces[cell.key] = cell.digit;
    }
    return faces;
  });

  const shift = useMemo<Transition>(
    () => (reduced ? AC_INSTANT : acSpring(shape.pace)),
    [reduced, shape.pace],
  );

  const slot: AcSlotProps = { reduced, dep: chars.length, shift };

  return (
    <span
      data-slot="animated-counter"
      className={cn("inline-flex items-center tabular-nums", className)}
      aria-live="off"
      {...props}
      style={style}
    >
      {/* the whole number stays available to screen readers and find-in-page */}
      <span className="sr-only">{chars}</span>

      {prefix != null && <AcFixed {...slot}>{prefix}</AcFixed>}
      <span aria-hidden className="inline-flex select-none items-center">
        {negative && <AcFixed {...slot}>-</AcFixed>}
        <AnimatePresence mode="popLayout" initial={false}>
          {cells.map((cell) =>
            cell.kind === "digit" ? (
              <AcDigit
                key={cell.key}
                {...slot}
                digit={cell.digit}
                from={seed[cell.key] ?? 0}
                dir={dir}
                duration={shape.pace}
                odometer={odometer}
              />
            ) : (
              <AcMark key={cell.key} {...slot} char={cell.char} />
            ),
          )}
        </AnimatePresence>
      </span>

      {suffix != null && <AcFixed {...slot}>{suffix}</AcFixed>}
    </span>
  );
}


/* ------------------------------------------------------------------ */
/* HookSidebar (rareui hooksidebar) — 钩式侧导航                          */
/* 逐行直译自 swamimalode07/rare-ui components/ui/hook-sidebar.tsx：    */
/* 1px 虚线（repeating-gradient）+ 12×7 SVG 圆弧钩，双轨（灰 hover /     */
/* 彩 active）均 spring 420/34/0.7 驱动 top/height。                    */
/* 适配：无 next 路由（去掉 usePathname/Link 分支，仅受控 value 模式）； */
/* 保留应用侧 items[{id,label,dividerBefore}] 签名 + 设置页分隔线注入。   */
/* ------------------------------------------------------------------ */
const HK_CORNER = 6;
const HK_DASH =
  "repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)";

function HookRail({ from = 0, y, visible, color, dashed, className }: {
  from?: number;
  y: number | null;
  visible: boolean;
  color?: string;
  dashed: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const travel = reduced
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 };

  return (
    <motion.span
      aria-hidden
      initial={false}
      style={{ color }}
      animate={{ opacity: visible && y !== null ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.2 }}
      className={cn("pointer-events-none absolute inset-0", className)}
    >
      <motion.span
        initial={false}
        animate={{ top: from, height: Math.max(0, (y ?? 0) - HK_CORNER - from) }}
        transition={travel}
        style={
          dashed
            ? { backgroundImage: HK_DASH }
            : { backgroundColor: "currentColor" }
        }
        className="absolute left-0.5 w-px"
      />
      <motion.svg
        initial={false}
        animate={{ top: (y ?? 0) - HK_CORNER }}
        transition={travel}
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
        className="absolute left-0.5"
      >
        <path
          d="M0.5 0a6 6 0 0 0 6 6H12"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray={dashed ? "2 2" : undefined}
        />
      </motion.svg>
    </motion.span>
  );
}

export function HookSidebar({ activeId, items, onSelect }: {
  activeId: string;
  items: Array<{ id: string; label: string; dividerBefore?: boolean }>;
  onSelect: (id: string) => void;
}) {
  // 应用适配：active 轨颜色取主题 accent 蓝（原版默认 #FC4C01）
  const color = "#2563EB";
  const dashed = true;
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [centers, setCenters] = useState<number[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId));

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      setCenters(
        itemRefs.current
          .map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : null))
          .filter((c): c is number => c !== null),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [items.length]);

  const activeY = activeIndex < 0 ? null : (centers[activeIndex] ?? null);
  const hoverY = hoverIndex === null ? null : (centers[hoverIndex] ?? null);

  // above the active row the accent line already covers the span, so draw only the corner
  const hoverFrom =
    activeY !== null && hoverY !== null && hoverY <= activeY
      ? Math.max(0, hoverY - HK_CORNER)
      : (activeY ?? 0);

  const select = (index: number) => {
    onSelect(items[index]!.id);
  };

  return (
    <nav data-slot="hook-sidebar" aria-label="设置导航" className="settings-nav flex flex-col">
      <div
        ref={listRef}
        onMouseLeave={() => setPointerInside(false)}
        className="relative flex flex-col gap-0.5"
      >
        <HookRail
          from={hoverFrom}
          y={hoverY}
          visible={(pointerInside || focusInside) && hoverIndex !== activeIndex}
          dashed={dashed}
          className="text-foreground/30"
        />
        <HookRail
          y={activeY}
          visible={activeY !== null}
          color={color}
          dashed={dashed}
        />

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
                data-slot="hook-sidebar-item"
                data-active={isActive}
                ref={setRef}
                onMouseEnter={() => {
                  setHoverIndex(index);
                  setPointerInside(true);
                }}
                onFocus={() => {
                  setHoverIndex(index);
                  setFocusInside(true);
                }}
                onBlur={() => setFocusInside(false)}
                onClick={() => select(index)}
                className={cn(
                  "rounded-lg py-1.5 pl-5 pr-2 text-left text-sm transition-colors duration-200 motion-reduce:transition-none",
                  isActive
                    ? "text-foreground"
                    : "text-foreground/50 hover:text-foreground/80",
                )}
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

/* ------------------------------------------------------------------ */
/* assistant-ui 真源直译（packages/ui/.../elements/*.tsx @ assistant-ui） */
/* surfaces token 内联；animate-in 组合类以 aui-pop-* 本地动画等价替换。   */
/* ------------------------------------------------------------------ */

/* surfaces (assistant-ui elements/surfaces.tsx) */
const AUI_PAPER = "bg-background border border-border/60 dark:bg-popover";
const AUI_FLOATING = "bg-background border border-border/60 dark:bg-popover";
const AUI_FIELD = "bg-foreground/[0.04] dark:bg-foreground/[0.06]";
const AUI_GHOST =
  "flex items-center justify-center rounded-full text-muted-foreground outline-hidden transition-[background-color,color,scale] duration-150 hover:bg-foreground/[0.06] hover:text-foreground/90 active:scale-[0.96] focus-visible:ring-1 focus-visible:ring-foreground/20 motion-reduce:transition-none dark:hover:bg-foreground/[0.09]";
const AUI_MONO = "font-mono text-[11px] tracking-tight";
const AUI_ICON_SWAP = "[grid-area:1/1] transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none";
const AUI_ICON_SWAP_IN = "scale-100 opacity-100 blur-none";
const AUI_ICON_SWAP_OUT = "scale-[0.25] opacity-0 blur-[4px]";

/* range utils (assistant-ui elements/../utils/range.ts) — 内联 */
const auiAt = <T,>(list: readonly T[], index: number): T | undefined =>
  list.length === 0 ? undefined : list[Math.min(Math.max(index, 0), list.length - 1)];
const auiIndexIn = <T,>(list: readonly T[], index: number): number =>
  list.length === 0 ? -1 : Math.min(Math.max(index, 0), list.length - 1);

export function NumberTicker({
  value,
  label,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "value" | "label"> & {
  value: number;
  label: string;
}) {
  function RollingDigit({ digit }: { digit: number }) {
    return (
      <span className="inline-flex h-[1.15em] overflow-hidden">
        <span
          className="flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
          style={{ transform: `translateY(-${digit * 1.15}em)` }}
        >
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="h-[1.15em] leading-[1.15]">
              {i}
            </span>
          ))}
        </span>
      </span>
    );
  }
  const formatted = value.toLocaleString("en-US");
  return (
    <div
      data-slot="number-ticker"
      className={cn("flex flex-col items-center gap-2.5", className)}
      {...props}
    >
      <span
        className="flex text-3xl font-medium tracking-tight tabular-nums"
        aria-label={formatted}
      >
        {formatted.split("").map((char, i) =>
        /\d/.test(char) ? (
            <RollingDigit key={i} digit={Number(char)} />
          ) : (
            <span key={i} className="h-[1.15em] leading-[1.15]">
              {char}
            </span>
          ),
        )}
      </span>
      <span className={cn(AUI_MONO, "text-muted-foreground")}>{label}</span>
    </div>
  );
}

export function ToolError({
  name,
  target,
  message,
  attempt,
  maxAttempts,
  retrying,
  onRetry,
  onSkip,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "name" | "target" | "message" | "attempt" | "maxAttempts" | "retrying" | "onRetry" | "onSkip"
> & {
  name: string;
  // 应用适配：真源必填的 target/attempt 系列放宽为可选（工具活动里无对应数据）
  target?: string;
  message: string;
  attempt?: number;
  maxAttempts?: number;
  retrying?: boolean;
  onRetry?: () => void;
  onSkip?: () => void;
}) {
  return (
    <div
      data-slot="tool-error"
      className={cn(AUI_PAPER, "flex w-full max-w-sm flex-col gap-3 rounded-2xl p-3.5", className)}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <AlertCircleIcon className="size-3.5 shrink-0 text-red-500" />
        <span className={cn(AUI_MONO, "text-muted-foreground min-w-0 wrap-anywhere")}>{name}</span>
        <span className="text-foreground/80 min-w-0 flex-1 truncate text-[13px]">{target}</span>
        <span className={cn(AUI_MONO, "text-muted-foreground shrink-0 tabular-nums")}>
          {attempt}/{maxAttempts}
        </span>
      </div>
      <div
        className={cn(
          AUI_FIELD,
          "rounded-xl px-3 py-2 font-mono text-[11px] leading-relaxed break-words text-red-700 dark:text-red-300",
        )}
      >
        {message}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={!onSkip}
          className="text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/90 h-7 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground/95 flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96] disabled:pointer-events-none"
        >
          {retrying ? (
            <Loader2Icon className="size-3 animate-spin motion-reduce:animate-none" />
          ) : (
            <RotateCwIcon className="size-3" />
          )}
          {retrying ? "Retrying" : "Retry"}
        </button>
      </div>
    </div>
  );
}

export interface AuiQueuedMessage {
  id: string;
  text: string;
}

export function MessageQueue({
  running,
  queued,
  onCancel,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "running" | "queued" | "onCancel"> & {
  running: string;
  queued: readonly AuiQueuedMessage[];
  onCancel?: (id: string) => void;
}) {
  return (
    <div
      data-slot="message-queue"
      className={cn("flex w-full max-w-sm flex-col gap-2", className)}
      {...props}
    >
      <div className={cn(AUI_PAPER, "flex items-center gap-2.5 rounded-2xl p-3")}>
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-blue-500/60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-blue-500 dark:bg-blue-400" />
        </span>
        <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13.5px]">{running}</span>
        <span className={cn(AUI_MONO, "text-muted-foreground shrink-0")}>running</span>
      </div>

      {queued.length > 0 && (
        <div className="flex items-baseline justify-between px-1">
          <span className={cn(AUI_MONO, "text-muted-foreground")}>{queued.length} queued</span>
          <span className={cn(AUI_MONO, "text-muted-foreground")}>sends when this finishes</span>
        </div>
      )}

      <ul className="flex flex-col gap-1.5">
        {queued.map((message, index) => (
          <li
            key={message.id}
            className={cn(
              AUI_FIELD,
              "aui-pop-up flex items-center gap-2.5 rounded-2xl py-2 pr-2 pl-3",
            )}
          >
            <span className={cn(AUI_MONO, "text-muted-foreground w-3 shrink-0 tabular-nums")}>
              {index + 1}
            </span>
            <span className="text-foreground/60 min-w-0 flex-1 truncate text-[13.5px]">
              {message.text}
            </span>
            <ArrowUpIcon className="text-foreground/25 size-3 shrink-0" />
            {onCancel && (
              <button
                type="button"
                aria-label={`Remove "${message.text}" from the queue`}
                onClick={() => onCancel(message.id)}
                className={cn(AUI_GHOST, "size-6 shrink-0")}
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface AuiRegenerateOption {
  id: string;
  label: string;
  detail: string;
}

export function RegenerateMenu({
  options,
  open,
  currentId,
  onOpenChange,
  onPick,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "options" | "open" | "currentId" | "onOpenChange" | "onPick"
> & {
  options: readonly AuiRegenerateOption[];
  open: boolean;
  currentId: string;
  onOpenChange?: (open: boolean) => void;
  onPick?: (id: string) => void;
}) {
  return (
    <div
      data-slot="regenerate-menu"
      className={cn("flex w-full max-w-sm flex-col gap-2", className)}
      {...props}
    >
      {onOpenChange && (
        <button
          type="button"
          aria-expanded={open}
          aria-label="Regenerate with a different model"
          onClick={() => onOpenChange(!open)}
          className={cn(AUI_GHOST, "size-7 self-start", open && "bg-foreground/[0.06] text-foreground/90")}
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
      )}

      {open && (
        <div
          className={cn(
            AUI_FLOATING,
            "aui-pop-down flex flex-col gap-0.5 rounded-2xl p-1.5",
          )}
        >
          {options.map((option) => {
            const content = (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px]">{option.label}</span>
                <span className={cn(AUI_MONO, "text-muted-foreground shrink-0")}>
                  {option.id === currentId ? "current" : option.detail}
                </span>
              </>
            );
            const itemClass = onPick
              ? "hover:bg-foreground/[0.05] flex items-baseline gap-2 rounded-xl px-2.5 py-1.5 text-start transition-colors"
              : "flex items-baseline gap-2 rounded-xl px-2.5 py-1.5 text-start";
            return onPick ? (
              <button key={option.id} type="button" onClick={() => onPick(option.id)} className={itemClass}>
                {content}
              </button>
            ) : (
              <div key={option.id} className={itemClass}>
                {content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export type AuiSpeakerKind = "user" | "agent" | "subagent" | "tool";

export interface AuiSpeakerTurn {
  id: string;
  kind: AuiSpeakerKind;
  name: string;
  detail?: string;
  text: string;
}

const AUI_TONE: Record<AuiSpeakerKind, string> = {
  user: "bg-foreground/[0.06] text-muted-foreground",
  agent: "bg-blue-500/12 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400",
  subagent: "bg-foreground/[0.06] text-muted-foreground",
  tool: "bg-foreground/[0.04] text-muted-foreground",
};

export function SpeakerIdentity({
  turns,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "turns"> & {
  turns: readonly AuiSpeakerTurn[];
}) {
  return (
    <div
      data-slot="speaker-identity"
      className={cn("flex w-full max-w-sm flex-col gap-3.5", className)}
      {...props}
    >
      {turns.map((turn) => (
        <div key={turn.id} className="flex gap-2.5">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-lg",
              AUI_TONE[turn.kind],
              turn.kind === "subagent" && "rounded-full",
            )}
          >
            {turn.kind === "user" ? (
              <UserIcon className="size-3" />
            ) : turn.kind === "tool" ? (
              <WrenchIcon className="size-3" />
            ) : (
              <BotIcon className="size-3" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[13px] font-medium">{turn.name}</span>
              {turn.detail && (
                <span className={cn(AUI_MONO, "text-muted-foreground")}>{turn.detail}</span>
              )}
            </span>
            <span className="text-foreground/65 text-[13.5px] leading-relaxed break-words">
              {turn.text}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface AuiComputerStep {
  id: string;
  action: string;
  target: string;
  x: number;
  y: number;
}

export function ComputerUse({
  url,
  steps,
  activeIndex,
  children,
  className,
  ...props
}: Omit<ComponentProps<"div">, "url" | "steps" | "activeIndex" | "children"> & {
  url: string;
  steps: readonly AuiComputerStep[];
  activeIndex: number;
  children?: ReactNode;
}) {
  const index = auiIndexIn(steps, activeIndex);
  const active = auiAt(steps, index);
  const trail = steps.slice(Math.max(0, index - 2), index + 1);
  return (
    <div
      data-slot="computer-use"
      className={cn(AUI_PAPER, "flex w-full max-w-md flex-col overflow-hidden rounded-2xl", className)}
      {...props}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex shrink-0 gap-1">
          {["bg-red-500/50", "bg-amber-500/50", "bg-emerald-500/50"].map((tint) => (
            <span key={tint} aria-hidden className={cn("size-2 rounded-full", tint)} />
          ))}
        </span>
        <span className={cn(AUI_FIELD, AUI_MONO, "text-muted-foreground min-w-0 flex-1 truncate rounded-full px-2.5 py-1")}>
          {url}
        </span>
      </div>
      <div className="border-foreground/[0.07] relative min-h-[8.5rem] overflow-hidden border-t">
        {children}
        {trail.map((step, i) => (
          <span
            key={step.id}
            aria-hidden
            className="pointer-events-none absolute size-2 rounded-full bg-blue-500 transition-opacity duration-300 dark:bg-blue-400"
            style={{ left: `${step.x}%`, top: `${step.y}%`, opacity: 0.18 * (i + 1) }}
          />
        ))}
        {active && (
          <MousePointer2Icon
            aria-hidden
            className="pointer-events-none absolute size-4 fill-blue-500 text-blue-500 transition-[left,top] duration-500 ease-out motion-reduce:transition-none dark:fill-blue-400 dark:text-blue-400"
            style={{ left: `${active.x}%`, top: `${active.y}%`, translate: "-50% -50%" }}
          />
        )}
      </div>
    </div>
  );
}

export interface AuiDatedMessage {
  id: string;
  day: string;
  time: string;
  role: "user" | "assistant";
  text: string;
}

export function DaySeparatorTranscript({
  messages,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "messages"> & {
  messages: readonly AuiDatedMessage[];
}) {
  let lastDay = "";
  return (
    <div
      data-slot="day-separator-transcript"
      className={cn("flex w-full max-w-sm flex-col gap-2", className)}
      {...props}
    >
      {messages.map((message) => {
        const newDay = message.day !== lastDay;
        lastDay = message.day;
        return (
          <div key={message.id} className="flex flex-col gap-2">
            {newDay && (
              <div className="flex items-center gap-3">
                <span className="bg-border h-px w-6" />
                <span className={cn(AUI_MONO, "text-muted-foreground")}>{message.day}</span>
                <span className="bg-border h-px flex-1" />
              </div>
            )}
            <div className="group flex items-center gap-1.5">
              <div
                className={cn(
                  "flex min-w-0 flex-1 items-baseline gap-2",
                  message.role === "user" && "flex-row-reverse",
                )}
              >
                <span
                  className={cn(
                    "max-w-[80%] text-[13.5px] leading-relaxed break-words",
                    message.role === "user"
                      ? "bg-foreground/[0.05] rounded-2xl px-3.5 py-2"
                      : "text-foreground/75",
                  )}
                >
                  {message.text}
                </span>
                <span
                  className={cn(
                    AUI_MONO,
                    "text-foreground/0 group-hover:text-foreground/30 shrink-0 tabular-nums transition-colors",
                  )}
                >
                  {message.time}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
      className={`group relative isolate m-0 inline-grid cursor-pointer touch-none place-items-center border-0 bg-transparent p-0 outline-none select-none [width:var(--vp-size)] [height:var(--vp-size)] [border-radius:var(--vp-radius)] [color:var(--vp-icon)] [font-family:inherit] [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [transition:transform_160ms_cubic-bezier(0.23,1,0.32,1),color_150ms_ease] before:absolute before:[inset:calc(-1*var(--vp-hit))] before:content-[''] data-[state=listening]:z-[1] data-[state=listening]:[color:var(--vp-accent)] data-[pressed]:[transform:scale(var(--vp-press))] disabled:pointer-events-none disabled:cursor-default disabled:opacity-55 motion-reduce:[transform:none]! motion-reduce:[transition:color_150ms_ease]${className ? ` ${className}` : ''}`}
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

/* ------------------------------------------------------------------ */
/* assistant-ui 真源直译 2（elements：guardrail/message-actions/error/stopped-run） */
/* 适配：可选化应用无数据 props；未传回调的按钮条件隐藏；copied 内部化。     */
/* ------------------------------------------------------------------ */

function ShimmerLabel({ active = true, className, ...props }: ComponentProps<"span"> & { active?: boolean }) {
  return <span className={cn(active && "aui-shimmer motion-reduce:animate-none", className)} {...props} />;
}

export function AuiGuardrailNotice({
  title,
  explanation,
  policy,
  alternatives = [],
  onPick,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "title" | "explanation" | "policy" | "alternatives" | "onPick"
> & {
  title: string;
  explanation: string;
  // 应用适配：真源必填的 policy/alternatives 放宽可选
  policy?: string;
  alternatives?: readonly string[];
  onPick?: (alternative: string) => void;
}) {
  return (
    <div
      data-slot="guardrail-notice"
      className={cn(AUI_PAPER, "flex w-full max-w-sm flex-col gap-3 rounded-[20px] p-4", className)}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600">
          <ShieldIcon className="size-4" />
        </span>
        <p className="text-foreground/90 text-[13.5px] font-medium">{title}</p>
      </div>
      <p className="text-foreground/60 text-[13.5px] leading-relaxed">{explanation}</p>
      {policy ? (
        <div className={cn(AUI_FIELD, "rounded-full px-2.5 py-1")}>
          <span className={cn(AUI_MONO, "text-muted-foreground")}>{policy}</span>
        </div>
      ) : null}
      {alternatives.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className={cn(AUI_MONO, "text-muted-foreground")}>try instead</span>
          {alternatives.map((alternative) =>
            onPick ? (
              <button
                key={alternative}
                type="button"
                onClick={() => onPick(alternative)}
                className="text-foreground/70 hover:bg-foreground/[0.06] -mx-1.5 rounded-lg px-1.5 py-1 text-start text-[13px] transition-colors"
              >
                {alternative}
              </button>
            ) : (
              <span key={alternative} className="text-foreground/70 -mx-1.5 rounded-lg px-1.5 py-1 text-start text-[13px]">
                {alternative}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function AuiMessageActions({
  copied,
  reaction,
  regenerating,
  onCopy,
  onReactionChange,
  onRegenerate,
  onMore,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "copied" | "reaction" | "regenerating" | "onCopy" | "onReactionChange" | "onRegenerate" | "onMore"
> & {
  // 应用适配：全部可选；未传回调的按钮隐藏；copied 未受控时内部维护
  copied?: boolean;
  reaction?: AuiReaction;
  regenerating?: boolean;
  onCopy?: () => void;
  onReactionChange?: (reaction: AuiReaction) => void;
  onRegenerate?: () => void;
  onMore?: () => void;
}) {
  const [localCopied, setLocalCopied] = useState(false);
  const isCopied = copied ?? localCopied;
  const buttonClassName = cn(AUI_GHOST, "size-7");

  return (
    <div data-slot="message-actions" className={cn("flex items-center gap-1", className)} {...props}>
      {onCopy && (
        <button
          type="button"
          aria-label={isCopied ? "Copied response" : "Copy response"}
          onClick={() => {
            onCopy();
            setLocalCopied(true);
            window.setTimeout(() => setLocalCopied(false), 1500);
          }}
          className={cn(buttonClassName, "grid place-items-center", isCopied && "text-emerald-500")}
        >
          <CopyIcon className={cn(AUI_ICON_SWAP, "size-3.5", isCopied ? AUI_ICON_SWAP_OUT : AUI_ICON_SWAP_IN)} />
          <CheckIcon
            className={cn(
              AUI_ICON_SWAP,
              "absolute size-3.5",
              isCopied ? AUI_ICON_SWAP_IN : AUI_ICON_SWAP_OUT,
            )}
          />
        </button>
      )}
      {onReactionChange && (
        <>
          <button
            type="button"
            aria-label="Mark response helpful"
            aria-pressed={reaction === "up"}
            onClick={() => onReactionChange(reaction === "up" ? null : "up")}
            className={cn(buttonClassName, reaction === "up" && "bg-foreground/[0.06] text-foreground/90")}
          >
            <ThumbsUpIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Mark response unhelpful"
            aria-pressed={reaction === "down"}
            onClick={() => onReactionChange(reaction === "down" ? null : "down")}
            className={cn(buttonClassName, reaction === "down" && "bg-foreground/[0.06] text-foreground/90")}
          >
            <ThumbsDownIcon className="size-3.5" />
          </button>
        </>
      )}
      {onRegenerate && (
        <button type="button" aria-label="Regenerate response" onClick={onRegenerate} className={buttonClassName}>
          <RefreshCwIcon className={cn("size-3.5", regenerating && "animate-spin motion-reduce:animate-none")} />
        </button>
      )}
      {onMore && (
        <button type="button" aria-label="More response actions" onClick={onMore} className={buttonClassName}>
          <EllipsisIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function AuiErrorState({
  title,
  detail,
  retrying = false,
  onRetry,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "title" | "detail" | "retrying" | "onRetry"> & {
  title: string;
  detail: string;
  // 应用适配：retrying/onRetry 可选（无重试动作的场景隐藏按钮）
  retrying?: boolean;
  onRetry?: () => void;
}) {
  if (retrying) {
    return (
      <div
        data-slot="error-state"
        key="retrying"
        role="status"
        className={cn("aui-rise flex w-full max-w-sm items-center gap-2.5 text-sm", className)}
        {...props}
      >
        <RefreshCwIcon className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        <ShimmerLabel className="text-muted-foreground relative inline-block">Retrying</ShimmerLabel>
      </div>
    );
  }

  return (
    <div
      data-slot="error-state"
      key="error"
      role="alert"
      className={cn(
        "aui-rise flex w-full max-w-sm items-start gap-2.5 rounded-2xl bg-red-500/[0.06] px-4 py-3 text-sm",
        className,
      )}
      {...props}
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-red-500/80" />
      <div>
        <p className="font-medium text-red-600">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-red-600/60">{detail}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-red-600 hover:bg-red-500/10 ms-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors"
        >
          <RefreshCwIcon className="size-3" />
          Retry
        </button>
      )}
    </div>
  );
}

export function AuiStoppedRun({
  words = [],
  reason,
  onContinue,
  onDiscard,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  "children" | "words" | "reason" | "onContinue" | "onDiscard"
> & {
  // 应用适配：words 可选（应用停止标签无词列表，空时隐藏段落）
  words?: readonly string[];
  reason: string;
  onContinue?: () => void;
  onDiscard?: () => void;
}) {
  return (
    <div data-slot="stopped-run" className={cn("flex w-full max-w-sm flex-col gap-3", className)} {...props}>
      {words.length > 0 && (
        <p className="text-foreground/80 text-[13.5px] leading-relaxed">
          {words.join(" ")}
          <span aria-hidden className="bg-foreground/20 ms-1 inline-block h-[1em] w-[2px] translate-y-[0.15em] rounded-full" />
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className={cn(AUI_FIELD, AUI_MONO, "text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-1")}>
          <SquareIcon className="size-2.5 fill-current" />
          {reason}
        </span>

        {onContinue && (
          <button
            type="button"
            onClick={onContinue}
            className="text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground/95 ms-auto flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
          >
            Continue
            <ArrowRightIcon className="size-3" />
          </button>
        )}
        {onDiscard && (
          <button
            type="button"
            onClick={onDiscard}
            className="text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground/90 flex h-7 items-center rounded-full px-2.5 text-xs font-medium transition-[background-color,color,scale] duration-150 active:scale-[0.96]"
          >
            Discard
          </button>
        )}
      </div>
    </div>
  );
}
