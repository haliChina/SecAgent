/**
 * VoicePill (reactbits.dev voice-pill) — 录音电平 pill。
 *
 * 真源为 react-bits ts-tailwind 版；此处为应用适配版（模拟电平，真实
 * 录音由宿主接线）。P3 重写：样式随组件走（同目录 voice-pill.css），
 * 不再依赖全局 styles.css；文件瘦身只保留实际依赖（零 import）。
 * 波形动画尊重 prefers-reduced-motion。
 */
import "./voice-pill.css";

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
