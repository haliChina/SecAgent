/**
 * R89：Windows 自绘窗口三键（仅 win32 渲染）。
 *
 * 原生 WCO 三键只能改颜色/高度，且永远覆盖在应用内容之上；改成无边框后由
 * 这里画按钮，触控目标 46×57，颜色走主题 token，主窗 close 仍走既有“关到
 * 托盘”逻辑。macOS 继续用原生 traffic lights，Linux 继续用 WCO。
 */
import { useEffect, useState } from "react";
import { Minus, Minimize2, Square, X } from "lucide-react";

export function WindowControls() {
  const bridge = window.secagent;
  const [maximized, setMaximized] = useState(false);
  const [custom, setCustom] = useState(false);

  useEffect(() => {
    if (!bridge || bridge.platform !== "win32") return;
    let alive = true;
    void bridge.windowControl("state").then((state: { isMaximized?: boolean; custom?: boolean }) => {
      if (!alive) return;
      setMaximized(Boolean(state?.isMaximized));
      setCustom(state?.custom !== false);
    }).catch(() => { if (alive) setCustom(true); });
    const off = bridge.onWindowMaximized((value: boolean) => { if (alive) setMaximized(value); });
    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("button, a, input, textarea, select")) return;
      if (!target.closest(".topbar, .settings-window-title")) return;
      void bridge.windowControl("toggle-maximize");
    };
    window.addEventListener("dblclick", onDoubleClick);
    return () => { alive = false; window.removeEventListener("dblclick", onDoubleClick); off(); };
  }, [bridge]);

  if (!bridge || bridge.platform !== "win32" || !custom) return null;

  return <div className="window-controls" aria-label="窗口控制">
    <button type="button" className="window-control-button" aria-label="最小化" title="最小化" onClick={() => { void bridge.windowControl("minimize"); }}>
      <Minus size={16} strokeWidth={1.8} aria-hidden />
    </button>
    <button type="button" className="window-control-button" aria-label={maximized ? "还原" : "最大化"} title={maximized ? "还原" : "最大化"} onClick={() => { void bridge.windowControl("toggle-maximize"); }}>
      {maximized ? <Minimize2 size={14} strokeWidth={1.8} aria-hidden /> : <Square size={13} strokeWidth={1.8} aria-hidden />}
    </button>
    <button type="button" className="window-control-button window-control-close" aria-label="关闭" title="关闭" onClick={() => { void bridge.windowControl("close"); }}>
      <X size={17} strokeWidth={1.8} aria-hidden />
    </button>
  </div>;
}