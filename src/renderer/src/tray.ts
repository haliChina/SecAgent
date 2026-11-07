/**
 * 托盘气泡菜单（替代原生右键菜单）。
 *
 * 原生菜单只能跟随系统样式；这里换成无边框小窗，面板与主应用共用
 * 同一套配色和字号，并带当前窗口状态（主窗可见时显示「隐藏主窗口」）。
 *
 * 刻意不引 React / 图标库：256px 的小窗只需要几行 DOM，避免把
 * 设置页那几百 KB 的共享 chunk 拖进托盘弹出路径。
 */
import "./tray.css";

const params = new URLSearchParams(window.location.search);
const isMac = params.get("platform") === "darwin";
const version = params.get("version") || "";
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";

type TrayAction = "show-main" | "hide-main" | "open-settings" | "restart" | "quit";

const ICONS: Record<string, string> = {
  window: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  restart: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>'
};

function icon(name: keyof typeof ICONS | string): string {
  return `<span class="tray-item-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg></span>`;
}

function item(action: TrayAction, iconName: string, label: string, options: { hint?: string; danger?: boolean } = {}): string {
  return `<button type="button" role="menuitem" class="${options.danger ? "tray-item tray-item-danger" : "tray-item"}" data-action="${action}">${icon(iconName)}<span class="tray-item-label">${label}</span>${options.hint ? `<span class="tray-item-hint">${options.hint}</span>` : ""}</button>`;
}

function render(mainVisible: boolean): void {
  const root = document.getElementById("tray-root");
  if (!root) return;
  root.innerHTML = `
    <main class="tray-panel">
      <header class="tray-head">
        <div class="tray-id">
          <img class="tray-mark" src="./icon.png" alt="" aria-hidden="true" />
          <strong>SecAgent</strong>
          <span class="tray-state"><i></i>运行中</span>
        </div>
        ${version ? `<small class="tray-version">v${version}</small>` : ""}
      </header>
      <div class="tray-list" role="menu">
        ${mainVisible
          ? item("hide-main", "eyeOff", "隐藏主窗口")
          : item("show-main", "window", "打开主窗口")}
        ${item("open-settings", "settings", "打开设置", { hint: isMac ? "⌘," : "Ctrl+," })}
        <span class="tray-divider" role="separator"></span>
        ${item("restart", "restart", "重启应用")}
        ${item("quit", "power", "退出应用", { danger: true })}
      </div>
    </main>`;
}

render(false);
void window.secagentTray.state().then((state) => render(state.mainVisible)).catch(() => undefined);

document.getElementById("tray-root")?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  const action = button?.dataset.action as TrayAction | undefined;
  if (action) void window.secagentTray.run(action);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.secagentTray.close();
});
