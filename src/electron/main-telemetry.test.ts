/**
 * 启动遥测回归锁（源码级）：main-telemetry 模块加载时不得执行 initializeSentry()，
 * 必须导出仅在旧工作区迁移完成后调用的入口——否则静态导入会在迁移读取旧遥测
 * 设置前启动 Sentry，忽略用户关闭偏好。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repo = path.resolve(import.meta.dirname, "../..");
const telemetrySource = fs.readFileSync(path.join(repo, "src/electron/main-telemetry.ts"), "utf8");
const mainSource = fs.readFileSync(path.join(repo, "src/electron/main.ts"), "utf8");

test("telemetry module defers Sentry until the migration-aware entry runs", () => {
  assert.match(telemetrySource, /export function initializeSentryAfterMigration/);
  // The old module top-level call sat after the final closing brace. Now the
  // call lives inside the exported migration entry. Line endings are CRLF on
  // Windows checkouts, so all patterns here are newline-agnostic.
  const noNewlines = telemetrySource.replace(/\r\n/g, "\n");
  assert.doesNotMatch(noNewlines, /\n\}\ninitializeSentry\(\);\n/);
  assert.match(noNewlines, /\n\s*initializeSentry\(\);\n\}/);
  assert.match(telemetrySource, /let sentryTelemetryEnabled = false;/);
});

test("main reads the persisted preference only after legacy workspace migration", () => {
  const migration = mainSource.indexOf("migrateLegacyWorkspace()");
  const initialize = mainSource.indexOf("initializeSentryAfterMigration()");
  assert.ok(migration >= 0 && initialize > migration, "Sentry init must be called after legacy migration");
});
