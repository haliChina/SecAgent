import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "./session-store.js";

test("restores only the latest session run from the runtime log", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-store-"));
  try {
    const store = new SessionStore(workspace);
    const session = store.create();
    store.appendRuntimeEvent(session.meta.id, { sequence: 1, at: "2026-01-01T00:00:00.000Z", stage: "user.request", data: { text: "old" } });
    store.appendRuntimeEvent(session.meta.id, { sequence: 2, at: "2026-01-01T00:00:01.000Z", stage: "assistant.response", data: { text: "old result" } });
    store.appendRuntimeEvent(session.meta.id, { sequence: 3, at: "2026-01-01T00:00:02.000Z", stage: "user.request", data: { text: "current" } });
    store.appendRuntimeEvent(session.meta.id, { sequence: 4, at: "2026-01-01T00:00:03.000Z", stage: "mcp.tools/call", data: { name: "lookup" } });
    fs.appendFileSync(path.join(workspace, "sessions", session.meta.id, "runtime.jsonl"), "not-json\n", "utf8");

    assert.deepEqual(store.getRuntimeEvents(session.meta.id).map((event) => event.sequence), [3, 4]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("persists a generated session title in the session index", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-title-"));
  try {
    const store = new SessionStore(workspace);
    const session = store.create();
    store.setTitle(session.meta.id, "整理课程安排");
    assert.equal(store.get(session.meta.id).meta.title, "整理课程安排");
    assert.equal(store.list()[0]?.title, "整理课程安排");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("appendMessage 的 fallbackNotice 落为独立字段，不混入对话内容", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-store-"));
  try {
    const store = new SessionStore(workspace);
    const session = store.create();
    store.appendMessage(session.meta.id, "assistant", "回答正文", undefined, undefined, undefined, false, undefined, "模型稳定性：已自动切换备用模型（A → B），原模型暂时不可用。");
    const reloaded = store.get(session.meta.id);
    assert.equal(reloaded.messages[0].content, "回答正文");
    assert.equal(reloaded.messages[0].fallbackNotice, "模型稳定性：已自动切换备用模型（A → B），原模型暂时不可用。");
    assert.ok(!reloaded.messages[0].content.includes("模型稳定性"), "回退提示不得拼进 content");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("appendMessage 不传 fallbackNotice 时消息无该字段（向后兼容）", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-store-"));
  try {
    const store = new SessionStore(workspace);
    const session = store.create();
    store.appendMessage(session.meta.id, "user", "普通消息");
    assert.equal(store.get(session.meta.id).messages[0].fallbackNotice, undefined);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("masks secrets in runtime events before writing them to disk", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-mask-"));
  try {
    const store = new SessionStore(workspace);
    const session = store.create();
    const eventData = {
      name: "db.query",
      arguments: { host: "db.internal", password: "s3cr3t!", nested: { apiKey: "ak-live-123" } },
      note: "plain text stays",
    };
    store.appendRuntimeEvent(session.meta.id, {
      sequence: 1,
      at: "2026-10-19T00:00:00.000Z",
      stage: "mcp.tools/call",
      data: eventData,
    });
    /* 写入的是掩码副本，调用方对象本体保持明文（直播 IPC 与终端打印仍用原文）。 */
    assert.equal((eventData.arguments as Record<string, unknown>).password, "s3cr3t!");
    const raw = fs.readFileSync(path.join(workspace, "sessions", session.meta.id, "runtime.jsonl"), "utf8");
    assert.ok(!raw.includes("s3cr3t!"), "password must not hit disk in plaintext");
    assert.ok(!raw.includes("ak-live-123"), "apiKey must not hit disk in plaintext");
    assert.ok(raw.includes("db.internal") && raw.includes("plain text stays"), "non-secret fields preserved");
    const events = store.getRuntimeEvents(session.meta.id);
    const args = (events[0].data as { arguments: Record<string, unknown> }).arguments;
    assert.equal(args.password, "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
    assert.equal((args.nested as Record<string, unknown>).apiKey, "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
    assert.equal(args.host, "db.internal");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("maskSecretsDeep ignores zero-width characters in key names", async () => {
  const { maskSecretsDeep } = await import("./session-store.js");
  const out = maskSecretsDeep({ "api\u200bkey": "hidden", normal: "shown" }) as Record<string, unknown>;
  assert.equal(out["api\u200bkey"], "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
  assert.equal(out.normal, "shown");
});
