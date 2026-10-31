#!/usr/bin/env node
/**
 * 孤儿 CSS 扫描（B5）：找出 renderer 样式表里没有任何 ts/tsx/html 引用的类。
 *
 * 判定规则（保守）：
 * - 扫描 src/renderer 下所有 .css（styles.css 为主；P4 按窗口分域后自动覆盖拆分文件）
 * - 提取选择器段（} 之前）里 .类名 形式的 token；属性值在花括号内不会被扫到
 * - 在 renderer 下所有 ts、tsx、html 文件里做子串匹配（className 字符串/
 *   模板拼接/动态拼接只要有完整类名字符串即可命中）
 * - 动态拼接/运行时注入的类经 allowlist 放行
 * 退出码：发现新孤儿类 = 1（CI 阻断），否则 0。
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "src", "renderer");
const ALLOWLIST_PATH = join(ROOT, "scripts", "orphan-css-allowlist.json");
const ALLOWLIST = existsSync(ALLOWLIST_PATH) ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) : [];

function walk(dir, filter, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, filter, out);
    else if (filter.test(name)) out.push(full);
  }
  return out;
}

const cssFiles = walk(SRC_DIR, /\.css$/);
if (!cssFiles.length) {
  console.error("未找到 renderer CSS 文件");
  process.exit(1);
}
const classNames = new Set();
for (const cssFile of cssFiles) {
  const css = readFileSync(cssFile, "utf8");
  for (const selector of css.replace(/\/\*[\s\S]*?\*\//g, "").match(/([^{}]+)\{/g) || []) {
    for (const match of selector.matchAll(/\.([A-Za-z_][-\w]*)/g)) classNames.add(match[1]);
  }
}

const sources = walk(SRC_DIR, /\.(ts|tsx|html)$/).map((file) => readFileSync(file, "utf8")).join("\n");
const orphans = [...classNames].filter((name) => !ALLOWLIST.includes(name) && !sources.includes(name));

if (orphans.length) {
  console.error(`孤儿 CSS 类 ${orphans.length} 个（renderer 源码无引用）：`);
  for (const name of orphans.sort()) console.error(`  .${name}`);
  console.error("动态注入/运行时拼接的类请加入 scripts/orphan-css-allowlist.json");
  process.exit(1);
}
console.log(`孤儿 CSS 扫描通过：0 个（${cssFiles.length} 个样式表共 ${classNames.size} 个类）。`);
