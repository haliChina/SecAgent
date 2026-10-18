/**
 * 联网搜索工具（R62）——Pi 内置 `web_search` 的后端。
 *
 * API 兼容两家（按参考文档逐字段实现，载荷归一化后统一返回）：
 *  - 智谱 BigModel 工具 API：POST https://open.bigmodel.cn/api/paas/v4/web_search
 *    body { search_query, search_engine: "search_std", search_intent: false, count }
 *    响应 { search_result: [{ title, content, link, media, icon, refer, publish_date }] }
 *    （docs.bigmodel.cn → 工具 API → 网络搜索）
 *  - DeepSeek 网页搜索：POST https://api.deepseek.com/v1/tools/search
 *    body { query, count, need_content: false }
 *    响应 { results: [{ title, url, snippet, summary, content, site_name, site_icon, date }] }
 *    （api-docs.deepseek.com/zh-cn/api/search）
 *
 * 密钥沿用应用的 env 隔离约定（.env，与模型 provider 一致）：
 *  - BigModel：ZAI_API_KEY / BIGMODEL_API_KEY / GLM_API_KEY / ZHIPU_API_KEY（任一）
 *  - DeepSeek：DEEPSEEK_API_KEY
 *  - 官方中继（SECTL_OFFICIAL_TOKEN + SECTL_OFFICIAL_API_URL）：可选——若中继
 *    已配置且提供搜索端点则优先（登录用户零配置），失败静默回落直连 API。
 */
export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  siteName: string | null;
  siteIcon: string | null;
  publishDate: string | null;
}

export interface WebSearchOutcome {
  provider: "official" | "bigmodel" | "deepseek" | "local";
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
    siteIcon: typeof item.site_icon === "string" ? item_site_icon(item) : null,
    publishDate: typeof item.date === "string" ? item.date : null
  })).filter((hit) => hit.url);
}

function item_site_icon(item: Record<string, unknown>): string {
  return typeof item.site_icon === "string" ? item.site_icon : "";
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
    const hits: WebSearchHit[] = [];
    /* b_algo 卡片：h2>a（标题+链接），.b_caption p（摘要）。正则解析刻意
       保守——解析不到就返回空数组让上层报可读错误，绝不抛半截数据。 */
    const card = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
    let match: RegExpExecArray | null;
    while ((match = card.exec(html)) !== null && hits.length < count) {
      const block = match[1];
      const link = /<h2[^>]*><a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/.exec(block);
      if (!link) continue;
      const strip = (value: string): string => value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
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

/** 执行一次联网搜索；提供方可用的按 官方中继 → BigModel → DeepSeek 顺序。 */
export async function runWebSearch(query: string, count = 6): Promise<WebSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length > 128) throw new Error("搜索词须为 1～128 个字符。");
  const capped = Math.max(1, Math.min(MAX_COUNT, Math.round(count) || 6));

  const officialToken = envKey("SECTL_OFFICIAL_TOKEN");
  const officialBase = envKey("SECTL_OFFICIAL_API_URL");
  if (officialToken && officialBase) {
    try {
      const base = officialBase.replace(/\/+$/, "");
      const payload = await postJson(`${base}/v1/tools/search`, officialToken, { query: trimmed, count: capped });
      const hits = hitsFromDeepSeek(payload);
      if (hits.length) return { provider: "official", query: trimmed, hits };
    } catch {
      /* 官方中继失败（未开通搜索/网络）→ 落到直连 API。 */
    }
  }

  const bigModelKey = envKey("ZAI_API_KEY", "BIGMODEL_API_KEY", "GLM_API_KEY", "ZHIPU_API_KEY");
  if (bigModelKey) {
    const payload = await postJson("https://open.bigmodel.cn/api/paas/v4/web_search", bigModelKey, {
      search_query: trimmed,
      search_engine: "search_std",
      search_intent: false,
      count: capped
    });
    const hits = hitsFromBigModel(payload);
    if (hits.length) return { provider: "bigmodel", query: trimmed, hits };
  }

  const deepSeekKey = envKey("DEEPSEEK_API_KEY");
  if (deepSeekKey) {
    const payload = await postJson("https://api.deepseek.com/v1/tools/search", deepSeekKey, { query: trimmed, count: capped });
    const hits = hitsFromDeepSeek(payload);
    if (hits.length) return { provider: "deepseek", query: trimmed, hits };
  }

  /* 自研兜底：零密钥时（以及所有配置层失败时）本地抓取 Bing 结果页。
     失败则抛聚合的可读错误。 */
  try {
    const hits = await localBingSearch(trimmed, capped);
    if (hits.length) return { provider: "local", query: trimmed, hits };
  } catch {
    /* 本地抓取失败 → 统一错误。 */
  }

  const configured = [officialToken && "官方中继", bigModelKey && "BigModel", deepSeekKey && "DeepSeek"].filter(Boolean);
  throw new Error(
    configured.length
      ? "各搜索服务均未返回结果（额度耗尽或网络受限），已尝试本地抓取也未命中；可稍后重试。"
      : "搜索失败：本地抓取未命中。要更稳定的结果，可在 .env 配置 ZAI_API_KEY（智谱）或 DEEPSEEK_API_KEY 后重启。"
  );
}
