/**
 * BloubMorph — SecAgent 的 React 移植版 bloub 吉祥物。
 *
 * 引擎与渲染模型逐行来自 bloub（https://github.com/jeremy-prt/bloub ，MIT ©
 * jeremy-prt）：一个墨色形状在 15 个状态间平滑 morph，眼睛是真正打穿身体的
 * 孔（mask），随鼠标注视。./bot/ 目录为原引擎（未改动），本文件是它的
 * React 客户端——对应上游 src/components/BloubBot.vue 的最小移植：
 * 去掉了时间线（cycles）、GIF 导出与 i18n，保留 rAF 时钟、状态切换、
 * 指针跟随与全套 SVG 结构（mask 打孔 / paper 衬底 / 双半环渐变 / 粒子）。
 *
 * 与 Vue 原版的差异是有意的：
 *  - 状态由外部驱动（OrbState 三态映射到 bloub 状态），没有内部时间线；
 *  - 墨色/纸色按 SecAgent 明暗主题解析（原版固定浅色页面）；
 *  - 指针注视以屏幕中心为零点对称（原版偏向设置面板）。
 */

import { useEffect, useId, useRef, useState } from "react";
import { BotEngine, type BotFrame } from "./bot/engine.js";
import { type StateId } from "./bot/states.js";
import { DEFAULT_SHAPE, SHAPE_BY_ID, mixHex } from "./bot/skins.js";
import { RAYON, DEMI_VIEWBOX } from "./bot/repere.js";
import { clamp, easings } from "./bot/math.js";
import { lookTarget, TURN_TIME } from "./bot/gaze.js";
import { NOTIF_BLUE } from "./bot/decor.js";

export type OrbState = "idle" | "listening" | "thinking";

/** 组件接受的完整状态：App 三态语义 + bloub 引擎 15 态直通（orbit/burst/play/…）。 */
export type BloubState = OrbState | StateId;

/** OrbState → bloub 状态。listening 用 wide（睁大眼）表现专注收音。 */
const STATE_OF: Record<OrbState, StateId> = {
  idle: "idle",
  listening: "wide",
  thinking: "thinking"
};

/** BloubState → 引擎状态（三态语义先归一，其余原样直通）。 */
function resolveState(state: BloubState): StateId {
  return (STATE_OF as Record<string, StateId | undefined>)[state] ?? (state as StateId);
}

const LABEL_OF: Record<BloubState, string> = {
  idle: "待命",
  listening: "聆听中",
  thinking: "思考中",
  wide: "聆听中",
  wink: "眨眼",
  alert: "等待确认",
  notify: "有通知",
  exclaim: "出错了",
  sleep: "已暂停",
  egg: "变身",
  hexagon: "变身",
  play: "庆祝",
  orbit: "忙碌",
  swirl: "入场",
  burst: "完成",
  comet: "完成"
};

/** 明暗主题下的墨色/纸色（纸色即眼睛孔洞透出的底色，须与页面背景一致）。 */
function palette(): { ink: string; paper: string } {
  return document.documentElement.dataset.theme === "dark"
    ? { ink: "#ECF0F8", paper: "#0B0F14" }
    : { ink: "#0A0A0C", paper: "#FAFBFD" };
}

interface BloubMorphProps {
  size: number;
  /** App 三态语义或引擎 15 态直通（idle/listening/thinking/orbit/burst/…）。 */
  state?: BloubState;
  /** 眼睛跟随鼠标（空状态大尺寸时开启）。 */
  follow?: boolean;
  /** 入场：先播 swirl（上游的进场动画，约 1.3s），再 morph 到目标状态。 */
  entrance?: boolean;
  className?: string;
}

export function BloubMorph({ size, state = "idle", follow = false, entrance = false, className }: BloubMorphProps) {
  const VB = DEMI_VIEWBOX;
  const rawId = useId();
  const uid = `bm${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const maskId = `${uid}-mask`;
  const gradId = (arcId: string) => `${uid}-${arcId}`;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const clockRef = useRef(0);
  const aimingRef = useRef(false);
  const turnSinceRef = useRef(0);
  const engineRef = useRef<BotEngine | null>(null);
  const [frame, setFrame] = useState<BotFrame | null>(null);

  if (engineRef.current === null) {
    engineRef.current = new BotEngine(
      RAYON,
      entrance ? "swirl" : resolveState(state),
      SHAPE_BY_ID.get(DEFAULT_SHAPE)?.radii ?? null,
      null
    );
  }

  /* 入场未完成前，外部状态不进场（swirl 先播完）。stateRef 供 timeout 读取最新值。 */
  const entranceRef = useRef(!entrance);
  const stateRef = useRef(state);
  stateRef.current = state;

  /* 状态切换：引擎自己 morph，重复设置同值是 no-op。入场期间由 timeout 接管。 */
  useEffect(() => {
    if (!entranceRef.current) return;
    engineRef.current?.setState(resolveState(state), clockRef.current);
  }, [state]);

  /* 入场：swirl 播到 ~1.3s 后 morph 到（可能是最新的）目标状态。 */
  useEffect(() => {
    if (entranceRef.current) return;
    const t = setTimeout(() => {
      entranceRef.current = true;
      engineRef.current?.setState(resolveState(stateRef.current), clockRef.current);
    }, 1300);
    return () => clearTimeout(t);
  }, []);

  /* 指针跟随：记录相对屏幕中心的归一化坐标。 */
  useEffect(() => {
    if (!follow) return;
    const onMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    const onLeave = () => {
      pointerRef.current = null;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [follow]);

  /* rAF 时钟 + 注视 + 采样。 */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let raf = 0;
    let last = 0;
    const aim = () => {
      const box = svgRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return;
      if (!aimingRef.current) turnSinceRef.current = clockRef.current;
      const pointer = pointerRef.current;
      const halfW = Math.max(1, window.innerWidth / 2);
      const halfH = Math.max(1, window.innerHeight / 2);
      engine.setLook(
        lookTarget({
          nx: pointer ? clamp((pointer.x - (box.left + box.width / 2)) / halfW, -1, 1) : 0,
          ny: pointer ? clamp((pointer.y - (box.top + box.height / 2)) / halfH, -1, 1) : 0,
          tour: easings.easeOutQuint(clamp((clockRef.current - turnSinceRef.current) / TURN_TIME)),
          pointer: pointer !== null
        }),
        clockRef.current
      );
      aimingRef.current = true;
    };
    const step = (now: number) => {
      const dt = last ? clamp((now - last) / 1000, 0, 0.1) : 0;
      last = now;
      clockRef.current += dt;
      if (follow) aim();
      setFrame(engine.sample(clockRef.current));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [follow]);

  if (!frame) {
    return <svg ref={svgRef} width={size} height={size} viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`} className={className} role="img" aria-label={LABEL_OF[state]} />;
  }

  const { ink, paper } = palette();

  const dotAttrs = (dot: BotFrame["dots"][number]) => {
    const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth));
    const common = { fill, opacity: dot.opacity };
    return dot.d
      ? {
          ...common,
          d: dot.d,
          transform: `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${RAYON})`
        }
      : { ...common, cx: dot.x, cy: dot.y, r: dot.r };
  };

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      className={className}
      role="img"
      aria-label={LABEL_OF[state]}
    >
      <defs>
        {/* 眼睛是真正打穿身体的孔：裁切由 mask 完成，出界自动裁剪。 */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch && <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={gradId(arc.id)}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((c, i, stops) => (
              <stop key={i} offset={i / (stops.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        ))}
      </defs>

      {/* 后半环：先画，被身体遮住。 */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path key={`b${arc.id}`} d={arc.back} stroke={`url(#${gradId(arc.id)})`} strokeWidth={arc.width} opacity={arc.opacity} />
        ))}
      </g>

      {/* 爆散态粒子：画在身体后面。 */}
      {frame.dotsBehind && (
        <g>
          {frame.dots.map((dot, i) =>
            dot.d ? (
              <path key={`pb${i}`} {...dotAttrs(dot)} />
            ) : (
              <circle key={`pb${i}`} {...dotAttrs(dot)} />
            )
          )}
        </g>
      )}

      {/* 身体：paper 衬底（眼睛孔洞透出的颜色）+ ink 填充。 */}
      <g opacity={frame.bodyAlpha}>
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>

      {/* 前侧粒子。 */}
      {!frame.dotsBehind && (
        <g>
          {frame.dots.map((dot, i) =>
            dot.d ? (
              <path key={`pf${i}`} {...dotAttrs(dot)} />
            ) : (
              <circle key={`pf${i}`} {...dotAttrs(dot)} />
            )
          )}
        </g>
      )}

      {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />}

      {/* 前半环。 */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path key={`f${arc.id}`} d={arc.front} stroke={`url(#${gradId(arc.id)})`} strokeWidth={arc.width} opacity={arc.opacity} />
        ))}
      </g>
    </svg>
  );
}
