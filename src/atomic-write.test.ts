import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeFileAtomic } from "./atomic-write.js";

test("writeFileAtomic 保留目标文件权限，不把 0600 的密钥文件放宽", { skip: process.platform === "win32" ? "Windows 无 POSIX 权限位" : false }, () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-atomic-write-"));
  try {
    const file = path.join(workspace, "secret.env");
    fs.writeFileSync(file, "OLD=1\n", "utf8");
    fs.chmodSync(file, 0o600);

    writeFileAtomic(file, "NEW=2\n");
    assert.equal(fs.readFileSync(file, "utf8"), "NEW=2\n");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, "原子写不得放宽原文件权限");
    assert.deepEqual(fs.readdirSync(workspace), ["secret.env"], "临时文件应被 rename 消耗，不留残片");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
