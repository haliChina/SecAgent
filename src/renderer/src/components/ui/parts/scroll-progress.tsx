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
    // App 适配：消息流在内部滚动容器，window 级 scrollIntoView 无效（R24 反馈"点不动"）
    const target = document.getElementById(id)
    const container = containerRef?.current
    if (target && container && container.contains(target)) {
      container.scrollTo({ top: target.offsetTop - 24, behavior: reduceMotion ? "auto" : "smooth" })
    } else {
      target?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })
    }
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

