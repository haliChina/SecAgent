/**
 * Windows 安装器的提权执行面回归锁（源码级）。PrepareToInstall 必须以
 * {sys}\taskkill.exe 的绝对路径运行，不能经过 cmd /C 的裸命令查找，避免
 * 当前目录或 PATH 中同名程序被 elevated 安装器执行。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const script = fs.readFileSync(path.resolve(import.meta.dirname, "../../installer/SecAgent.iss"), "utf8").replace(/\r\n/g, "\n");
const prepare = script.slice(script.indexOf("function PrepareToInstall"), script.indexOf("procedure CurStepChanged"));

test("elevated installer runs taskkill from the trusted Windows system directory", () => {
  assert.match(prepare, /Exec\(ExpandConstant\('\{sys\}\\taskkill\.exe'\)/);
  assert.doesNotMatch(prepare, /\{cmd\}.*taskkill/i);
  assert.match(prepare, /\/IM SecAgent\.exe \/F \/T/);
});
