import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import { SessionStore } from "../session-store.js";
import { exportHistoryArchive, readHistoryArchive, HISTORY_EXPORT_VERSION, type HistoryArchiveStats } from "./history-archive.js";

function tempStore(): { store: SessionStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-history-"));
  return { store: new SessionStore(dir), dir };
}

test("导出→导入往返：会话与消息（含分支字段）完整迁移", () => {
  const { store, dir } = tempStore();
  try {
    const session = store.create("导出测试");
    store.appendMessage(session.meta.id, "user", "问题一");
    store.appendMessage(session.meta.id, "assistant", "回答一");
    const originalId = store.get(session.meta.id)!.messages[1].id;
    store.appendMessage(session.meta.id, "assistant", "回答二", undefined, undefined, undefined, false, undefined, undefined, originalId);
    const zipPath = path.join(dir, "history.zip");
    const stats = exportHistoryArchive(store, zipPath);
    assert.equal(stats.sessions, 1);
    assert.equal(stats.messages, 3);

    /* 导入到全新 store：parseSessionJson 校验后 replaceAllSessions 落库。 */
    const parsed = readHistoryArchive(zipPath);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].meta.title, "导出测试");
    assert.equal(parsed[0].messages.length, 3);
    const variant = parsed[0].messages[2];
    assert.equal(variant.variantOf, originalId, "分支字段完整穿越归档");

    const dir2 = path.join(dir, "restore");
    fs.mkdirSync(dir2);
    const restoredStore = new SessionStore(dir2);
    restoredStore.replaceAllSessions(parsed);
    const back = restoredStore.list();
    assert.equal(back.length, 1);
    assert.equal(back[0].title, "导出测试");
    const restoredSession = restoredStore.get(back[0].id)!;
    assert.equal(restoredSession.messages.length, 3);
    assert.equal(restoredSession.messages[2].variantOf, originalId);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("导入拒绝错误版本与坏索引（原数据不动）", () => {
  const { store, dir } = tempStore();
  try {
    const session = store.create("原数据");
    store.appendMessage(session.meta.id, "user", "内容");
    const zipPath = path.join(dir, "bad.zip");
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({ export_format_version: 999 }), "utf8"));
    zip.writeZip(zipPath);
    assert.throws(() => readHistoryArchive(zipPath), /不支持的归档版本/);
    /* 原数据仍在。 */
    assert.equal(store.list().length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("宽容解析：坏消息行丢弃不阻断，容器字段坏整包失败", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-history-"));
  try {
    const zipPath = path.join(dir, "mix.zip");
    const zip = new AdmZip();
    zip.addFile("manifest.json", Buffer.from(JSON.stringify({ export_format_version: HISTORY_EXPORT_VERSION }), "utf8"));
    zip.addFile("session_index.json", Buffer.from(JSON.stringify({ sessions: [{ id: "s1" }] }), "utf8"));
    /* m2 缺 role → 丢弃；m1 完整保留。 */
    zip.addFile("sessions/s1.json", Buffer.from(JSON.stringify({
      meta: { id: "s1", title: "混合", createdAt: "2026-11-14T00:00:00.000Z" },
      messages: [
        { id: "m1", role: "user", content: "好", createdAt: "2026-11-14T00:00:01.000Z" },
        { id: "m2", createdAt: "2026-11-14T00:00:02.000Z" }
      ]
    }), "utf8"));
    zip.writeZip(zipPath);
    const parsed = readHistoryArchive(zipPath);
    assert.equal(parsed[0].messages.length, 1);

    /* meta 坏（title 缺失）→ 整包失败。 */
    const zipPath2 = path.join(dir, "bad2.zip");
    const zip2 = new AdmZip();
    zip2.addFile("manifest.json", Buffer.from(JSON.stringify({ export_format_version: HISTORY_EXPORT_VERSION }), "utf8"));
    zip2.addFile("session_index.json", Buffer.from(JSON.stringify({ sessions: [{ id: "s2" }] }), "utf8"));
    zip2.addFile("sessions/s2.json", Buffer.from(JSON.stringify({ meta: { id: "s2", createdAt: "x" }, messages: [] }), "utf8"));
    zip2.writeZip(zipPath2);
    assert.throws(() => readHistoryArchive(zipPath2), /元数据无效/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
