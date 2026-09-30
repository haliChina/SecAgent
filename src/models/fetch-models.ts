/**
 * Fetch the model catalogue of an OpenAI-compatible endpoint —
 * `GET {baseUrl}/models` — so the settings UI can offer live lists instead of
 * hand-typed model ids.
 *
 * Verified sources:
 *   MiMo:    GET https://api.xiaomimimo.com/v1/models → { object:"list", data:[{id,…}] }
 *            (auth: `api-key: $MIMO_API_KEY` or `Authorization: Bearer`)
 *   OpenAI-compatible relays: GET {base}/models with `Authorization: Bearer`.
 *
 * `baseUrl` must already include the version segment (`…/v1`), exactly like
 * the provider base URLs used for chat/completions.
 */
export interface RemoteModel {
  id: string;
  ownedBy?: string;
}

export interface RemoteModelsResult {
  ok: boolean;
  message: string;
  models: RemoteModel[];
}

export async function fetchProviderModels(request: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<RemoteModelsResult> {
  const base = (request.baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return { ok: false, message: "Base URL 为空", models: [] };
  if (!request.apiKey) return { ok: false, message: "API Key 未配置（请先填写并保存）", models: [] };
  const fetchImpl = request.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 20000);
  try {
    const response = await fetchImpl(`${base}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${request.apiKey}`, "api-key": request.apiKey },
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, message: `HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ""}`, models: [] };
    }
    const json = (await response.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
    const models = Array.isArray(json.data)
      ? json.data.filter((entry) => typeof entry?.id === "string" && entry.id).map((entry) => ({ id: entry.id as string, ownedBy: entry.owned_by }))
      : [];
    models.sort((a, b) => a.id.localeCompare(b.id));
    return { ok: true, message: `获取到 ${models.length} 个模型`, models };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `请求失败：${message.includes("aborted") ? "超时" : message}`, models: [] };
  } finally {
    clearTimeout(timer);
  }
}
