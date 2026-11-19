/**
 * 联网搜索工具（R62）——Pi 内置 `web_search` 的后端。
 *
 * R92 起按文档核对接入多家（载荷归一化后统一返回）：
 *  - 官方中继：POST {SECTL_OFFICIAL_API_URL}/v1/tools/search（登录用户）
 *  - 智谱 BigModel：POST https://open.bigmodel.cn/api/paas/v4/web_search
 *  - DeepSeek：POST https://api.deepseek.com/v1/tools/search
 *  - Tavily：POST https://api.tavily.com/search，Bearer tvly-…（docs.tavily.com）
 *  - Brave：GET https://api.search.brave.com/res/v1/web/search，X-Subscription-Token
 *  - Serper：POST https://google.serper.dev/search，X-API-KEY
 *  - Google CSE：GET https://www.googleapis.com/customsearch/v1?key&cx&q&num
 *  - 本地兜底：Bing 结果页抓取（反爬/ToS 风险，设置中可关）
 * 微软 Bing Web Search API 已于 2025-08 退役，不再作为可选接口。
 *
 * R63 增补：web_fetch（DeepSeek /v1/tools/fetch，返回 Markdown 正文）——
 * 第六轮 review 建议项；web_search 只给摘要，模型要读全文时用 fetch。
 *
 * 密钥沿用应用的 env 隔离约定（.env，与模型 provider 一致）：
 *  - BigModel：ZAI_API_KEY / BIGMODEL_API_KEY / GLM_API_KEY / ZHIPU_API_KEY（任一）
 *  - DeepSeek：DEEPSEEK_API_KEY
 *  - 官方中继（SECTL_OFFICIAL_TOKEN + SECTL_OFFICIAL_API_URL）：可选——若中继
 *    已配置且提供搜索端点则优先（登录用户零配置），失败静默回落直连 API。
 */
interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  siteName: string | null;
  siteIcon: string | null;
  publishDate: string | null;
}

import type { WebSearchProvider, WebSearchSettings } from "./types.js";

interface WebSearchOutcome {
  provider: "official" | "bigmodel" | "deepseek" | "tavily" | "brave" | "serper" | "google" | "local";
  query: string;
  hits: WebSearchHit[];
}

const TIMEOUT_MS = 20_000;
const MAX_COUNT = 10;

function envKey(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

async function postJson(url: string, token: string, body: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}：${text.slice(0, 300)}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`响应不是合法 JSON：${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** R92：支持自定义 method/headers 的通用 JSON 请求（Brave/Bing/Serper/Google 用）。 */
async function requestJson(url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: "application/json", ...(init.headers || {}) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(url, {
      method: init.method || "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}：${text.slice(0, 300)}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`响应不是合法 JSON：${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function siteNameOf(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

function hitsFromTavily(payload: unknown): WebSearchHit[] {
  const list = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => {
    const url = String(item.url ?? "");
    return {
      title: String(item.title ?? "无标题"),
      url,
      snippet: typeof item.content === "string" ? item.content.slice(0, 300) : "",
      siteName: siteNameOf(url),
      siteIcon: null,
      publishDate: typeof item.published_date === "string" ? item.published_date : null
    };
  }).filter((hit) => hit.url);
}

function hitsFromBrave(payload: unknown): WebSearchHit[] {
  const list = (payload as { web?: { results?: unknown } } | null)?.web?.results;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => {
    const url = String(item.url ?? "");
    const profile = item.profile && typeof item.profile === "object" ? item.profile as Record<string, unknown> : null;
    return {
      title: String(item.title ?? "无标题"),
      url,
      snippet: typeof item.description === "string" ? item.description.slice(0, 300) : "",
      siteName: profile && typeof profile.name === "string" ? profile.name : siteNameOf(url),
      siteIcon: null,
      publishDate: typeof item.age === "string" ? item.age : null
    };
  }).filter((hit) => hit.url);
}

function hitsFromSerper(payload: unknown): WebSearchHit[] {
  const list = (payload as { organic?: unknown } | null)?.organic;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => {
    const url = String(item.link ?? item.url ?? "");
    return {
      title: String(item.title ?? "无标题"),
      url,
      snippet: typeof item.snippet === "string" ? item.snippet.slice(0, 300) : "",
      siteName: siteNameOf(url),
      siteIcon: null,
      publishDate: typeof item.date === "string" ? item.date : null
    };
  }).filter((hit) => hit.url);
}

function hitsFromGoogle(payload: unknown): WebSearchHit[] {
  const list = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => {
    const url = String(item.link ?? "");
    return {
      title: String(item.title ?? "无标题"),
      url,
      snippet: typeof item.snippet === "string" ? item.snippet.slice(0, 300) : "",
      siteName: typeof item.displayLink === "string" ? item.displayLink : siteNameOf(url),
      siteIcon: null,
      publishDate: null
    };
  }).filter((hit) => hit.url);
}

/** BigModel 载荷 → 归一化命中列表。 */
function hitsFromBigModel(payload: unknown): WebSearchHit[] {
  const list = (payload as { search_result?: unknown } | null)?.search_result;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => ({
    title: String(item.title ?? "无标题"),
    url: String(item.link ?? item.url ?? ""),
    snippet: typeof item.content === "string" ? item.content.slice(0, 300) : "",
    siteName: typeof item.media === "string" ? item.media : null,
    siteIcon: typeof item.icon === "string" ? item.icon : null,
    publishDate: typeof item.publish_date === "string" ? item.publish_date : null
  })).filter((hit) => hit.url);
}

/** DeepSeek 载荷 → 归一化命中列表。 */
function hitsFromDeepSeek(payload: unknown): WebSearchHit[] {
  const list = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => ({
    title: String(item.title ?? "无标题"),
    url: String(item.url ?? ""),
    snippet: typeof item.snippet === "string" ? item.snippet : typeof item.summary === "string" ? item.summary.slice(0, 300) : "",
    siteName: typeof item.site_name === "string" ? item.site_name : null,
    siteIcon: item_site_icon(item),
    publishDate: typeof item.date === "string" ? item.date : null
  })).filter((hit) => hit.url);
}

function item_site_icon(item: Record<string, unknown>): string | null {
  return typeof item.site_icon === "string" && item.site_icon ? item.site_icon : null;
}

/** 自研兜底：直接抓取 Bing 网页版结果页并解析（零密钥、零配置）。
 *
 * 研判结论（R62，写入代码供后续维护者参考）：
 *  - 完全自研搜索（爬虫式）在技术上可行——Bing 大陆可直连、结果页结构
 *    相对稳定（li.b_algo 卡片）；但天然脆弱：反爬策略升级/页面改版会
 *    静默失效，且抓取公开搜索页在引擎 ToS 上灰色。定位只能是"兜底层"，
 *    不能当主力。
 *  - 主力应是官方中继（服务器侧聚合，登录用户零配置）与直连 API
 *    （.env 密钥，质量与稳定性最好）。分层回退让普通用户零配置可用，
 *    高级用户可自选升级。
 */
async function localBingSearch(query: string, count: number): Promise<WebSearchHit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=zh-CN&count=${count}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Bing HTTP ${response.status}`);
    const html = await response.text();
    /* 相关性校验：Bing 反爬/验证页也返回 200，但没有结果容器。无 b_results
       即视为拦截页，直接抛可读错误，不再静默返回空数组让上层误报"未命中"。 */
    if (!html.includes("b_results")) {
      throw new Error("Bing 返回了非结果页（验证/拦截页），本地抓取被反爬拦截");
    }
    const hits: WebSearchHit[] = [];
    /* b_algo 卡片：h2>a（标题+链接），.b_caption p（摘要）。正则解析刻意
       保守——解析不到就返回空数组让上层报可读错误，绝不抛半截数据。 */
    const card = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
    let match: RegExpExecArray | null;
    while ((match = card.exec(html)) !== null && hits.length < count) {
      const block = match[1];
      const link = /<h2[^>]*><a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/.exec(block);
      if (!link) continue;
      /* 实体解码顺序：先具名/数字实体，最后 &amp;，避免 "&amp;#39;" 被二次解码。
         数字实体过滤孤立代理项（0xD800–0xDFFF，fromCodePoint 不抛但会产生非法字符）。 */
      const strip = (value: string): string => {
        const decodeNumeric = (code: number): string => (code > 0 && code < 0x110000 && !(code >= 0xD800 && code <= 0xDFFF) ? String.fromCodePoint(code) : "");
        return value
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/gi, " ")
          .replace(/&quot;/g, "\"")
          .replace(/&#0?39;/g, "'")
          .replace(/&#x27;/gi, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#(\d+);/g, (_m, digits: string) => decodeNumeric(Number(digits)))
          .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => decodeNumeric(parseInt(hex, 16)))
          .replace(/&amp;/g, "&")
          .trim();
      };
      const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/.exec(block);
      let host: string | null = null;
      try { host = new URL(link[1]).hostname; } catch { host = null; }
      hits.push({
        title: strip(link[2]),
        url: link[1],
        snippet: snippetMatch ? strip(snippetMatch[1]).slice(0, 300) : "",
        siteName: host,
        siteIcon: null,
        publishDate: null
      });
    }
    return hits;
  } finally {
    clearTimeout(timer);
  }
}

/** 执行一次联网搜索。R91：设置可选择供应商/回退/条数；默认保持原有自动链。 */
export async function runWebSearch(query: string, count = 6, settings?: WebSearchSettings): Promise<WebSearchOutcome> {
  if (settings?.enabled === false) throw new Error("联网搜索已在设置中关闭。");
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 128) throw new Error("搜索词须为 1～128 个字符。");
  const requested = Math.max(1, Math.min(MAX_COUNT, Math.round(count) || 6));
  const capped = Math.max(1, Math.min(requested, settings?.maxResults ?? MAX_COUNT));

  const officialToken = envKey("SECTL_OFFICIAL_TOKEN");
  const officialBase = envKey("SECTL_OFFICIAL_API_URL");
  const bigModelKey = envKey("ZAI_API_KEY", "BIGMODEL_API_KEY", "GLM_API_KEY", "ZHIPU_API_KEY");
  const deepSeekKey = envKey("DEEPSEEK_API_KEY");
  const tavilyKey = envKey("TAVILY_API_KEY");
  const braveKey = envKey("BRAVE_SEARCH_API_KEY");
  const serperKey = envKey("SERPER_API_KEY");
  const googleKey = envKey("GOOGLE_SEARCH_KEY", "GOOGLE_API_KEY");
  const googleCx = envKey("GOOGLE_SEARCH_CX", "GOOGLE_CSE_CX");
  const localAllowed = settings?.localFallback !== false;

  const runProvider = async (provider: WebSearchProvider): Promise<WebSearchHit[]> => {
    if (provider === "official") {
      if (!officialToken || !officialBase) throw new Error("官方中继未登录或未配置搜索地址");
      const base = officialBase.replace(/\/+$/, "");
      const payload = await postJson(`${base}/v1/tools/search`, officialToken, { query: trimmed, count: capped });
      return hitsFromDeepSeek(payload);
    }
    if (provider === "bigmodel") {
      if (!bigModelKey) throw new Error("未配置智谱 BigModel API Key");
      const payload = await postJson("https://open.bigmodel.cn/api/paas/v4/web_search", bigModelKey, {
        search_query: trimmed,
        search_engine: "search_std",
        search_intent: false,
        count: capped
      });
      return hitsFromBigModel(payload);
    }
    if (provider === "deepseek") {
      if (!deepSeekKey) throw new Error("未配置 DeepSeek API Key");
      const payload = await postJson("https://api.deepseek.com/v1/tools/search", deepSeekKey, { query: trimmed, count: capped });
      return hitsFromDeepSeek(payload);
    }
    if (provider === "tavily") {
      if (!tavilyKey) throw new Error("未配置 TAVILY_API_KEY");
      const payload = await postJson("https://api.tavily.com/search", tavilyKey, { query: trimmed, max_results: capped, search_depth: "basic", include_answer: false, include_raw_content: false, include_published_date: true });
      return hitsFromTavily(payload);
    }
    if (provider === "brave") {
      if (!braveKey) throw new Error("未配置 BRAVE_SEARCH_API_KEY");
      const payload = await requestJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(trimmed)}&count=${capped}`, { headers: { "X-Subscription-Token": braveKey } });
      return hitsFromBrave(payload);
    }
    if (provider === "serper") {
      if (!serperKey) throw new Error("未配置 SERPER_API_KEY");
      const payload = await requestJson("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": serperKey }, body: { q: trimmed, num: capped } });
      return hitsFromSerper(payload);
    }
    if (provider === "google") {
      if (!googleKey || !googleCx) throw new Error("未配置 GOOGLE_SEARCH_KEY / GOOGLE_SEARCH_CX");
      const payload = await requestJson(`https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googleKey)}&cx=${encodeURIComponent(googleCx)}&q=${encodeURIComponent(trimmed)}&num=${capped}`);
      return hitsFromGoogle(payload);
    }
    if (provider === "local") {
      if (!localAllowed) throw new Error("本地网页抓取兜底已在设置中关闭");
      return await localBingSearch(trimmed, capped);
    }
    throw new Error(`未知搜索服务：${provider}`);
  };

  const defaultOrder: WebSearchProvider[] = ["official", "bigmodel", "deepseek", "tavily", "brave", "serper", "google", "local"];
  const configured = new Set<WebSearchProvider>();
  if (officialToken && officialBase) configured.add("official");
  if (bigModelKey) configured.add("bigmodel");
  if (deepSeekKey) configured.add("deepseek");
  if (tavilyKey) configured.add("tavily");
  if (braveKey) configured.add("brave");
  if (serperKey) configured.add("serper");
  if (googleKey && googleCx) configured.add("google");
  if (localAllowed) configured.add("local");

  const selected = settings?.provider && settings.provider !== "auto" ? settings.provider : undefined;
  const chain: WebSearchProvider[] = selected
    ? [selected, ...(settings?.fallback !== false ? defaultOrder.filter((id) => id !== selected) : [])]
    : defaultOrder;

  const attempted: string[] = [];
  for (const provider of chain) {
    if (provider === "auto") continue;
    if (!configured.has(provider)) {
      attempted.push(`${provider}（未配置）`);
      continue;
    }
    attempted.push(provider);
    try {
      const hits = await runProvider(provider);
      if (hits.length) return { provider, query: trimmed, hits };
      attempted[attempted.length - 1] = `${provider}（空结果）`;
    } catch (error) {
      attempted[attempted.length - 1] = `${provider}（${error instanceof Error ? error.message : String(error)}）`;
    }
  }

  if (selected && settings?.fallback === false) {
    throw new Error(`${selected} 搜索失败：${attempted[attempted.length - 1] || "未配置"}。可打开“失败时自动换下一个服务”。`);
  }
  if (!configured.size) {
    throw new Error("没有可用的联网搜索服务：请登录官方服务、在设置中填写 BigModel/DeepSeek Key，或打开“本地网页抓取兜底”。");
  }
  throw new Error(`联网搜索未返回结果，已尝试：${attempted.join(" → ")}。`);
}

interface WebFetchOutcome {
  provider: "deepseek" | "local";
  url: string;
  title: string;
  content: string;
}

/** 网页抓取（R63）：DeepSeek /v1/tools/fetch 优先（Markdown 正文，文档核对：
 *  body { url }，响应 { title, content }；url 须含 host 的 http(s) 且不带凭据，
 *  ≤8192 字符）；无密钥时本地直抓 HTML 去标签兜底（粗文本，仅供模型阅读）。 */
export async function runWebFetch(rawUrl: string): Promise<WebFetchOutcome> {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url) || url.length > 8192) throw new Error("web_fetch 需要合法的 http(s) 链接（≤8192 字符）。");
  try { if (new URL(url).username || new URL(url).password) throw new Error("链接不能携带用户名或密码。"); } catch (error) {
    if (error instanceof TypeError) throw new Error("链接格式不合法。");
    throw error;
  }

  const deepSeekKey = envKey("DEEPSEEK_API_KEY");
  if (deepSeekKey) {
    try {
      const payload = await postJson("https://api.deepseek.com/v1/tools/fetch", deepSeekKey, { url });
      const title = String((payload as { title?: unknown } | null)?.title ?? "");
      const content = String((payload as { content?: unknown } | null)?.content ?? "");
      if (content) return { provider: "deepseek", url, title, content: content.slice(0, 120_000) };
    } catch {
      /* DeepSeek 失败（额度/网络）→ 本地兜底。 */
    }
  }

  /* 本地兜底：直接抓 HTML，剥脚本/样式/标签出粗文本。超时与 web_search 共用。 */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "zh-CN,zh;q=0.9" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = (await response.text()).slice(0, 2_000_000);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
    if (!text) throw new Error("页面无正文（可能被反爬或为纯脚本渲染页）。");
    return { provider: "local", url, title, content: text.slice(0, 120_000) };
  } finally {
    clearTimeout(timer);
  }
}
