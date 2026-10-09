/**
 * 主进程遥测/Sentry（B2 自 main.ts 拆出，纯搬家）。
 *
 * 匿名遥测默认关闭（fail-closed）：用户在设置里开启前不初始化
 * Sentry 原生集成。Sentry 上报前脱敏（去 headers/cookies/user，
 * 路径与消息经 normalizeMessage）。
 */
import fs from "node:fs";
import * as Sentry from "@sentry/electron/main";
export { Sentry };
import { configPath, DEFAULT_WORKSPACE, DEFAULT_TELEMETRY_SETTINGS, readSettings } from "../config.js";
import { TelemetryClient, normalizeMessage, sanitizeStack, type TelemetryFailure } from "../telemetry.js";

export const SENTRY_DSN = process.env.SENTRY_DSN?.trim() || "";

function readInitialTelemetryEnabled(): boolean {
  if (!fs.existsSync(configPath(DEFAULT_WORKSPACE))) return DEFAULT_TELEMETRY_SETTINGS.enabled;
  try { return readSettings(DEFAULT_WORKSPACE).telemetry.enabled; }
  catch { return false; }
}

// Fail closed for an existing opt-out and avoid starting Sentry's native
// minidump/session integrations until the user has opted in.
let sentryTelemetryEnabled = readInitialTelemetryEnabled();
let sentryInitialized = false;
let telemetry: TelemetryClient | undefined;

export function initializeSentry(): void {
  if (!SENTRY_DSN || !sentryTelemetryEnabled || sentryInitialized) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false,
    integrations: (defaults) => defaults.filter((integration) => integration.name !== "MainProcessSession"),
    beforeSend: (event) => {
      if (!sentryTelemetryEnabled) return null;
      if (event.request) {
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.query_string;
        if (event.request.url) event.request.url = event.request.url.replace(/[?&](?:token|key|code|state)=[^&]*/gi, "");
      }
      delete event.user;
      delete event.extra;
      delete event.breadcrumbs;
      if (event.message) event.message = normalizeMessage(event.message);
      if (event.transaction) event.transaction = normalizeMessage(event.transaction);
      for (const exception of event.exception?.values || []) {
        if (exception.value) exception.value = normalizeMessage(exception.value);
        if (exception.stacktrace?.frames) for (const frame of exception.stacktrace.frames) {
          if (frame.filename) frame.filename = frame.filename.replace(/[A-Za-z]:\\[^ )]+/g, "<path>");
        }
      }
      return event;
    }
  });
  sentryInitialized = true;
}

export function getTelemetry(): TelemetryClient | undefined {
  return telemetry;
}

export function setTelemetry(client: TelemetryClient | undefined): void {
  telemetry = client;
}

export function setSentryTelemetryEnabled(enabled: boolean): void {
  sentryTelemetryEnabled = enabled;
}

export function captureSafeException(error: unknown): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const safe = new Error(normalizeMessage(source.message));
  safe.name = source.name.slice(0, 120);
  if (source.stack) safe.stack = sanitizeStack(source.stack);
  return safe;
}

export function recordTelemetryFailure(failure: TelemetryFailure): void {
  telemetry?.recordFailure(failure);
  if (SENTRY_DSN && telemetry?.isEnabled()) Sentry.captureException(captureSafeException(failure.error || failure.type));
}
initializeSentry();
