import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SessionStore } from "./session-store.js";
import { closeSessionDb } from "./session-db.js";
import { MASKED_SECRET, maskSecretsDeep } from "./redact.js";

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
    closeSessionDb(workspace);
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
    closeSessionDb(workspace);
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
    closeSessionDb(workspace);
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
    closeSessionDb(workspace);
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
    closeSessionDb(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("maskSecretsDeep ignores zero-width characters in key names", async () => {
  const { maskSecretsDeep } = await import("./session-store.js");
  const out = maskSecretsDeep({ "api\u200bkey": "hidden", normal: "shown" }) as Record<string, unknown>;
  assert.equal(out["api\u200bkey"], "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022");
  assert.equal(out.normal, "shown");
});

test("maskSecretsDeep 剪枝循环引用不栈溢出（R63 防护回归）", () => {
  const cyclic: Record<string, unknown> = { apiKey: "sk-live" };
  cyclic.self = cyclic;
  const out = maskSecretsDeep(cyclic) as Record<string, unknown>;
  assert.strictEqual(out.apiKey, MASKED_SECRET);
  assert.strictEqual(out.self, "[循环引用]");
});

test("maskSecretsDeep 不把 DAG 共享引用误判为循环", () => {
  const shared = { host: "db.internal", password: "s3cr3t!" };
  const out = maskSecretsDeep({ first: shared, second: shared }) as Record<string, unknown>;
  const first = out.first as Record<string, unknown>;
  const second = out.second as Record<string, unknown>;
  assert.equal(first.host, "db.internal");
  assert.equal(second.host, "db.internal", "共享子对象第二次出现不得变成 [循环引用]");
  assert.equal(first.password, MASKED_SECRET);
  assert.equal(second.password, MASKED_SECRET);
});

test("maskSecretsDeep 深度截断防解析炸弹", () => {
  let deep: unknown = { apiKey: "sk-live" };
  for (let i = 0; i < 100; i += 1) deep = { nested: deep };
  const out = maskSecretsDeep(deep) as Record<string, unknown>;
  assert.ok(JSON.stringify(out).includes("[深度截断]"));
});

test("maskSecretsDeep 零宽字符 key 归一化仍命中", () => {
  const out = maskSecretsDeep({ "api\u200bkey": "x", "pass\u00b7word": "y", normal: 1 }) as Record<string, unknown>;
  assert.strictEqual(out["api\u200bkey"], MASKED_SECRET);
  assert.strictEqual(out["pass\u00b7word"], MASKED_SECRET);
  assert.strictEqual(out.normal, 1);
});

test("旧 JSON 会话一次性导入 SQLite：保留 preview/归档/附件/工具调用并留备份", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-migrate-"));
  try {
    const root = path.join(workspace, "sessions");
    const id = "legacy-1";
    const at = "2026-01-02T03:04:05.000Z";
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, "index.json"), JSON.stringify([{ id, title: "旧会话", createdAt: at, updatedAt: at, preview: "旧预览", archived: true }]), "utf8");
    fs.writeFileSync(path.join(root, id, "session.json"), JSON.stringify({
      meta: { id, title: "旧会话", createdAt: at, updatedAt: at },
      messages: [
        { id: "legacy-m1", role: "user", content: "迁移前的提问", createdAt: at, attachments: [{ id: "att-1", name: "a.txt", mimeType: "text/plain", dataUrl: "data:text/plain,1", size: 1 }] },
        { id: "legacy-m2", role: "assistant", content: "迁移前的回答", createdAt: at, toolCalls: [{ name: "lookup", arguments: { q: 1 }, result: { ok: true } }] },
      ],
      autoLoadedSkills: ["skill-a"],
      legacyHydrated: true,
    }), "utf8");

    const store = new SessionStore(workspace);
    const meta = store.list()[0];
    assert.equal(meta?.id, id);
    assert.equal(meta?.preview, "旧预览");
    assert.equal(meta?.archived, true);
    const session = store.get(id);
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[0].attachments?.[0]?.name, "a.txt");
    assert.deepEqual(session.messages[1].toolCalls, [{ name: "lookup", arguments: { q: 1 }, result: { ok: true } }]);
    assert.deepEqual(session.autoLoadedSkills, ["skill-a"]);
    assert.equal(store.previewOf(id), "旧预览");
    assert.ok(fs.existsSync(path.join(root, "index.json.migrated")), "index.json 应改名保留");
    assert.ok(fs.existsSync(path.join(root, id, "session.json.migrated")), "session.json 应改名保留");

    const reopened = new SessionStore(workspace);
    assert.equal(reopened.get(id).messages.length, 2, "再次启动不得重复导入");
    assert.equal(reopened.list().length, 1);

    // 降级回退场景：旧版又写回 index.json/session.json，再升级时按 updated_at 覆盖且不撞主键。
    const later = "2026-01-02T04:00:00.000Z";
    fs.writeFileSync(path.join(root, "index.json"), JSON.stringify([{ id, title: "旧会话", createdAt: at, updatedAt: later, preview: "旧版新消息", archived: true }]), "utf8");
    fs.writeFileSync(path.join(root, id, "session.json"), JSON.stringify({
      meta: { id, title: "旧会话", createdAt: at, updatedAt: later },
      messages: [
        { id: "legacy-m1", role: "user", content: "迁移前的提问", createdAt: at },
        { id: "legacy-m2", role: "assistant", content: "迁移前的回答", createdAt: at },
        { id: "legacy-m3", role: "user", content: "旧版又追加的消息", createdAt: later },
      ],
      legacyHydrated: true,
    }), "utf8");
    const upgraded = new SessionStore(workspace);
    assert.equal(upgraded.get(id).messages.length, 3);
    assert.equal(upgraded.list()[0]?.preview, "旧版新消息");
  } finally {
    closeSessionDb(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("listed:false 的唤醒会话不进列表，但可按 id 读写", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-unlisted-"));
  try {
    const store = new SessionStore(workspace);
    const quiet = store.create("随时唤醒", { listed: false });
    assert.equal(store.list().length, 0);
    store.appendMessage(quiet.meta.id, "user", "只在后台跑的会话");
    assert.equal(store.get(quiet.meta.id).messages.length, 1);
  } finally {
    closeSessionDb(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("appendMessage 跨重开保持顺序，delete 同时清理消息与目录", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-order-"));
  try {
    const store = new SessionStore(workspace);
    const session = store.create();
    store.appendMessage(session.meta.id, "user", "第一条");
    store.appendMessage(session.meta.id, "assistant", "第二条");
    closeSessionDb(workspace);

    const reopened = new SessionStore(workspace);
    reopened.appendMessage(session.meta.id, "user", "第三条");
    assert.deepEqual(reopened.get(session.meta.id).messages.map((message) => message.content), ["第一条", "第二条", "第三条"]);

    reopened.delete(session.meta.id);
    assert.equal(reopened.list().length, 0);
    assert.throws(() => reopened.get(session.meta.id), /会话不存在/);
    assert.ok(!fs.existsSync(path.join(workspace, "sessions", session.meta.id)), "会话目录应一并删除");
  } finally {
    closeSessionDb(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("setAutoLoadedSkills 去重，setArchived 不影响列表外会话", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-skills-"));
  try {
    const store = new SessionStore(workspace);
    const first = store.create();
    store.setAutoLoadedSkills(first.meta.id, ["a", "a", "b"]);
    assert.deepEqual(store.get(first.meta.id).autoLoadedSkills, ["a", "b"]);

    const second = store.create();
    store.setArchived(second.meta.id, true);
    assert.equal(store.get(second.meta.id).meta.archived, true);
    store.setArchived(second.meta.id, false);
    assert.equal(store.get(second.meta.id).meta.archived, undefined);
  } finally {
    closeSessionDb(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("旧索引缺失或损坏时，session.json 会话仍按可见状态导入", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-index-corrupt-"));
  try {
    const root = path.join(workspace, "sessions");
    const id = "legacy-no-index";
    const at = "2026-01-04T00:00:00.000Z";
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, "index.json"), "{broken json", "utf8");
    fs.writeFileSync(path.join(root, id, "session.json"), JSON.stringify({
      meta: { id, title: "索引损坏的会话", createdAt: at, updatedAt: at },
      messages: [{ id: "n1", role: "user", content: "还在吗", createdAt: at }],
      legacyHydrated: true,
    }), "utf8");

    const store = new SessionStore(workspace);
    assert.equal(store.list()[0]?.id, id, "索引不可读时不得把会话隐藏为 listed:false");
    assert.equal(store.get(id).messages.length, 1);
  } finally {
    closeSessionDb(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("旧会话工具调用只从 runtime.jsonl 回填一次并落库", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-session-hydrate-"));
  try {
    const root = path.join(workspace, "sessions");
    const id = "legacy-hydrate";
    const at = "2026-01-03T00:00:00.000Z";
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, "session.json"), JSON.stringify({
      meta: { id, title: "旧会话", createdAt: at, updatedAt: at },
      messages: [
        { id: "h1", role: "user", content: "查一下", createdAt: at },
        { id: "h2", role: "assistant", content: "", createdAt: at },
      ],
    }), "utf8");
    const events = [
      { sequence: 1, at, stage: "user.request", data: { text: "查一下" } },
      { sequence: 2, at, stage: "mcp.tools/call", data: { name: "lookup", arguments: { q: 1 } } },
      { sequence: 3, at, stage: "mcp.tools/result", data: { name: "lookup", result: { ok: true } } },
      { sequence: 4, at, stage: "assistant.response", data: { text: "" } },
    ];
    fs.writeFileSync(path.join(root, id, "runtime.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");

    const store = new SessionStore(workspace);
    assert.deepEqual(store.get(id).messages[1].toolCalls, [{ name: "lookup", arguments: { q: 1 }, result: { ok: true } }]);
    // 回填结果已落库：runtime.jsonl 被清理后仍能读到工具调用。
    fs.rmSync(path.join(root, id, "runtime.jsonl"));
    assert.deepEqual(store.get(id).messages[1].toolCalls, [{ name: "lookup", arguments: { q: 1 }, result: { ok: true } }]);
  } finally {
    closeSessionDb(workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
