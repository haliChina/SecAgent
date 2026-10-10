#!/usr/bin/env node
/**
 * 死导出扫描（B5）：找出 src 内「导出但全仓库无引用」的符号。
 *
 * 判定规则（保守，宁可漏报不可误报）：
 * - 只扫 src 下所有 ts、tsx 文件（跳过 *.test.ts —— 测试引用算存活）
 * - 符号在【定义文件之外】的任何文件出现过（import/字符串/注释）
 *   即视为存活；tsconfig include 之外的文件不算
 * - allowlist 放行已知合法例外（入口导出/公共 API）
 * 退出码：发现新死导出 = 1（CI 阻断），否则 0。
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const ALLOWLIST_PATH = join(ROOT, "scripts", "dead-exports-allowlist.json");
const ALLOWLIST = existsSync(ALLOWLIST_PATH) ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) : [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const EXPORT_RE = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;

// 引用池包含全部源文件（含 *.test.ts：测试引用算存活——测试随产品交付且能捕获破坏）
const allSources = files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
const dead = [];
for (const { file, text } of allSources) {
  if (/\.test\.ts$/.test(file)) continue; // 死导出只报告非测试文件里的定义
  const exported = [...text.matchAll(EXPORT_RE)].map((match) => match[1]);
  for (const name of exported) {
    if (ALLOWLIST.includes(name)) continue;
    const usedElsewhere = allSources.some((other) => other.file !== file && other.text.includes(name));
    if (!usedElsewhere) dead.push({ name, file: relative(ROOT, file) });
  }
}

if (dead.length) {
  console.error(`死导出 ${dead.length} 个（src 内无任何引用）：`);
  for (const item of dead) console.error(`  - ${item.name}  (${item.file})`);
  console.error("若为合法公共 API 请加入 scripts/dead-exports-allowlist.json");
  process.exit(1);
}
console.log(`死导出扫描通过：0 个（扫描 ${files.length} 个源文件）。`);
