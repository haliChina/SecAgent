/**
 * SecAgent 官方服务 IPC 域（B2 自 main.ts 拆出，纯搬家）。
 *
 * 7 通道：official:status/balance/redeem/login/logout/oauth-login +
 * sectl:oauth-login。登录态存工作区 .env（SECTL_OFFICIAL_TOKEN 等），
 * 首次登录把官方 provider 追加进 settings.providers。
 */
import { ipcMain } from "electron";
import { DEFAULT_WORKSPACE, loadConfig, readSettings, saveSettings, writeWorkspaceEnv } from "../config.js";
import { runSectlOAuthFlow, type SectlOAuthResult } from "./oauth.js";

function officialProvider(baseUrl: string) {
  return { id: "sectl-official", name: "SecAgent 官方服务", preset: "custom", provider: "openai-responses" as const, apiKeyEnv: "SECTL_OFFICIAL_TOKEN", baseUrl: `${baseUrl}/v1`, endpoint: "/responses", maxTokens: 16384, models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }] };
}

export function registerOfficialIpc(): void {
  ipcMain.handle("official:status", () => { loadConfig(DEFAULT_WORKSPACE); return { loggedIn: Boolean(process.env.SECTL_OFFICIAL_TOKEN), email: process.env.SECTL_OFFICIAL_EMAIL || "" }; });
  ipcMain.handle("official:balance", async () => {
    loadConfig(DEFAULT_WORKSPACE);
    const token = process.env.SECTL_OFFICIAL_TOKEN;
    const baseUrl = (process.env.SECTL_OFFICIAL_API_URL || "").replace(/\/$/, "");
    if (!token || !baseUrl) return { points: null, balances: [], expired: false };
    const response = await fetch(`${baseUrl}/account`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({})) as { points?: number; point_balances?: Array<{ points?: number; expires_at?: string | null }>; detail?: string };
    if (response.status === 401) return { points: null, balances: [], expired: true };
    if (!response.ok || typeof payload.points !== "number") throw new Error(payload.detail || "无法获取 Points 余额");
    return { points: payload.points, balances: (payload.point_balances || []).filter((item) => typeof item.points === "number").map((item) => ({ points: item.points as number, expiresAt: item.expires_at ?? null })), expired: false };
  });
  ipcMain.handle("official:redeem", async (_event, code: string) => {
    loadConfig(DEFAULT_WORKSPACE);
    const token = process.env.SECTL_OFFICIAL_TOKEN;
    const baseUrl = (process.env.SECTL_OFFICIAL_API_URL || "").replace(/\/$/, "");
    if (!token || !baseUrl) throw new Error("尚未登录 SecAgent 官方服务");
    const response = await fetch(`${baseUrl}/redeem`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ code }) });
    const payload = await response.json().catch(() => ({})) as { points_added?: number; expires_at?: string | null; balance?: number; point_balances?: Array<{ points?: number; expires_at?: string | null }>; detail?: string };
    if (!response.ok || typeof payload.points_added !== "number") throw new Error(payload.detail || "兑换失败，请稍后重试");
    return { pointsAdded: payload.points_added, expiresAt: payload.expires_at ?? null, balance: typeof payload.balance === "number" ? payload.balance : null, balances: (payload.point_balances || []).filter((item) => typeof item.points === "number").map((item) => ({ points: item.points as number, expiresAt: item.expires_at ?? null })) };
  });
  ipcMain.handle("official:login", async (_event, email: string, password: string) => {
    loadConfig(DEFAULT_WORKSPACE);
    const baseUrl = (process.env.SECTL_OFFICIAL_API_URL || "").replace(/\/$/, "");
    if (!baseUrl) throw new Error("请先在 SecAgent 代码目录 .env 配置 SECTL_OFFICIAL_API_URL");
    const response = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, platform_id: process.env.SECTL_OFFICIAL_PLATFORM_ID || "secagent", client_id: process.env.SECTL_OFFICIAL_CLIENT_ID || "secagent-desktop" }) });
    const payload = await response.json().catch(() => ({})) as { access_token?: string; user?: { email?: string }; detail?: string };
    if (!response.ok || !payload.access_token) throw new Error(payload.detail || "SECTL 登录失败");
    writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_TOKEN", payload.access_token);
    writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_EMAIL", payload.user?.email || email);
    const current = readSettings(DEFAULT_WORKSPACE);
    const providers = current.providers.some((provider) => provider.id === "sectl-official") ? current.providers : [...current.providers, officialProvider(baseUrl)];
    return saveSettings(DEFAULT_WORKSPACE, { ...current, providers });
  });

  async function runSectlOAuthLogin(): Promise<SectlOAuthResult> {
    loadConfig(DEFAULT_WORKSPACE);
    return runSectlOAuthFlow();
  }

  ipcMain.handle("sectl:oauth-login", () => runSectlOAuthLogin());
  ipcMain.handle("official:oauth-login", async () => {
    loadConfig(DEFAULT_WORKSPACE);
    const relayUrl = (process.env.SECTL_OFFICIAL_API_URL || "").replace(/\/$/, "");
    const result = await runSectlOAuthFlow();
    writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_TOKEN", result.accessToken);
    writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_SECTL_TOKEN", "");
    writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_USER_ID", result.userId || "");
    writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_EMAIL", result.email || "SECTL 用户");
    const current = readSettings(DEFAULT_WORKSPACE);
    const providers = current.providers.some((provider) => provider.id === "sectl-official") ? current.providers : [...current.providers, officialProvider(relayUrl)];
    return saveSettings(DEFAULT_WORKSPACE, { ...current, providers });
  });
  ipcMain.handle("official:logout", () => { loadConfig(DEFAULT_WORKSPACE); writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_TOKEN", ""); writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_SECTL_TOKEN", ""); writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_USER_ID", ""); writeWorkspaceEnv(DEFAULT_WORKSPACE, "SECTL_OFFICIAL_EMAIL", ""); return { loggedIn: false }; });
}
