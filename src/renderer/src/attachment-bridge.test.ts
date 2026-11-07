/**
 * 附件双向同步桥的源码级接线锁。App 必须把真实附件名传给 PromptBar；
 * PromptBar 需以 App 列表为真源镜像其 chip，避免缩略图删除后仍显示附件。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// 从 dist/renderer/src 回到仓库根，避免把编译层级数当作运行位置。
const repo = path.resolve(import.meta.dirname, "..", "..", "..");
const app = fs.readFileSync(path.join(repo, "src/renderer/src/App.tsx"), "utf8");
const promptBar = fs.readFileSync(path.join(repo, "src/renderer/src/components/ui/parts/prompt-bar.tsx"), "utf8");

test("App supplies the real attachment list to PromptBar", () => {
  assert.match(app, /attachmentNames=\{attachments\.map\(\(attachment\) => attachment\.name\)\}/);
  assert.match(app, /value=\{draft\}/);
});

test("PromptBar mirrors controlled attachment names without changing default behavior", () => {
  assert.match(promptBar, /attachmentNames\?: string\[\];/);
  assert.match(promptBar, /if \(attachmentNames && attachmentNames\.join\('\\n'\) !== attachments\.join\('\\n'\)\) setAttachments\(attachmentNames\);/);
});
