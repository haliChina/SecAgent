/**
 * CallChip —— react-bits Micro/CallChip 移植（R65）。
 * 来源：github.com/DavidHDev/react-bits src/ts-default/Micro/CallChip（MIT）
 * 直译适配：hugeicons → lucide-react；'use client' 去除。
 * 用途：消息活动流里每个工具调用一枚芯片（图标+工具名+参数+状态+计时，
 * running 有进度填充、done 打勾变绿、error 抖动变红）。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, FileText, PencilLine, RefreshCw, Search, Terminal } from "lucide-react";

export type CallChipStatus = "idle" | "running" | "done" | "error";
export type CallChipIcon = "terminal" | "file" | "search" | "edit";

export interface CallChipProps {
  icon?: CallChipIcon | ReactNode;
  name?: string;
  argument?: string;
  status?: CallChipStatus;
  expectedMs?: number;
  size?: number;
  radius?: number;
  color?: string;
  surfaceColor?: string;
  progressColor?: string;
  progressOpacity?: number;
  doneColor?: string;
  errorColor?: string;
  washOpacity?: number;
  shake?: number;
  showTimer?: boolean;
  className?: string;
  style?: CSSProperties;
}

type Glyph = "tool" | "check" | "retry";

const HOLD_AT = 0.9;
const SHAKE = [0, -1, 1, -0.66, 0.66, -0.33, 0];
import type { LucideIcon } from "lucide-react";
const ICONS: Record<string, LucideIcon> = { terminal: Terminal, file: FileText, search: Search, edit: PencilLine };
const WORDS: Record<CallChipStatus, string> = { running: "运行中", done: "完成", error: "失败", idle: "排队" };

const fmt = (ms: number) => (ms < 10000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const glyphOf = (s: CallChipStatus): Glyph => (s === "done" ? "check" : s === "error" ? "retry" : "tool");

export function CallChip({
  icon = "terminal",
  name = "bash",
  argument = "",
  status = "running",
  expectedMs = 2500,
  size = 34,
  radius = 10,
  color = "currentColor",
  surfaceColor = "var(--bg-2)",
  progressColor = "currentColor",
  progressOpacity = 0.08,
  doneColor = "#16a34a",
  errorColor = "#dc2626",
  washOpacity = 0.14,
  shake = 6,
  showTimer = true,
  className = "",
  style
}: CallChipProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const mountedRef = useRef(false);
  const fraction = useRef(0);
  const clock = useRef({ ms: 0 });
  const shakeAnim = useRef<Animation | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const [mounted, setMounted] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const roll = useRef<{ cur: Glyph; prev: Glyph | null }>({ cur: glyphOf(status), prev: null });
  if (glyphOf(status) !== roll.current.cur) roll.current = { cur: glyphOf(status), prev: roll.current.cur };

  const setFraction = (f: number, instant: boolean) => {
    const fill = fillRef.current;
    if (!fill) return;
    fraction.current = f;
    if (instant) fill.style.transition = "none";
    fill.style.transform = `scaleX(${f})`;
    if (instant) {
      void fill.getBoundingClientRect();
      fill.style.transition = "";
    }
  };
  const apply = (s: CallChipStatus, animate: boolean) => {
    if (s === "running") {
      shakeAnim.current?.cancel();
      setFraction(0, true);
      if (animate) setFraction(HOLD_AT, false);
    } else if (s === "done") {
      setFraction(1, !animate);
    } else if (s === "error") {
      const fill = fillRef.current;
      const live = fill ? new DOMMatrix(getComputedStyle(fill).transform).a : fraction.current;
      setFraction(Math.min(1, Math.max(0, live)), true);
      if (animate && shake > 0 && !reduceMotion() && rootRef.current) {
        shakeAnim.current = rootRef.current.animate(SHAKE.map((k) => ({ transform: `translateX(${k * shake}px)`, easing: "cubic-bezier(0.77, 0, 0.175, 1)" })), { duration: 450, composite: "add" });
      }
    } else setFraction(0, true);
  };

  useEffect(() => {
    mountedRef.current = true;
    setMounted(true);
    apply(statusRef.current, statusRef.current === "running");
    return () => { mountedRef.current = false; shakeAnim.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => { if (mountedRef.current) apply(status, true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  useEffect(() => {
    /* R66：修「等待返回不返回时计时一直狂走」——超过 expectedMs 后：
       ①数字封顶在 expectedMs 并加"…"后缀（9357ms→"6.0 s…"），传达
         「比预期久，还在等」而不是无限飙升的秒表焦虑；
       ②rAF 降频到 1s 一跳（省电），result 到达时 status 变化、effect 重跑
         走正常收尾写入真实耗时。工具真耗时超过预期（如长 bash）时数字
         会继续走——封顶仅覆盖「没有 result 的等待期」。 */
    const write = (ms: number) => {
      const capped = ms > expectedMs;
      const shown = capped ? expectedMs : ms;
      clock.current.ms = shown;
      if (timerRef.current) timerRef.current.textContent = fmt(shown) + (capped ? "…" : "");
    };
    if (status !== "running") {
      if ((status === "idle" || !clock.current.ms) && timerRef.current) timerRef.current.textContent = "—";
      return undefined;
    }
    const startedAt = performance.now();
    write(0);
    if (reduceMotion()) {
      const id = setInterval(() => write(performance.now() - startedAt), 100);
      return () => { clearInterval(id); write(performance.now() - startedAt); };
    }
    let raf = 0;
    let slowTimer = 0;
    const tick = () => {
      write(performance.now() - startedAt);
      const over = performance.now() - startedAt > expectedMs;
      if (over) {
        // 超时等待：脱离 rAF 高频循环，改 1s 低频跳
        cancelAnimationFrame(raf);
        raf = 0;
        slowTimer = window.setInterval(() => write(performance.now() - startedAt), 1000);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (slowTimer) clearInterval(slowTimer);
      write(performance.now() - startedAt);
    };
  }, [status, expectedMs]);
  useEffect(() => {
    const ms = showTimer && clock.current.ms ? Math.round(clock.current.ms) : 0;
    const when = status === "done" && ms ? `（${ms} ms）` : status === "error" && ms ? `（${ms} ms 后）` : "";
    setAnnounce(`${name}${argument ? ` ${argument}` : ""}：${WORDS[status] ?? status}${when}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const font = Math.max(11, Math.round(size * 0.38));
  const glyphState = (g: Glyph) => (g === roll.current.cur ? "in" : g === roll.current.prev ? "out" : undefined);
  const ToolIcon: LucideIcon | null = typeof icon === "string" ? (ICONS[icon] ?? ICONS.terminal) : null;
  const iconSize = font + 2;

  return (
    <span
      ref={rootRef}
      role="status"
      aria-busy={status === "running" || undefined}
      data-status={status}
      data-mounted={mounted ? "" : undefined}
      data-pressed={pressed ? "" : undefined}
      className={`call-chip${className ? ` ${className}` : ""}`}
      style={{
        "--cc-size": `${size}px`, "--cc-font": `${font}px`, "--cc-pad": `${Math.round(size * 0.35)}px`,
        "--cc-gap": `${Math.round(font * 0.55)}px`, "--cc-radius": `${radius}px`, "--cc-color": color,
        "--cc-surface": surfaceColor, "--cc-progress": progressColor, "--cc-progress-pct": `${progressOpacity * 100}%`,
        "--cc-done": doneColor, "--cc-error": errorColor, "--cc-wash-pct": `${washOpacity * 100}%`, "--cc-expected": `${expectedMs}ms`,
        ...style
      } as CSSProperties}
    >
      <span ref={fillRef} className="call-chip__fill" aria-hidden="true" />
      <span className="call-chip__slot" aria-hidden="true">
        <span className="call-chip__glyph" data-state={glyphState("tool")}>{ToolIcon ? <ToolIcon size={iconSize} strokeWidth={1.8} /> : icon}</span>
        <span className="call-chip__glyph" data-state={glyphState("check")}><Check size={iconSize} strokeWidth={2.2} /></span>
        <span className="call-chip__glyph" data-state={glyphState("retry")}><RefreshCw size={iconSize} strokeWidth={2} /></span>
      </span>
      <span className="call-chip__name" aria-hidden="true">{name}</span>
      {argument ? <span className="call-chip__arg" aria-hidden="true">{argument}</span> : null}
      {showTimer ? (
        /* children 留空：textContent 由计时 rAF 直接写（"0 ms"→实时毫秒）——
           一旦放了静态 children，trace 流式高频重渲染会把数字不断重置回初值，
           表现为「数字不随进度填充一起跳动」（R66）。 */
        <span ref={timerRef} className="call-chip__timer" aria-hidden="true" />
      ) : null}
      <span className="call-chip__sr">{announce}</span>
    </span>
  );
}
