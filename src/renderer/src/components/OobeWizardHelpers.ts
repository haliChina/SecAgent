/**
 * OOBE 向导共享助手（B4 自 OobeWizard.tsx 拆出）。
 *
 * 版本兼容判定 / 伴随目标就绪判定 / 状态文案 / 阶段进度映射。
 * 逻辑逐字搬运，行为零变化；向导主体与插件卡片共用。
 */
export function latestCompatibleVersion(plugin: MarketplacePlugin | undefined, platform: NodeJS.Platform): MarketplaceVersion | undefined {
  const latest = plugin?.latest;
  return latest && latest.minHostApiVersion <= 1 && latest.platforms.includes(platform) ? latest : undefined;
}

export function isClassIslandTargetReady(target: ClassIslandInstallCandidate): boolean {
  return Boolean(target.installedPluginVersion && (!target.isRunning || target.pluginHealthy === true));
}

export function isSecRandomTargetReady(target: SecRandomInstallCandidate): boolean {
  return Boolean(target.installedPluginVersion && (!target.isRunning || target.pluginHealthy === true));
}

export function isIccceTargetReady(target: IccceInstallCandidate): boolean {
  return Boolean(target.installedPluginVersion && (!target.isRunning || target.pluginHealthy === true));
}

export function isClassWidgetsTargetReady(target: ClassWidgetsInstallCandidate): boolean {
  return Boolean(target.installedPluginVersion && (!target.isRunning || target.pluginHealthy === true));
}

export function companionPluginStatus(
  appName: string,
  target: { installedPluginVersion?: string; isRunning: boolean; pluginHealthy?: boolean }
): string {
  if (!target.installedPluginVersion) return `${appName} 端插件未安装`;
  if (target.isRunning && target.pluginHealthy === false) return `${appName} 端插件文件已安装，但当前进程尚未加载`;
  return `${appName} 端插件已安装 v${target.installedPluginVersion}`;
}

export function companionProgressForPhase(phase: string, appName: string, percent?: number): { value: number; label: string } {
  const value = Math.max(0, Math.min(100, percent ?? ({ downloading: 18, verifying: 38, installing: 62, closing: 72, restarting: 80 } as Record<string, number>)[phase] ?? 0));
  switch (phase) {
    case "downloading": return { value, label: `正在下载 ${appName} 端插件…` };
    case "verifying": return { value, label: `正在等待 ${appName} 插件响应…` };
    case "installing": return { value, label: `正在写入 ${appName} 端插件…` };
    case "closing": return { value, label: `正在关闭 ${appName}…` };
    case "restarting": return { value, label: `正在启动 ${appName}…` };
    default: return { value, label: `等待安装 ${appName} 端插件…` };
  }
}
