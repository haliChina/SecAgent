/**
 * FluidOrb —— RareUI 同源的"流体球"状态指示器（R58）。
 *
 * 与 MatrixOrb（rareui matrixorb 直译）同一 prop 协议，composer 右下角
 * 状态球换装用：size / state(idle|listening|thinking) / level(0-1，缺省
 * 走 useStreamLevel 采集 stream) / color / stream。
 *
 * 视觉：canvas 逐帧绘制"边界带谐波扰动的渐变流体球"——
 *  - 半径 r(θ,t) = R·(1 + Σ aₖ·sin(kθ + φₖ + ωₖt))，三层谐波叠出流体感
 *  - 径向渐变实心核 + 外圈柔光 halo + 上左高光次球（深度）
 *  - idle 慢速低幅；listening 幅度/呼吸随音频电平；thinking 中幅 + 高光绕行
 *  - 状态切换经权重插值平滑过渡（与 MatrixOrb 同思路）
 * prefers-reduced-motion：静态单帧。DPR 感知，zoom 缩放重建缓冲。
 */
import { useEffect, useRef } from "react";
import { useStreamLevel, useDevicePixelRatio, type OrbState } from "./matrix-orb.js";
import { ACCENT } from "./theme.js";

const FO_STATES: OrbState[] = ["idle", "listening", "thinking"];
/** 各状态的形态参数：基础半径比 / 谐波幅度 / 速度 / halo 透明度。 */
const FO_SHAPE: Record<OrbState, { scale: number; amp: number; speed: number; halo: number }> = {
  idle: { scale: 0.86, amp: 0.045, speed: 0.5, halo: 0.1 },
  listening: { scale: 1, amp: 0.12, speed: 1.1, halo: 0.22 },
  thinking: { scale: 0.93, amp: 0.09, speed: 0.85, halo: 0.16 }
};

function hexToRgb(hex: string): [number, number, number] {
  const full = hex.replace(/^#/, "");
  const expanded = full.length === 3 ? full.split("").map((c) => c + c).join("") : full;
  const value = Number.parseInt(expanded.slice(0, 6) || "000000", 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function FluidOrb({ size = 240, state = "idle", level, color = ACCENT, stream }: {
  size?: number;
  state?: OrbState;
  level?: number;
  color?: string;
  stream?: MediaStream | null;
}) {
  const streamLevel = useStreamLevel(state === "listening" ? stream : null);
  const live = level ?? streamLevel;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = useDevicePixelRatio();
  const stateRef = useRef(state);
  const levelRef = useRef(live);

  useEffect(() => {
    stateRef.current = state;
    levelRef.current = live;
  }, [state, live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const buffer = Math.max(1, Math.round(size * dpr));
    canvas.width = buffer;
    canvas.height = buffer;
    ctx.setTransform(buffer / size, 0, 0, buffer / size, 0, 0);
    const [r, g, b] = hexToRgb(color);
    const rgba = (alpha: number) => `rgba(${r},${g},${b},${alpha})`;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const center = size / 2;
    const baseR = (size / 2) * 0.78;
    // 状态权重（平滑过渡）
    const weights: Record<OrbState, number> = { idle: 0, listening: 0, thinking: 0 };
    weights[stateRef.current] = 1;
    let raf = 0;
    const start = performance.now();

    // 谐波参数（固定相位差避免同频对齐的机械感）
    const harmonics = [
      { k: 2, a: 1, speed: 1.0, phase: 0.0 },
      { k: 3, a: 0.62, speed: -0.72, phase: 1.9 },
      { k: 5, a: 0.38, speed: 0.55, phase: 4.1 }
    ];

    const blobPath = (t: number, scale: number, amp: number): void => {
      ctx.beginPath();
      const steps = 72;
      for (let i = 0; i <= steps; i += 1) {
        const angle = (i / steps) * Math.PI * 2;
        let wobble = 0;
        for (const h of harmonics) wobble += h.a * Math.sin(h.k * angle + h.phase + t * h.speed * (1 + amp));
        const radius = baseR * scale * (1 + wobble * amp);
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const draw = (now: number): void => {
      const t = reduce ? 0 : (now - start) / 1000;
      // 状态权重向当前状态松弛（~200ms 过渡）
      const target = stateRef.current;
      for (const key of FO_STATES) {
        const goal = key === target ? 1 : 0;
        weights[key] += (goal - weights[key]) * 0.16;
      }
      let scale = 0;
      let amp = 0;
      let halo = 0;
      for (const key of FO_STATES) {
        const w = weights[key];
        if (w <= 0.001) continue;
        scale += FO_SHAPE[key].scale * w;
        amp += FO_SHAPE[key].amp * w;
        halo += FO_SHAPE[key].halo * w;
      }
      // listening 电平呼吸：幅度与尺度随电平抬升（平滑）
      const lvl = stateRef.current === "listening" ? levelRef.current : 0;
      const breathe = 1 + lvl * 0.16;
      scale *= breathe;

      ctx.clearRect(0, 0, size, size);

      // 外圈柔光 halo（径向渐变环）
      const haloR = baseR * scale * (1.34 + lvl * 0.2);
      const haloGrad = ctx.createRadialGradient(center, center, baseR * scale * 0.6, center, center, haloR);
      haloGrad.addColorStop(0, rgba(halo * 0.35));
      haloGrad.addColorStop(1, rgba(0));
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(center, center, haloR, 0, Math.PI * 2);
      ctx.fill();

      // 主体流体渐变
      const grad = ctx.createRadialGradient(center - baseR * 0.22, center - baseR * 0.26, baseR * 0.1, center, center, baseR * scale * 1.18);
      grad.addColorStop(0, rgba(0.95));
      grad.addColorStop(0.45, rgba(0.55));
      grad.addColorStop(1, rgba(0.08));
      ctx.fillStyle = grad;
      blobPath(t, scale, amp);
      ctx.fill();

      // thinking：高光次球绕行（上左向）
      if (weights.thinking > 0.02) {
        const orbit = t * 1.6;
        const hx = center - Math.cos(orbit) * baseR * 0.34 * weights.thinking;
        const hy = center - Math.sin(orbit) * baseR * 0.3 * weights.thinking;
        const hr = baseR * scale * 0.3 * (0.7 + 0.3 * weights.thinking);
        const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
        hg.addColorStop(0, `rgba(255,255,255,${0.5 * weights.thinking})`);
        hg.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(hx, hy, hr, 0, Math.PI * 2);
        ctx.fill();
      }

      // 细描边（形态可读性）
      ctx.strokeStyle = rgba(0.35);
      ctx.lineWidth = Math.max(1, size * 0.006);
      blobPath(t, scale, amp);
      ctx.stroke();

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, dpr, color]);

  return <canvas ref={canvasRef} className="fluid-orb" width={size} height={size} style={{ width: size, height: size }} aria-hidden="true" />;
}
