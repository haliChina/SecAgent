/**
 * 主进程遥测/Sentry（B2 自 main.ts 拆出，纯搬家）。
 *
 * 工作区迁移与偏好读取完成前保持关闭（fail-closed），随后尊重已有
 * 遥测设置。Sentry 上报前脱敏（去 headers/cookies/user，
 * 路径与消息经 normalizeMessage）。
 */
import fs from "node:fs";
import * as Sentry from "@sentry/electron/main";
export { Sentry };
import { configPath, DEFAULT_TELEMETRY_SETTINGS, readSettings } from "../config.js";
import { DEFAULT_WORKSPACE } from "../paths.js";
import { TelemetryClient, normalizeMessage, sanitizeStack, type TelemetryFailure } from "../telemetry.js";

export const SENTRY_DSN = process.env.SENTRY_DSN?.trim() || "";

function readInitialTelemetryEnabled(): boolean {
  if (!fs.existsSync(configPath(DEFAULT_WORKSPACE))) return DEFAULT_TELEMETRY_SETTINGS.enabled;
  try { return readSettings(DEFAULT_WORKSPACE).telemetry.enabled; }
  catch { return false; }
}

// Fail closed during module loading: main explicitly reads the persisted
// preference after workspace migration, before starting native integrations.
let sentryTelemetryEnabled = false;
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
/** The main entry calls this only after migrating the legacy workspace. */
export function initializeSentryAfterMigration(): void {
  setSentryTelemetryEnabled(readInitialTelemetryEnabled());
  initializeSentry();
}
