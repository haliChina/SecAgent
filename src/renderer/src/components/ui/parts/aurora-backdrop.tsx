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
