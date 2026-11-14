import { normalizePluginPanelStatus, type PluginPanelStatus, type PluginSettingPanel } from "./plugin-settings.js";

/** 轮询与操作后的刷新共用顺序门；迟到响应不能覆盖更新的面板状态。 */
export function createPanelStatusReader(load: (panel: PluginSettingPanel) => Promise<unknown>, publish: (id: string, status: PluginPanelStatus) => void) {
  const latest = new Map<string, symbol>();
  let disposed = false;
  return {
    async read(panel: PluginSettingPanel): Promise<void> {
      if (disposed) return;
      const request = Symbol();
      latest.set(panel.id, request);
      const raw = await load(panel);
      if (!disposed && latest.get(panel.id) === request) publish(panel.id, normalizePluginPanelStatus(raw));
    },
    dispose(): void { disposed = true; latest.clear(); }
  };
}
