/**
 * FuseButton —— react-bits Micro/FuseButton 移植（R65）。
 * 来源：github.com/DavidHDev/react-bits src/ts-default/Micro/FuseButton（MIT）
 * 直译适配：hugeicons → lucide-react；'use client' 去除。
 * 语义：press → armed（fuse 动画倒计时）→ undo 可反悔 / fuse 烧尽 → settled。
 * commitOn="fuseEnd" 把提交推迟到烧完（删除会话用它：4 秒反悔窗，天然可撤销）。
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Archive, Check, Undo2 } from "lucide-react";

export type FusePosition = "outline" | "bottom" | "top";
export type FuseCommitOn = "press" | "fuseEnd";
export type FuseSettle = "reset" | "stay";
export type FusePhase = "idle" | "armed" | "settled";
export type FuseSize = "sm" | "md" | "lg";

export interface FuseButtonProps {
  /** 容器 role 透传（如侧栏菜单里传 menuitem——UIA 客户端在 role 节点上 Invoke）。 */
  role?: "menuitem" | "button" | "option" | string;
  label?: string;
  undoLabel?: string;
  doneLabel?: string;
  icon?: ReactNode;
  color?: string;
  background?: string;
  fuseColor?: string;
  size?: FuseSize;
  radius?: number;
  undoWindow?: number;
  fuse?: FusePosition;
  fuseThickness?: number;
  crossfadeMs?: number;
  commitOn?: FuseCommitOn;
  pauseOnHover?: boolean;
  settle?: FuseSettle;
  disabled?: boolean;
  onCommit?: (reason: FuseCommitOn) => void;
  onUndo?: () => void;
  onFuseEnd?: () => void;
  onPhaseChange?: (phase: FusePhase) => void;
  className?: string;
  type?: "button" | "submit" | "reset";
}

interface Latest {
  onCommit?: (reason: FuseCommitOn) => void;
  onUndo?: () => void;
  onFuseEnd?: () => void;
  onPhaseChange?: (phase: FusePhase) => void;
  commitOn: FuseCommitOn;
  settle: FuseSettle;
}

const LINE: Keyframe[] = [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }];
const OUTLINE: Keyframe[] = [{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }];
const SIZES: Record<FuseSize, { height: number; font: number; icon: number; px: number }> = {
  sm: { height: 30, font: 12, icon: 13, px: 13 },
  md: { height: 34, font: 13, icon: 14, px: 16 },
  lg: { height: 40, font: 14, icon: 16, px: 20 }
};

export function FuseButton({
  label = "归档",
  undoLabel = "撤销",
  doneLabel = "已归档",
  icon,
  color = "var(--text-1)",
  background = "var(--bg-2)",
  fuseColor = "var(--accent)",
  size = "md",
  radius = 8,
  undoWindow = 4000,
  fuse = "outline",
  fuseThickness = 1.5,
  crossfadeMs = 200,
  commitOn = "press",
  pauseOnHover = true,
  settle = "reset",
  disabled = false,
  onCommit,
  onUndo,
  onFuseEnd,
  onPhaseChange,
  className = "",
  type = "button",
  role
}: FuseButtonProps) {
  const [phase, setPhase] = useState<FusePhase>("idle");
  const [instant, setInstant] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const idleRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const lineRef = useRef<HTMLElement>(null);
  const rimRef = useRef<SVGRectElement>(null);
  const anim = useRef<Animation | null>(null);
  const pause = useRef({ hover: false, hidden: false, canHoverPause: false });
  const lastInput = useRef<"pointer" | "keyboard">("pointer");
  const windowRef = useRef(undoWindow);
  const latest = useRef<Latest>({ commitOn, settle });
  latest.current = { onCommit, onUndo, onFuseEnd, onPhaseChange, commitOn, settle };
  const statusId = useId();
  const preset = SIZES[size] || SIZES.md;

  const go = (next: FusePhase) => {
    setInstant(lastInput.current === "keyboard");
    setPhase(next);
    latest.current.onPhaseChange?.(next);
  };

  const syncPlayState = () => {
    const a = anim.current;
    if (!a) return;
    const { hover, hidden } = pause.current;
    if (hover || hidden) { if (a.playState === "running") a.pause(); }
    else if (a.playState === "paused") a.play();
  };

  const light = (from = 0) => {
    const el = fuse === "outline" ? rimRef.current : lineRef.current;
    if (!el) return;
    anim.current?.cancel();
    const a = el.animate(fuse === "outline" ? OUTLINE : LINE, { duration: windowRef.current, easing: "linear", fill: "forwards" });
    if (from) a.currentTime = from;
    a.onfinish = () => {
      const l = latest.current;
      l.onFuseEnd?.();
      if (l.commitOn === "fuseEnd") l.onCommit?.("fuseEnd");
      lastInput.current = "pointer";
      go(l.settle === "stay" ? "settled" : "idle");
    };
    anim.current = a;
    syncPlayState();
  };

  const arm = () => {
    if (disabled || phase !== "idle") return;
    windowRef.current = undoWindow;
    light();
    pause.current.canHoverPause = false;
    pause.current.hover = false;
    if (commitOn === "press") onCommit?.("press");
    go("armed");
  };

  const undo = () => {
    if (phase !== "armed") return;
    const a = anim.current;
    if (a) { a.onfinish = null; a.pause(); }
    onUndo?.();
    go("idle");
  };

  useEffect(() => {
    const inside = rootRef.current?.contains(document.activeElement);
    if (phase === "armed") undoRef.current?.focus({ preventScroll: true });
    else if (inside) (phase === "idle" ? idleRef.current : rootRef.current)?.focus({ preventScroll: true });
  }, [phase]);

  useEffect(() => {
    const onVisibility = () => { pause.current.hidden = document.hidden; syncPlayState(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { document.removeEventListener("visibilitychange", onVisibility); anim.current?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const a = anim.current;
    if (!a || phase !== "armed") return;
    light(Number(a.currentTime) || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuse]);

  useEffect(() => {
    if (pauseOnHover) return;
    pause.current.hover = false;
    syncPlayState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauseOnHover]);

  const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    lastInput.current = "pointer";
    const pressable = phase === "armed" || (phase === "idle" && !disabled);
    if (e.button === 0 && pressable && rootRef.current) rootRef.current.dataset.pressed = "";
  };
  const release = () => { if (rootRef.current) delete rootRef.current.dataset.pressed; };
  const handlePointerEnter = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (pauseOnHover && e.pointerType === "mouse" && pause.current.canHoverPause) { pause.current.hover = true; syncPlayState(); }
  };
  const handlePointerLeave = (e: React.PointerEvent<HTMLSpanElement>) => {
    release();
    if (e.pointerType !== "mouse") return;
    pause.current.canHoverPause = true;
    pause.current.hover = false;
    syncPlayState();
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Enter" || e.key === " ") lastInput.current = "keyboard";
    if (e.key === "Escape" && phase === "armed") { e.preventDefault(); lastInput.current = "keyboard"; undo(); }
  };

  const actionIcon = icon ?? <Archive size={preset.icon} strokeWidth={1.8} />;
  const line = <i ref={lineRef} className="fuse-button__fuse" aria-hidden="true" />;

  return (
    <span
      ref={rootRef}
      role={role}
      tabIndex={-1}
      className={`fuse-button${className ? ` ${className}` : ""}`}
      data-phase={phase}
      data-fuse={fuse}
      data-instant={instant ? "" : undefined}
      aria-disabled={phase === "settled" || undefined}
      style={{
        "--fb-ink": color, "--fb-bg": background, "--fb-fuse": fuseColor,
        "--fb-fuse-h": `${fuseThickness}px`, "--fb-radius": `${radius}px`, "--fb-fade": `${crossfadeMs}ms`,
        "--fb-h": `${preset.height}px`, "--fb-fs": `${preset.font}px`, "--fb-icon": `${preset.icon}px`, "--fb-px": `${preset.px}px`
      } as CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
    >
      <button ref={idleRef} type={type} className="fuse-button__face fuse-button__idle" disabled={disabled} inert={phase !== "idle"} onClick={arm}>
        <span className="fuse-button__icon" aria-hidden="true">{actionIcon}</span>
        {label}
      </button>
      <button ref={undoRef} type="button" className="fuse-button__face fuse-button__undo" aria-describedby={statusId} aria-keyshortcuts="Escape" inert={phase !== "armed"} onClick={undo}>
        <span className="fuse-button__icon fuse-button__icon--undo" aria-hidden="true"><Undo2 size={preset.icon} strokeWidth={2} /></span>
        {undoLabel}
        {fuse !== "outline" ? line : null}
      </button>
      <span className="fuse-button__face fuse-button__settled" inert={phase !== "settled"}>
        <span className="fuse-button__icon" aria-hidden="true"><Check size={preset.icon} strokeWidth={2.2} /></span>
        {doneLabel}
      </span>
      {fuse === "outline" ? <svg className="fuse-button__rim" aria-hidden="true"><rect ref={rimRef} pathLength={1} /></svg> : null}
      <span className="fuse-button__status" id={statusId} role="status" aria-live="polite">{phase === "idle" ? "" : doneLabel}</span>
    </span>
  );
}
