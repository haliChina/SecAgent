import assert from "node:assert/strict";
import test from "node:test";
import { fetchWeather, weatherTool } from "./weather.js";

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

function reply(payload: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

const HANGZHOU = { locationKey: "weathercn:101210101", name: "杭州市", affiliation: "杭州, 浙江, 中国", latitude: "30.2741", longitude: "120.1551", status: 0 };

function weatherPayload(overrides: Record<string, unknown> = {}) {
  return {
    updateTime: 1_790_000_000_000,
    current: {
      weather: 0,
      temperature: { value: "21", unit: "℃" },
      feelsLike: { value: "20", unit: "℃" },
      humidity: { value: "55", unit: "%" },
      wind: { direction: { value: "90" }, speed: { value: "3", unit: "级" } },
      pressure: { value: "1012", unit: "hPa" },
      visibility: { value: "20", unit: "km" },
      uvIndex: "4",
      pubTime: "2026-11-02T10:00:00+08:00"
    },
    forecastDaily: {
      temperature: { unit: "℃", value: [{ from: "24", to: "14" }, { from: "22", to: "13" }, { from: "20", to: "11" }, { from: "19", to: "10" }] },
      weather: { value: [{ from: 0, to: 1 }, { from: 7, to: 2 }, { from: 0, to: 0 }, { from: 13, to: 1 }] },
      precipitationProbability: { value: ["10", "60", "0", "20"] },
      sunRiseSet: { value: [{ from: "2026-11-02T06:20:00+08:00" }, { from: "2026-11-03T06:21:00+08:00" }, { from: "2026-11-04T06:22:00+08:00" }, { from: "2026-11-05T06:23:00+08:00" }] }
    },
    aqi: { aqi: "42" },
    alerts: [{ title: "大风蓝色预警", level: "蓝色", detail: "预计今天白天有 5 级风" }],
    ...overrides
  };
}

/** Routes by URL so each test only declares the endpoints it touches. */
function fakeFetcher(routes: { search?: unknown; info?: unknown; weather?: unknown; status?: number }): Fetcher {
  return async (url) => {
    if (routes.status) return reply({}, routes.status);
    if (url.includes("/location/city/search")) return reply(routes.search ?? []);
    if (url.includes("/location/city/info")) return reply(routes.info ?? []);
    return reply(routes.weather ?? weatherPayload());
  };
}

test("weather tool is registered with a bounded day range", () => {
  assert.equal(weatherTool.key, "weather");
  const properties = weatherTool.inputSchema as { properties?: { days?: { maximum?: number } } };
  assert.equal(properties.properties?.days?.maximum, 5);
});

test("omitted city defaults to Beijing and returns compact current + forecast data", async () => {
  const forecast = await fetchWeather({}, fakeFetcher({}));
  assert.equal(forecast.city, "北京市");
  assert.equal(forecast.cityId, "weathercn:101010100");
  assert.equal(forecast.current.condition, "晴");
  assert.equal(forecast.current.temperature, "21℃");
  assert.equal(forecast.current.wind, "东风 3级");
  assert.equal(forecast.current.aqi, "42 优");
  assert.equal(forecast.forecast.length, 3);
  assert.equal(forecast.forecast[0]?.condition, "晴转多云");
  assert.equal(forecast.forecast[0]?.temperature, "24~14℃");
  assert.equal(forecast.forecast[1]?.precipitationProbability, "60%");
  assert.equal(forecast.forecast[1]?.label, "明天");
  assert.equal(forecast.alerts[0]?.title, "大风蓝色预警");
  assert.equal(forecast.updatedAt, new Date(1_790_000_000_000).toISOString());
});

test("city names are resolved through search and days are clamped to the schema range", async () => {
  const forecast = await fetchWeather({ city: "杭州", days: 9 }, fakeFetcher({ search: [HANGZHOU] }));
  assert.equal(forecast.city, "杭州市");
  assert.equal(forecast.cityId, "weathercn:101210101");
  assert.equal(forecast.forecast.length, 5);
});

test("weathercn IDs and bare numeric codes hit the city info endpoint", async () => {
  const requested: string[] = [];
  const fetcher: Fetcher = async (url) => {
    requested.push(url);
    return reply(url.includes("/city/info") ? [HANGZHOU] : weatherPayload());
  };
  const forecast = await fetchWeather({ city: "101210101" }, fetcher);
  assert.ok(requested.some((url) => url.includes("/wtr-v3/location/city/info?locationKey=weathercn")));
  assert.equal(forecast.cityId, "weathercn:101210101");

  const prefixed = await fetchWeather({ city: "weathercn:101210101" }, fetcher);
  assert.equal(prefixed.city, "杭州市");
});

test("unknown cities and HTTP failures surface actionable errors", async () => {
  await assert.rejects(fetchWeather({ city: "不存在的城市" }, fakeFetcher({ search: [] })), /未找到城市/);
  await assert.rejects(fetchWeather({ city: "weathercn:999" }, fakeFetcher({ info: [] })), /未找到城市 ID/);
  await assert.rejects(fetchWeather({}, fakeFetcher({ status: 503 })), /天气服务返回 503/);
});

test("missing forecast fields degrade to placeholders instead of throwing", async () => {
  const forecast = await fetchWeather({}, fakeFetcher({ weather: weatherPayload({ current: {}, forecastDaily: {}, aqi: {} }) }));
  assert.equal(forecast.current.condition, "未知");
  assert.equal(forecast.forecast.length, 3);
  assert.equal(forecast.forecast[0]?.temperature, "—");
  assert.equal(forecast.forecast[0]?.precipitationProbability, "—");
});
