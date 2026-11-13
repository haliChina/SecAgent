const excludedModelPattern = /(?:image|tts|audio|robotics|computer[-_ ]?use|deep[-_ ]?research|research|agent|customtools|embedding|live|veo|lyria|imagen|banana)/i;
/** Gemini exposes many modality- and task-specific models; SecAgent is a text/tool agent. */
export function isCommonGeminiTextModel(model) {
    const name = model.name?.replace(/^models\//, "") || "";
    return /^gemini-/i.test(name) && !excludedModelPattern.test(name) && !excludedModelPattern.test(model.displayName || "");
}
export async function listGoogleModels(apiKey, baseUrl = "https://generativelanguage.googleapis.com/v1beta") {
    if (!apiKey.trim())
        throw new Error("请先填写 Google AI Studio API Key");
    const models = [];
    let pageToken = "";
    do {
        const query = new URLSearchParams({ pageSize: "1000" });
        if (pageToken)
            query.set("pageToken", pageToken);
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models?${query}`, {
            headers: { "x-goog-api-key": apiKey },
            signal: AbortSignal.timeout(30_000)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401 || response.status === 403)
                throw new Error("Google Gemini 鉴权失败，请检查 Google AI Studio API Key。");
            throw new Error(`获取 Google Gemini 模型失败（${response.status}）：${payload.error?.message || "请检查 Base URL"}`);
        }
        models.push(...(payload.models || []));
        pageToken = payload.nextPageToken || "";
    } while (pageToken);
    return models.filter((model) => model.name && model.supportedGenerationMethods?.includes("generateContent") && isCommonGeminiTextModel(model));
}
