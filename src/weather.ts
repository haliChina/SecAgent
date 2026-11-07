import type { AgentTool } from "./model-provider.js";

/**
 * Weather lookup using the same Xiaomi Weather endpoint as ClassIsland
 * (`/wtr-v3/location/city/*` + `/wtr-v3/weather/all`). The endpoint needs no
 * per-user credential; results stay in a compact shape the model can read
 * without spending a web-search round trip.
 */
const HOST = "https://weatherapi.market.xiaomi.com";
const APP_KEY = "weather20151024";
const SIGN = "zUFJoAR2ZVrDy1vF3D07";
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_DAYS = 3;
const MAX_DAYS = 5;

/** ClassIsland's default: Beijing, so an omitted city still answers usefully. */
const DEFAULT_CITY: CityInfo = { locationKey: "weathercn:101010100", name: "北京市", affiliation: "北京, 中国", latitude: "39.9042", longitude: "116.4074" };

/** Xiaomi weather codes, mirrored from ClassIsland's xiaomi_weather_status.json. */
const WEATHER_CODES: Record<number, string> = {
  0: "晴", 1: "多云", 2: "阴", 3: "阵雨", 4: "雷阵雨", 5: "雷阵雨并伴有冰雹", 6: "雨夹雪", 7: "小雨", 8: "中雨",
  9: "大雨", 10: "暴雨", 11: "大暴雨", 12: "特大暴雨", 13: "阵雪", 14: "小雪", 15: "中雪", 16: "大雪", 17: "暴雪",
  18: "雾", 19: "冻雨", 20: "沙尘暴", 21: "小雨-中雨", 22: "中雨-大雨", 23: "大雨-暴雨", 24: "暴雨-大暴雨",
  25: "大暴雨-特大暴雨", 26: "小雪-中雪", 27: "中雪-大雪", 28: "大雪-暴雪", 29: "浮尘", 30: "扬沙", 31: "强沙尘暴",
  32: "飑", 33: "龙卷风", 34: "弱高吹雪", 35: "轻雾", 53: "霾", 301: "雨", 302: "雪", 99: "未知"
};

interface CityInfo {
  locationKey: string;
  name: string;
  affiliation: string;
  latitude: string;
  longitude: string;
}

interface WeatherForecast {
  city: string;
  region: string;
  cityId: string;
  updatedAt?: string;
  current: {
    condition: string;
    temperature: string;
    feelsLike: string;
    humidity: string;
    wind: string;
    pressure: string;
    visibility?: string;
    uvIndex?: string;
    aqi?: string;
    publishedAt?: string;
  };
  forecast: Array<{ date: string; label: string; condition: string; temperature: string; precipitationProbability: string }>;
  alerts: Array<{ title: string; level?: string; detail?: string }>;
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const weatherTool: AgentTool = {
  key: "weather",
  description: "查询城市实时天气和未来 1～5 天预报（小米天气，与 ClassIsland 同源）。city 支持城市名（如 杭州）或 ClassIsland 城市 ID / 城市编码（如 weathercn:101010100 或 101010100）；不填默认北京。回答天气、气温、降雨、空气质量等问题前先调用本工具，不要凭记忆作答。",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      city: { type: "string", description: "城市名或城市 ID；默认北京" },
      days: { type: "integer", minimum: 1, maximum: MAX_DAYS, description: "预报天数，默认 3" }
    }
  }
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}

function unitPair(value: unknown): string {
  const pair = record(value);
  const amount = text(pair?.value);
  return amount ? `${amount}${text(pair?.unit)}` : "—";
}

function weatherLabel(code: unknown): string {
  const raw = text(code).trim();
  if (!raw) return "未知";
  return WEATHER_CODES[Number(raw)] || "未知";
}

function windDirection(value: unknown): string {
  const raw = text(record(value)?.value).trim();
  if (!raw) return "";
  const degrees = Number(raw);
  if (!Number.isFinite(degrees)) return "";
  const names = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return `${names[Math.round(degrees / 45) % 8]}风`;
}

function aqiLevel(aqi: number): string {
  if (!Number.isFinite(aqi)) return "";
  if (aqi <= 50) return "优";
  if (aqi <= 100) return "良";
  if (aqi <= 150) return "轻度污染";
  if (aqi <= 200) return "中度污染";
  if (aqi <= 300) return "重度污染";
  return "严重污染";
}

function toCity(value: Record<string, unknown>): CityInfo {
  return {
    locationKey: text(value.locationKey),
    name: text(value.name, "未知城市"),
    affiliation: text(value.affiliation),
    latitude: text(value.latitude),
    longitude: text(value.longitude)
  };
}

async function getJson(url: string, fetcher: Fetcher): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`天气服务返回 ${response.status}，请稍后重试`);
  return response.json();
}

async function resolveCity(query: string, fetcher: Fetcher): Promise<CityInfo> {
  const trimmed = query.trim();
  if (!trimmed) return DEFAULT_CITY;
  const locationKey = /^\d+$/.test(trimmed) ? `weathercn:${trimmed}` : trimmed;
  if (locationKey.startsWith("weathercn:")) {
    const payload = await getJson(`${HOST}/wtr-v3/location/city/info?locationKey=${encodeURIComponent(locationKey)}&locale=zh_cn`, fetcher);
    const match = Array.isArray(payload) ? payload.map(record).find((item) => item && text(item.locationKey) === locationKey) : undefined;
    if (!match) throw new Error(`未找到城市 ID「${locationKey}」，请改用城市名查询`);
    return toCity(match);
  }
  const payload = await getJson(`${HOST}/wtr-v3/location/city/search?name=${encodeURIComponent(trimmed)}&locale=zh_cn`, fetcher);
  const match = Array.isArray(payload) ? payload.map(record).find((item) => item && Number(item.status) === 0 && text(item.locationKey)) : undefined;
  if (!match) throw new Error(`未找到城市「${trimmed}」，请换一个城市名（如 杭州），或使用 weathercn: 城市 ID`);
  return toCity(match);
}

function defaultFetcher(url: string): Promise<Response> {
  return fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/** Fetch current conditions and a short daily forecast; safe to call without a city. */
export async function fetchWeather(args: Record<string, unknown>, fetcher: Fetcher = defaultFetcher): Promise<WeatherForecast> {
  const city = await resolveCity(typeof args.city === "string" ? args.city : "", fetcher);
  const days = Math.min(Math.max(Math.trunc(Number(args.days)) || DEFAULT_DAYS, 1), MAX_DAYS);
  const weatherUrl = `${HOST}/wtr-v3/weather/all?latitude=${encodeURIComponent(city.latitude)}&longitude=${encodeURIComponent(city.longitude)}&locationKey=${encodeURIComponent(city.locationKey)}&days=15&appKey=${APP_KEY}&sign=${SIGN}&isGlobal=false&locale=zh_cn`;
  const info = record(await getJson(weatherUrl, fetcher));
  if (!info) throw new Error("天气服务返回了无法识别的数据");

  const current = record(info.current) || {};
  const daily = record(info.forecastDaily) || {};
  const temperatureUnit = text(record(daily.temperature)?.unit, "℃");
  const daysData = Array.isArray(record(daily.temperature)?.value) ? record(daily.temperature)!.value as unknown[] : [];
  const weatherData = Array.isArray(record(daily.weather)?.value) ? record(daily.weather)!.value as unknown[] : [];
  const rainData = Array.isArray(record(daily.precipitationProbability)?.value) ? record(daily.precipitationProbability)!.value as string[] : [];
  const sunData = Array.isArray(record(daily.sunRiseSet)?.value) ? record(daily.sunRiseSet)!.value as unknown[] : [];
  const aqi = record(info.aqi);
  const aqiValue = text(aqi?.aqi);
  const level = aqiValue ? aqiLevel(Number(aqiValue)) : "";

  const forecast: WeatherForecast["forecast"] = [];
  for (let index = 0; index < days; index += 1) {
    const temperature = record(daysData[index]);
    const weather = record(weatherData[index]);
    const high = text(temperature?.from);
    const low = text(temperature?.to);
    const dayCondition = weatherLabel(weather?.from);
    const nightCondition = weatherLabel(weather?.to);
    const sun = record(sunData[index]);
    const isoDate = text(sun?.from).slice(0, 10);
    const date = isoDate || new Date(Date.now() + index * 86_400_000).toISOString().slice(0, 10);
    const label = ["今天", "明天", "后天"][index] || `周${"日一二三四五六"[new Date(`${date}T12:00:00`).getDay()]}`;
    forecast.push({
      date,
      label,
      condition: dayCondition === nightCondition ? dayCondition : `${dayCondition}转${nightCondition}`,
      temperature: high && low ? `${high}~${low}${temperatureUnit}` : "—",
      precipitationProbability: rainData[index] !== undefined ? `${rainData[index]}%` : "—"
    });
  }

  const wind = record(current.wind);
  const updatedAtMs = Number(text(info.updateTime));
  const alerts = Array.isArray(info.alerts)
    ? info.alerts.map(record).filter((item): item is Record<string, unknown> => Boolean(item)).slice(0, 3).map((item) => ({
      title: text(item.title, "天气预警"),
      level: text(item.level) || undefined,
      detail: text(item.detail).slice(0, 300) || undefined
    }))
    : [];

  return {
    city: city.name,
    region: city.affiliation,
    cityId: city.locationKey,
    updatedAt: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : undefined,
    current: {
      condition: weatherLabel(current.weather),
      temperature: unitPair(current.temperature),
      feelsLike: unitPair(current.feelsLike),
      humidity: unitPair(current.humidity),
      wind: `${windDirection(wind?.direction)} ${unitPair(wind?.speed)}`.trim(),
      pressure: unitPair(current.pressure),
      visibility: text(record(current.visibility)?.value) ? unitPair(current.visibility) : undefined,
      uvIndex: text(current.uvIndex) || undefined,
      aqi: aqiValue ? `${aqiValue}${level ? ` ${level}` : ""}` : undefined,
      publishedAt: text(current.pubTime) || undefined
    },
    forecast,
    alerts
  };
}
