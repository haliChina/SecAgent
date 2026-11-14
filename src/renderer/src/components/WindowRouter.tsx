import { lazy, Suspense } from "react";
import { WindowErrorBoundary } from "./ErrorBoundary.js";
import { WindowControls } from "./WindowControls.js";

const ChatApp = lazy(() => import("../App.js").then((module) => ({ default: module.App })));
const SettingsApp = lazy(() => import("./SettingsApp.js").then((module) => ({ default: module.SettingsApp })));
const WakeOverlay = lazy(() => import("./WakeOverlay.js").then((module) => ({ default: module.WakeOverlay })));
const VoiceWakeListener = lazy(() => import("./VoiceWakeListener.js").then((module) => ({ default: module.VoiceWakeListener })));

export function WindowRouter() {
  const route = new URLSearchParams(window.location.search);
  const settings = route.has("settings");
  const wake = route.has("wake") || route.has("voice-wake");
  const content = settings ? <SettingsApp /> : route.has("wake") ? <WakeOverlay /> : route.has("voice-wake") ? <VoiceWakeListener /> : <ChatApp />;

  // 独立窗口不再先执行聊天页和所有可视化依赖；主进程仍拥有窗口及 IPC 生命周期。
  return <>
    {!wake && <WindowControls />}
    <WindowErrorBoundary crashTitle={settings ? "设置页遇到错误" : "界面遇到错误"} windowTitle={settings ? "SecAgent设置" : undefined}>
      <Suspense fallback={<main className="window-loading" role="status">正在加载{settings ? "设置" : "界面"}…</main>}>
        {content}
      </Suspense>
    </WindowErrorBoundary>
  </>;
}
