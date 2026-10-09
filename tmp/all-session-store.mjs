// src/session-store.test.ts
import assert from "node:assert/strict";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import test from "node:test";

// src/session-store.ts
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
var SessionStore = class {
  root;
  constructor(workspace) {
    this.root = path.join(workspace, "sessions");
    fs.mkdirSync(this.root, { recursive: true });
  }
  list() {
    const index = this.readIndex();
    return index.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  /** 会话列表预览：最后一条含文本的消息，压缩空白后截断（无消息返回空串）。 */
  previewOf(id) {
    try {
      const data = this.get(id);
      const last = [...data?.messages ?? []].reverse().find((m) => typeof m.content === "string" && m.content.trim());
      return last ? last.content.replace(/\s+/g, " ").trim().slice(0, 72) : "";
    } catch {
      return "";
    }
  }
  create(title = "\u65B0\u4F1A\u8BDD", options = {}) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const meta = { id: randomUUID(), title, createdAt: now, updatedAt: now };
    const data = { meta, messages: [] };
    fs.mkdirSync(this.sessionDir(meta.id), { recursive: true });
    this.writeSession(data);
    if (options.listed !== false) this.writeIndex([meta, ...this.readIndex()]);
    return data;
  }
  get(id) {
    const file = path.join(this.sessionDir(id), "session.json");
    if (!fs.existsSync(file)) throw new Error(`\u4F1A\u8BDD\u4E0D\u5B58\u5728\uFF1A${id}`);
    const session = JSON.parse(fs.readFileSync(file, "utf8"));
    if (this.hydrateLegacyToolCalls(session)) this.writeSession(session);
    return session;
  }
  delete(id) {
    const sessions = this.readIndex();
    if (!sessions.some((item) => item.id === id)) throw new Error(`\u4F1A\u8BDD\u4E0D\u5B58\u5728\uFF1A${id}`);
    fs.rmSync(this.sessionDir(id), { recursive: true, force: true });
    this.writeIndex(sessions.filter((item) => item.id !== id));
  }
  appendMessage(id, role, content, toolCalls, activities, attachments, stopped = false, hallucination) {
    const session = this.get(id);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    session.messages.push({ id: randomUUID(), role, content, createdAt: now, ...attachments?.length ? { attachments } : {}, ...toolCalls?.length ? { toolCalls } : {}, ...activities?.length ? { activities } : {}, ...stopped ? { stopped: true } : {}, ...hallucination?.signals.length ? { hallucination } : {} });
    session.meta.updatedAt = now;
    if (role === "user" && session.meta.title === "\u65B0\u4F1A\u8BDD") session.meta.title = content.replace(/\s+/g, " ").slice(0, 28) || "\u65B0\u4F1A\u8BDD";
    this.writeSession(session);
    this.writeIndex(this.readIndex().map((item) => item.id === id ? session.meta : item));
    return session;
  }
  setTitle(id, title) {
    const session = this.get(id);
    const cleanTitle = title.trim();
    if (!cleanTitle) return session;
    session.meta.title = cleanTitle;
    session.meta.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.writeSession(session);
    this.writeIndex(this.readIndex().map((item) => item.id === id ? session.meta : item));
    return session;
  }
  appendRuntimeEvent(id, event) {
    const entry = JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...event }) + "\n";
    fs.appendFileSync(path.join(this.sessionDir(id), "runtime.jsonl"), entry, "utf8");
  }
  getRuntimeEvents(id) {
    const file = path.join(this.sessionDir(id), "runtime.jsonl");
    if (!fs.existsSync(file)) return [];
    const events = fs.readFileSync(file, "utf8").split("\n").flatMap((line) => {
      if (!line) return [];
      try {
        const event = JSON.parse(line);
        return typeof event.sequence === "number" && typeof event.at === "string" && typeof event.stage === "string" ? [{ sequence: event.sequence, at: event.at, stage: event.stage, data: event.data }] : [];
      } catch {
        return [];
      }
    });
    let lastRequest = -1;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].stage === "user.request") {
        lastRequest = index;
        break;
      }
    }
    return lastRequest >= 0 ? events.slice(lastRequest) : events;
  }
  setAutoLoadedSkills(id, skills) {
    const session = this.get(id);
    session.autoLoadedSkills = [...new Set(skills)];
    session.meta.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.writeSession(session);
    this.writeIndex(this.readIndex().map((item) => item.id === id ? session.meta : item));
  }
  readIndex() {
    const file = path.join(this.root, "index.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  }
  writeIndex(index) {
    fs.writeFileSync(path.join(this.root, "index.json"), JSON.stringify(index, null, 2) + "\n", "utf8");
  }
  writeSession(session) {
    fs.writeFileSync(path.join(this.sessionDir(session.meta.id), "session.json"), JSON.stringify(session, null, 2) + "\n", "utf8");
  }
  sessionDir(id) {
    return path.join(this.root, id);
  }
  /** Backfill sessions created before tool calls were attached directly to assistant messages. */
  hydrateLegacyToolCalls(session) {
    const log = path.join(this.sessionDir(session.meta.id), "runtime.jsonl");
    if (!fs.existsSync(log)) return false;
    const events = fs.readFileSync(log, "utf8").split("\n").flatMap((line) => {
      try {
        return line ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
    let changed = false;
    let assistantIndex = 0;
    let pending = [];
    for (const event of events) {
      if (event.stage === "mcp.tools/call") {
        const data = event.data;
        if (typeof data.name === "string") pending.push({ name: data.name, arguments: data.arguments ?? {} });
      }
      if (event.stage === "mcp.tools/result") {
        const data = event.data;
        if (typeof data.name === "string") {
          const call = [...pending].reverse().find((item) => item.name === data.name && !("result" in item));
          if (call) call.result = data.result;
        }
      }
      if (event.stage === "assistant.response" || event.stage === "runtime.error") {
        while (assistantIndex < session.messages.length && session.messages[assistantIndex].role !== "assistant") assistantIndex++;
        const assistant = session.messages[assistantIndex];
        if (assistant && !assistant.toolCalls?.length && pending.length) {
          assistant.toolCalls = pending;
          changed = true;
        }
        pending = [];
        assistantIndex++;
      }
    }
    return changed;
  }
};

// src/session-store.test.ts
test("restores only the latest session run from the runtime log", () => {
  const workspace = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-session-store-"));
  try {
    const store = new SessionStore(workspace);
    const session = store.create();
    store.appendRuntimeEvent(session.meta.id, { sequence: 1, at: "2026-01-01T00:00:00.000Z", stage: "user.request", data: { text: "old" } });
    store.appendRuntimeEvent(session.meta.id, { sequence: 2, at: "2026-01-01T00:00:01.000Z", stage: "assistant.response", data: { text: "old result" } });
    store.appendRuntimeEvent(session.meta.id, { sequence: 3, at: "2026-01-01T00:00:02.000Z", stage: "user.request", data: { text: "current" } });
    store.appendRuntimeEvent(session.meta.id, { sequence: 4, at: "2026-01-01T00:00:03.000Z", stage: "mcp.tools/call", data: { name: "lookup" } });
    fs2.appendFileSync(path2.join(workspace, "sessions", session.meta.id, "runtime.jsonl"), "not-json\n", "utf8");
    assert.deepEqual(store.getRuntimeEvents(session.meta.id).map((event) => event.sequence), [3, 4]);
  } finally {
    fs2.rmSync(workspace, { recursive: true, force: true });
  }
});
test("persists a generated session title in the session index", () => {
  const workspace = fs2.mkdtempSync(path2.join(os.tmpdir(), "secagent-session-title-"));
  try {
    const store = new SessionStore(workspace);
    const session = store.create();
    store.setTitle(session.meta.id, "\u6574\u7406\u8BFE\u7A0B\u5B89\u6392");
    assert.equal(store.get(session.meta.id).meta.title, "\u6574\u7406\u8BFE\u7A0B\u5B89\u6392");
    assert.equal(store.list()[0]?.title, "\u6574\u7406\u8BFE\u7A0B\u5B89\u6392");
  } finally {
    fs2.rmSync(workspace, { recursive: true, force: true });
  }
});
