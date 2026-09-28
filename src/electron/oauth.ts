/**
 * Shared SECTL OAuth (PKCE) login flow.
 *
 * Extracted from the two near-identical copies that used to live in
 * `main.ts` (the plugin-manager login and the settings-page login). Both
 * callers now run the same flow; the settings page additionally persists the
 * returned tokens to the workspace.
 */
import { createServer } from "node:http";
import { isIPv4 } from "node:net";
import crypto from "node:crypto";
import { shell } from "electron";

const PUBLIC_IP_ENDPOINTS = [
  "https://api.ipify.org?format=json",
  "https://httpbin.org/ip",
  "https://api64.ipify.org?format=json"
];

export interface SectlOAuthResult {
  accessToken: string;
  userId?: string;
  email?: string;
  name?: string;
}

async function resolvePublicIpv4(): Promise<string> {
  for (const endpoint of PUBLIC_IP_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) continue;
      const payload = await response.json().catch(() => ({})) as { ip?: unknown; origin?: unknown };
      const candidate = String(payload.ip ?? payload.origin ?? "").split(",")[0].trim();
      if (isIPv4(candidate)) return candidate;
    } catch {
      // Try the next public-IP provider.
    }
  }
  throw new Error("无法获取本机公网 IPv4，请检查网络连接后重试");
}

/**
 * Run the full OAuth authorization-code + PKCE flow against the SECTL relay
 * and return the relay session tokens. Rejects with a readable error when any
 * step fails.
 */
export async function runSectlOAuthFlow(): Promise<SectlOAuthResult> {
  const relayUrl = (process.env.SECTL_OFFICIAL_API_URL || "").replace(/\/$/, "");
  const oauthUrl = (process.env.SECTL_OAUTH_API_URL || "https://appwrite.sectl.cn").replace(/\/$/, "");
  const oauthWebUrl = (process.env.SECTL_OAUTH_WEB_URL || "https://sectl.cn").replace(/\/$/, "");
  const clientId = process.env.SECTL_OFFICIAL_CLIENT_ID || "";
  const port = Number(process.env.SECTL_OAUTH_CALLBACK_PORT || 49152);
  if (!relayUrl) throw new Error("请在 SecAgent .env 配置 SECTL_OFFICIAL_API_URL");
  if (!clientId) throw new Error("请在 SecAgent .env 配置 SECTL_OFFICIAL_CLIENT_ID");
  if (!Number.isInteger(port) || port < 49152 || port > 65535) throw new Error("SECTL_OAUTH_CALLBACK_PORT 必须是 49152-65535 的固定端口");
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(`${oauthWebUrl}/oauth/authorize`);
  authorize.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "user:read", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  const callback = await new Promise<{ code: string }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/oauth/callback") { response.writeHead(404); response.end("Not found"); return; }
      if (url.searchParams.get("state") !== state) { response.writeHead(400); response.end("Invalid state"); reject(new Error("OAuth state 校验失败")); server.close(); return; }
      const error = url.searchParams.get("error");
      if (error) { response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }); response.end("<h2>登录未完成，请返回 SecAgent 重试。</h2>"); reject(new Error(url.searchParams.get("error_description") || error)); server.close(); return; }
      const code = url.searchParams.get("code");
      if (!code) { response.writeHead(400); response.end("Missing code"); reject(new Error("OAuth 回调缺少 code")); server.close(); return; }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end("<h2>SecAgent 登录成功，可以关闭此页面。</h2>"); resolve({ code }); server.close();
    });
    server.on("error", (error) => reject(new Error(`无法监听 OAuth 回调端口 ${port}: ${error.message}`)));
    server.listen(port, "127.0.0.1", () => { void shell.openExternal(authorize.toString()); });
    setTimeout(() => { server.close(); reject(new Error("OAuth 登录超时，请重试")); }, 5 * 60 * 1000).unref();
  });
  const ipAddress = await resolvePublicIpv4();
  const tokenResponse = await fetch(`${oauthUrl}/api/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code: callback.code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, device_uuid: crypto.randomUUID(), ip_address: ipAddress }) });
  const tokenPayload = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error_description?: string };
  if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error_description || "SECTL OAuth 换取令牌失败");
  const relayResponse = await fetch(`${relayUrl}/auth/oauth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: tokenPayload.access_token, client_id: clientId, platform_id: process.env.SECTL_OFFICIAL_PLATFORM_ID || clientId }) });
  const relayPayload = await relayResponse.json().catch(() => ({})) as { access_token?: string; user?: { id?: string; email?: string; name?: string }; detail?: string };
  if (!relayResponse.ok || !relayPayload.access_token) throw new Error(relayPayload.detail || "官方服务 OAuth 登录失败");
  return { accessToken: relayPayload.access_token, userId: relayPayload.user?.id, email: relayPayload.user?.email, name: relayPayload.user?.name };
}
