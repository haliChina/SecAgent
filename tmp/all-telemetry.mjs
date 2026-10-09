// src/telemetry.test.ts
import assert from "node:assert/strict";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";

// src/telemetry.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
var TELEMETRY_SCHEMA_VERSION = 1;
var TELEMETRY_EVENT_BATCH_LIMIT = 100;
var TELEMETRY_EVENT_BATCH_BYTES = 256 * 1024;
var TELEMETRY_DIAGNOSTIC_COMPRESSED_LIMIT = 10 * 1024 * 1024;
var TELEMETRY_DIAGNOSTIC_RAW_LIMIT = 50 * 1024 * 1024;
function cleanBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}
function asError(error) {
  if (error instanceof Error) {
    const candidate = error;
    return {
      name: error.name.slice(0, 120),
      ...typeof candidate.code === "string" ? { code: candidate.code.slice(0, 120) } : {},
      message: normalizeMessage(error.message),
      ...error.stack ? { stack: sanitizeStack(error.stack) } : {}
    };
  }
  return { message: normalizeMessage(String(error)) };
}
function normalizeMessage(value) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>").replace(/[A-Za-z]:\\[^ ]+/g, "<path>").replace(/(?:file|https?):\/\/[^\s]+/gi, "<url>").replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>").replace(/\s+/g, " ").trim().slice(0, 1e3);
}
function sanitizeStack(value) {
  return normalizeMessage(value).replace(/<path>[^ ]*/g, "<path>").slice(0, 12e3);
}
function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}
function readOrCreateIdentity(storageDirectory) {
  fs.mkdirSync(storageDirectory, { recursive: true });
  const file = path.join(storageDirectory, "telemetry-identity.json");
  try {
    const current = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof current.installId === "string" && current.installId.length >= 16) return { installId: current.installId };
  } catch {
  }
  const identity = { installId: crypto.randomUUID() };
  try {
    fs.writeFileSync(file, `${JSON.stringify(identity)}
`, { encoding: "utf8", mode: 384 });
  } catch {
  }
  return identity;
}
function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : void 0;
}
function breadcrumb(event) {
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const sizes = {};
  for (const [key, candidate] of Object.entries(data)) {
    if (!/(length|bytes|characters|count|tokens)/i.test(key)) continue;
    const number = safeNumber(candidate);
    if (number !== void 0) sizes[key] = number;
  }
  const status = typeof data.status === "string" ? data.status.slice(0, 80) : typeof data.kind === "string" ? data.kind.slice(0, 80) : void 0;
  return { at: event.at, stage: event.stage.slice(0, 120), ...status ? { status } : {}, ...Object.keys(sizes).length ? { sizes } : {} };
}
function redactTraceEvent(event) {
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const safe = {};
  for (const key of ["name", "provider", "model", "status", "reason", "kind", "turn", "attempt", "maxRetries", "waitMs", "toolCount", "server", "pluginId", "ruleName"]) {
    const value = data[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") safe[key] = typeof value === "string" ? value.slice(0, 160) : value;
  }
  for (const key of ["text", "content", "instruction", "arguments", "result", "body", "inputSchema", "path", "systemMessage", "message"]) {
    const value = data[key];
    if (typeof value === "string") safe[`${key}Length`] = value.length;
    else if (value !== void 0 && value !== null) {
      try {
        safe[`${key}Bytes`] = Buffer.byteLength(JSON.stringify(value));
      } catch {
      }
    }
  }
  return { at: event.at, sequence: event.sequence, stage: event.stage.slice(0, 120), data: safe };
}
var TelemetryClient = class {
  installId;
  instanceId = crypto.randomUUID();
  baseUrl;
  queueFile;
  appVersion;
  platform;
  arch;
  locale;
  getAuthToken;
  enabled;
  queue = [];
  suppressed = /* @__PURE__ */ new Map();
  lastSent = /* @__PURE__ */ new Map();
  breadcrumbs = [];
  activeControllers = /* @__PURE__ */ new Set();
  flushTimer;
  heartbeatTimer;
  flushPromise;
  constructor(options) {
    this.installId = readOrCreateIdentity(options.storageDirectory).installId;
    this.baseUrl = cleanBaseUrl(options.baseUrl);
    this.queueFile = path.join(options.storageDirectory, "telemetry-events.json");
    this.appVersion = options.appVersion;
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.locale = options.locale || Intl.DateTimeFormat().resolvedOptions().locale || "unknown";
    this.enabled = options.enabled;
    this.getAuthToken = options.getAuthToken;
    if (this.enabled) this.queue.push(...readQueuedEvents(this.queueFile, this.installId, this.instanceId, this.appVersion).slice(-1e3));
    else writeQueuedEvents(this.queueFile, []);
  }
  start() {
    if (!this.enabled || !this.baseUrl) return;
    void this.sendHeartbeat();
    void this.flush();
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 3e4);
    this.flushTimer.unref?.();
    this.scheduleHeartbeat();
  }
  stop(clearQueue = false) {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.flushTimer = void 0;
    this.heartbeatTimer = void 0;
    for (const controller of this.activeControllers) controller.abort();
    if (clearQueue) this.queue.length = 0;
    writeQueuedEvents(this.queueFile, this.queue);
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    this.stop(!enabled);
    if (enabled) this.start();
  }
  isEnabled() {
    return this.enabled && Boolean(this.baseUrl);
  }
  addBreadcrumb(event) {
    if (!this.isEnabled()) return;
    this.breadcrumbs.push(breadcrumb(event));
    if (this.breadcrumbs.length > 50) this.breadcrumbs.splice(0, this.breadcrumbs.length - 50);
  }
  recordFailure(failure) {
    if (!this.isEnabled()) return;
    const error = asError(failure.error);
    const context = { ...failure.context || {} };
    const signature = hash(`${failure.type}|${error.name || ""}|${error.code || ""}|${error.message || ""}`);
    const now = Date.now();
    const last = this.lastSent.get(signature);
    if (last !== void 0 && now - last < 10 * 6e4) {
      this.suppressed.set(signature, (this.suppressed.get(signature) || 1) + 1);
      return;
    }
    this.lastSent.set(signature, now);
    const count = (this.suppressed.get(signature) || 0) + 1;
    this.suppressed.delete(signature);
    const event = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      eventId: crypto.randomUUID(),
      type: failure.type,
      occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
      installId: this.installId,
      instanceId: this.instanceId,
      appVersion: this.appVersion,
      platform: this.platform,
      arch: this.arch,
      locale: this.locale,
      ...count > 1 ? { count } : {},
      context: sanitizeContext(context),
      error,
      breadcrumbs: [...this.breadcrumbs]
    };
    this.queue.push(event);
    writeQueuedEvents(this.queueFile, this.queue);
    if (this.queue.length >= TELEMETRY_EVENT_BATCH_LIMIT) void this.flush();
  }
  async uploadDiagnostic(session, runtimeEvents) {
    if (!this.isEnabled()) throw new Error("\u9065\u6D4B\u5DF2\u5173\u95ED");
    const payload = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      kind: "session-diagnostic",
      eventId: crypto.randomUUID(),
      installId: this.installId,
      instanceId: this.instanceId,
      appVersion: this.appVersion,
      platform: this.platform,
      arch: this.arch,
      uploadedAt: (/* @__PURE__ */ new Date()).toISOString(),
      session: {
        meta: session.meta,
        autoLoadedSkills: session.autoLoadedSkills,
        messages: session.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          stopped: message.stopped,
          toolCalls: message.toolCalls
        }))
      },
      runtime: runtimeEvents.map(redactTraceEvent)
    };
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    if (raw.length > TELEMETRY_DIAGNOSTIC_RAW_LIMIT) throw new Error("\u8BCA\u65AD\u5305\u89E3\u538B\u540E\u8D85\u8FC7 50 MB \u9650\u5236");
    const compressed = gzipSync(raw, { level: 6 });
    if (compressed.length > TELEMETRY_DIAGNOSTIC_COMPRESSED_LIMIT) throw new Error("\u8BCA\u65AD\u5305\u8D85\u8FC7 10 MB \u9650\u5236");
    await this.post("/telemetry/v1/diagnostics", compressed, { "Content-Type": "application/gzip", "Content-Encoding": "gzip", "X-SecAgent-Diagnostic": "session" });
    return { bytes: compressed.length };
  }
  scheduleHeartbeat() {
    if (!this.isEnabled()) return;
    const jitter = Math.floor(Math.random() * 9e4);
    this.heartbeatTimer = setTimeout(() => {
      void this.sendHeartbeat().finally(() => this.scheduleHeartbeat());
    }, 10 * 6e4 + jitter);
    this.heartbeatTimer.unref?.();
  }
  async sendHeartbeat() {
    if (!this.isEnabled()) return;
    await this.post("/telemetry/v1/heartbeat", JSON.stringify({
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      installId: this.installId,
      instanceId: this.instanceId,
      appVersion: this.appVersion,
      platform: this.platform,
      arch: this.arch,
      locale: this.locale,
      at: (/* @__PURE__ */ new Date()).toISOString()
    }), { "Content-Type": "application/json" }).catch(() => void 0);
  }
  async flush() {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushOnce().finally(() => {
      this.flushPromise = void 0;
    });
    return this.flushPromise;
  }
  async flushOnce() {
    if (!this.isEnabled() || !this.queue.length) return;
    const events = this.queue.splice(0, TELEMETRY_EVENT_BATCH_LIMIT);
    const body = JSON.stringify({ schemaVersion: TELEMETRY_SCHEMA_VERSION, events });
    if (Buffer.byteLength(body) > TELEMETRY_EVENT_BATCH_BYTES) {
      this.queue.unshift(...events.slice(0, Math.max(1, Math.floor(events.length / 2))));
      writeQueuedEvents(this.queueFile, this.queue);
      return;
    }
    writeQueuedEvents(this.queueFile, this.queue);
    await this.post("/telemetry/v1/events", body, { "Content-Type": "application/json" }).catch(() => {
      if (this.enabled) {
        this.queue.unshift(...events.slice(0, 20));
        writeQueuedEvents(this.queueFile, this.queue);
      }
    });
    writeQueuedEvents(this.queueFile, this.queue);
  }
  async post(endpoint, body, headers) {
    if (!this.baseUrl) return;
    const authorization = this.getAuthToken?.();
    const controller = new AbortController();
    this.activeControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 8e3);
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, { method: "POST", body, headers: { ...headers, ...authorization ? { Authorization: `Bearer ${authorization}` } : {} }, signal: controller.signal });
      if (!response.ok) throw new Error(`telemetry HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
      this.activeControllers.delete(controller);
    }
  }
};
function readQueuedEvents(file, installId, instanceId, appVersion) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((event) => Boolean(event && typeof event === "object" && event.installId === installId && typeof event.eventId === "string" && typeof event.type === "string")).map((event) => ({ ...event, instanceId: event.instanceId || instanceId, appVersion: event.appVersion || appVersion }));
  } catch {
    return [];
  }
}
function writeQueuedEvents(file, events) {
  try {
    fs.writeFileSync(file, `${JSON.stringify(events.slice(-1e3))}
`, { encoding: "utf8", mode: 384 });
  } catch {
  }
}
function sanitizeContext(value) {
  const result = {};
  const blocked = /^(text|content|instruction|body|arguments|result|prompt|response|token|apiKey|authorization|cookie|dataUrl)$/i;
  for (const [key, candidate] of Object.entries(value)) {
    if (blocked.test(key)) {
      if (typeof candidate === "string") result[`${key}Length`] = candidate.length;
      else if (candidate !== void 0 && candidate !== null) {
        try {
          result[`${key}Bytes`] = Buffer.byteLength(JSON.stringify(candidate));
        } catch {
        }
      }
      continue;
    }
    if (typeof candidate === "string") result[key] = normalizeMessage(candidate);
    else if (typeof candidate === "number" || typeof candidate === "boolean" || candidate === null) result[key] = candidate;
  }
  return result;
}

// src/telemetry.test.ts
test("normalizes telemetry messages and redacts trace content", () => {
  const message = normalizeMessage("failed C:\\Users\\Alice\\secret.txt Bearer abc.def https://example.test/token");
  assert.equal(message.includes("Alice"), false);
  assert.equal(message.includes("abc.def"), false);
  assert.equal(message.includes("example.test"), false);
  const redacted = redactTraceEvent({
    sequence: 1,
    at: "2026-08-26T00:00:00.000Z",
    stage: "tool.call",
    data: { name: "search", arguments: { query: "private query" }, result: "private result", content: "private content", status: "failed" }
  });
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("private query"), false);
  assert.equal(serialized.includes("private result"), false);
  assert.equal(serialized.includes("private content"), false);
  assert.equal(redacted.data.argumentsBytes, Buffer.byteLength(JSON.stringify({ query: "private query" })));
  assert.equal(redacted.data.resultLength, "private result".length);
});
test("disabled telemetry makes no request", async () => {
  const directory = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-telemetry-off-"));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new TelemetryClient({ baseUrl: "https://telemetry.example", storageDirectory: directory, appVersion: "test", enabled: false });
    client.recordFailure({ type: "model.timeout", error: new Error("should not upload") });
    await assert.rejects(() => client.uploadDiagnostic({ meta: { id: "session", title: "test", createdAt: "now", updatedAt: "now" }, messages: [] }, []));
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    fs2.rmSync(directory, { recursive: true, force: true });
  }
});
test("failure events are sanitized while explicit diagnostics retain only selected session content", async () => {
  const directory = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-telemetry-on-"));
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (...args) => {
    requests.push({ url: String(args[0]), body: args[1]?.body });
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new TelemetryClient({ baseUrl: "https://telemetry.example", storageDirectory: directory, appVersion: "test", enabled: true });
    client.recordFailure({ type: "tool.call.failed", error: new Error("failed C:\\Users\\Alice\\secret.txt"), context: { prompt: "private prompt", apiKey: "private key", tool: "search" } });
    await client.flush();
    const eventBody = String(requests[0].body);
    assert.equal(eventBody.includes("private prompt"), false);
    assert.equal(eventBody.includes("private key"), false);
    assert.equal(eventBody.includes("Alice"), false);
    assert.equal(eventBody.includes("search"), true);
    await client.uploadDiagnostic({
      meta: { id: "session", title: "test", createdAt: "now", updatedAt: "now" },
      messages: [{ id: "message", role: "user", content: "user-selected diagnostic content", createdAt: "now" }]
    }, [{ sequence: 1, at: "now", stage: "tool.call", data: { arguments: { secret: "do not include" }, result: "private result" } }]);
    const diagnostic = JSON.parse(gunzipSync(requests[1].body).toString("utf8"));
    assert.equal(diagnostic.session.messages[0].content, "user-selected diagnostic content");
    assert.equal(JSON.stringify(diagnostic.runtime).includes("do not include"), false);
    assert.equal(JSON.stringify(diagnostic.runtime).includes("private result"), false);
  } finally {
    globalThis.fetch = originalFetch;
    fs2.rmSync(directory, { recursive: true, force: true });
  }
});
test("retries the sanitized event queue after an offline restart", async () => {
  const directory = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-telemetry-retry-"));
  const originalFetch = globalThis.fetch;
  let online = false;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    if (!online) throw new Error("offline");
    return new Response("{}", { status: 200 });
  };
  try {
    const first = new TelemetryClient({ baseUrl: "https://telemetry.example", storageDirectory: directory, appVersion: "test", enabled: true });
    first.recordFailure({ type: "model.timeout", error: new Error("offline") });
    await first.flush();
    first.stop();
    assert.equal(JSON.parse(fs2.readFileSync(path2.join(directory, "telemetry-events.json"), "utf8")).length, 1);
    online = true;
    const second = new TelemetryClient({ baseUrl: "https://telemetry.example", storageDirectory: directory, appVersion: "test", enabled: true });
    await second.flush();
    assert.equal(requests, 2);
    assert.equal(JSON.parse(fs2.readFileSync(path2.join(directory, "telemetry-events.json"), "utf8")).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    fs2.rmSync(directory, { recursive: true, force: true });
  }
});
