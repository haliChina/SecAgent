#!/usr/bin/env python3
"""B1-2：从 classwidgets.ts 机械提取通用函数 → companion-installer-shared.ts。
提取原则：函数体逐字搬运（Python 读原文区间），仅做参数化替换；
替换规则显式列出，可 diff 复核。"""
import re, sys

SRC = "tmp/classwidgets.orig.ts"
OUT = "src/companion-installer-shared.ts"

lines = open(SRC, encoding="utf-8").read().split("\n")

def fn_block(name):
    """按函数名找 [start,end]（含签名行到闭 } 行）"""
    start = end = None
    for i, l in enumerate(lines):
        if re.match(rf"^(async )?function {name}\(", l):
            start = i
            # 找到函数体的闭 }（顶格）
            j = i
            while not (lines[j] == "}" and j > i):
                j += 1
            end = j
            break
    if start is None:
        sys.exit(f"未找到函数 {name}")
    return "\n".join(lines[start:end+1])

# —— 逐字提取（无替换）——
verbatim = ["platformPath", "normalizePath", "defaultExists", "defaultReadFile",
            "defaultCommandRunner", "quotePowerShell", "parseJsonList",
            "parseWindowsCommandLine", "escapeRegExp", "releaseTagFromPage",
            "defaultRequestGracefulClose", "defaultForceTerminate", "defaultIsProcessRunning"]

blocks = {}
for n in verbatim:
    blocks[n] = fn_block(n)

# —— 参数化替换 ——
SUBS = [
    # discoverRunningProcesses：exe 名列表参数化
    ("async function discoverRunningProcesses(platform: SupportedPlatform, commandRunner: CommandRunner): Promise<ClassWidgetsRunningProcess[]> {",
     "async function discoverRunningProcesses(platform: SupportedPlatform, commandRunner: CommandRunner, exeNames: string[]): Promise<DiscoveredProcess[]> {"),
    ("$names = @('${WINDOWS_CLASSWIDGETS_EXE}')",
     "$names = @('${exeNames.join(\"', '\")}')"),
    # discoverWindowsExternalPaths：两个 PS 匹配片段参数化
    ("async function discoverWindowsExternalPaths(commandRunner: CommandRunner, env: NodeJS.ProcessEnv): Promise<string[]> {",
     "async function discoverWindowsExternalPaths(commandRunner: CommandRunner, env: NodeJS.ProcessEnv, patterns: { displayNameFilter: string; targetPathPattern: string }): Promise<string[]> {"),
    ("Where-Object { $_.DisplayName -like '*Class*Widgets*' } |",
     "Where-Object { $_.DisplayName -and $_.DisplayName ${patterns.displayNameFilter} } |"),
    ("if ($shortcut.TargetPath -match '(?i)Class.?Widgets') { $shortcut.TargetPath }",
     "if ($shortcut.TargetPath -match '${patterns.targetPathPattern}') { $shortcut.TargetPath }"),
    # releaseAssetFromExpandedPage：资产名参数化
    ("function releaseAssetFromExpandedPage(html: string): ClassWidgetsReleaseMetadata[\"assets\"][number] | undefined {",
     "function releaseAssetFromExpandedPage(html: string, assetName: string): CompanionReleaseMetadata[\"assets\"][number] | undefined {"),
    ("escapeRegExp(CLASSWIDGETS_PLUGIN_ASSET_NAME)", "escapeRegExp(assetName)"),
    # releaseAssetFromExpandedPage：裸常量同样替换（返回的资产名）
    ("return { name: CLASSWIDGETS_PLUGIN_ASSET_NAME,", "return { name: assetName,"),
    # fetchReleasePageMetadata：页面 URL/仓库/资产名参数化
    ("async function fetchReleasePageMetadata(fetcher: Fetcher, now: () => number): Promise<ClassWidgetsReleaseMetadata | undefined> {",
     "async function fetchReleasePageMetadata(fetcher: Fetcher, now: () => number, releasePageUrl: string, repository: string, assetName: string): Promise<CompanionReleaseMetadata | undefined> {"),
    ("marketplaceRequestUrls(`${CLASSWIDGETS_RELEASE_PAGE_URL}?secagent_cache=${now()}`)",
     "marketplaceRequestUrls(`${releasePageUrl}?secagent_cache=${now()}`)"),
    ("https://github.com/${CLASSWIDGETS_PLUGIN_REPOSITORY}/releases/expanded_assets/${encodeURIComponent(tag)}?secagent_cache=${now()}",
     "https://github.com/${repository}/releases/expanded_assets/${encodeURIComponent(tag)}?secagent_cache=${now()}"),
    ("new Error(`Release 页面缺少 ${CLASSWIDGETS_PLUGIN_ASSET_NAME} 或 SHA-256`)",
     "new Error(`Release 页面缺少 ${assetName} 或 SHA-256`)"),
    # hashId：参数名归一
    ("function hashId(executablePath: string, pluginsPath: string, platform: SupportedPlatform): string {",
     "function hashId(executablePath: string, rootPath: string, platform: SupportedPlatform): string {"),
    ("${normalizePath(pluginsPath, platform)}", "${normalizePath(rootPath, platform)}"),
]

for name in ["discoverRunningProcesses", "discoverWindowsExternalPaths",
             "releaseAssetFromExpandedPage", "fetchReleasePageMetadata", "hashId"]:
    b = fn_block(name)
    for old, new in SUBS:
        b = b.replace(old, new)
    blocks[name] = b

# —— defaultVersionOf（classisland/classwidgets 长版）——
blocks["defaultVersionOf"] = fn_block("defaultVersionOf")

# —— waitForInstalledPlugin：版本比较器注入 ——
w = fn_block("waitForInstalledPlugin")
w = w.replace("async function waitForInstalledPlugin(",
              "async function waitForInstalledPlugin<T extends (a: string, b: string) => number>(", 1) if False else w
# 简化：compareVersions 作为末参注入
w = re.sub(r"^async function waitForInstalledPlugin\(([^)]*)\):",
           lambda m: "async function waitForInstalledPlugin(" + m.group(1).rstrip(", ") + ", compareVersions: (a: string, b: string) => number):", w, count=1)
w = w.replace("compareClassWidgetsVersions(current, expectedVersion)", "compareVersions(current, expectedVersion)")
blocks["waitForInstalledPlugin"] = w

# —— downloadLatest：spec 参数化 ——
d = fn_block("downloadLatestClassWidgetsPlugin")
DSUBS = [
    ("async function downloadLatestClassWidgetsPlugin(fetcher: Fetcher, now: () => number, onProgress?: (phase: ClassWidgetsInstallPhase, message?: string) => void, onRoute?: DownloadAttemptLogger): Promise<{ bytes: Buffer; version: string; sha256: string }> {",
     "async function downloadLatestCompanionPlugin<TPhase extends string>(fetcher: Fetcher, now: () => number, onProgress: ((phase: TPhase, message?: string) => void) | undefined, onRoute: DownloadAttemptLogger | undefined, spec: CompanionDownloadSpec): Promise<{ bytes: Buffer; version: string; sha256: string }> {"),
    ('"正在通过 ghproxy.sectl.cn 下载最新 Class Widgets 插件"', 'awaiting' if False else "`正在通过 ghproxy.sectl.cn 下载最新 ${spec.productName} 插件`"),
    ("[CLASSWIDGETS_RELEASE_API_URL]", "[spec.releaseApiUrl]"),
    ("await fetchReleasePageMetadata(fetcher, now)", "await fetchReleasePageMetadata(fetcher, now, spec.releasePageUrl, spec.repository, spec.assetName)"),
    ("无法读取 Class Widgets 最新 Release", "无法读取 ${spec.productName} 最新 Release"),
    ("record.name === CLASSWIDGETS_PLUGIN_ASSET_NAME", "record.name === spec.assetName"),
    ("最新 Class Widgets Release 缺少 ${CLASSWIDGETS_PLUGIN_ASSET_NAME}", "最新 ${spec.productName} Release 缺少 ${spec.assetName}"),
    ('if (size > MAX_CLASSWIDGETS_PLUGIN_BYTES) throw new Error("Class Widgets 插件包过大，已停止安装");',
     "if (size > spec.maxBytes) throw new Error(`${spec.productName} 插件包过大，已停止安装`);"),
    ('"Class Widgets Release 缺少有效的 SHA-256 校验值"', "`${spec.productName} Release 缺少有效的 SHA-256 校验值`"),
    ("bytes.length > MAX_CLASSWIDGETS_PLUGIN_BYTES", "bytes.length > spec.maxBytes"),
    ('lastError = new Error("Class Widgets 插件包过大");', "lastError = new Error(`${spec.productName} 插件包过大`);"),
    ('error: "Class Widgets 插件包过大"', "error: `${spec.productName} 插件包过大`"),
    ('"正在校验 Class Widgets 插件 SHA-256"', "`正在校验 ${spec.productName} 插件 SHA-256`"),
    ('lastError = new Error("Class Widgets 插件 SHA-256 校验失败");', "lastError = new Error(`${spec.productName} 插件 SHA-256 校验失败`);"),
    ("下载 Class Widgets 插件失败", "下载 ${spec.productName} 插件失败"),
]
for old, new in DSUBS:
    assert old in d, f"downloadLatest 未命中: {old[:60]}"
    d = d.replace(old, new)
blocks["downloadLatestCompanionPlugin"] = d

# —— 组装文件 ——
header = '''/**
 * 伴随软件安装器共享内核（B1-2）。
 *
 * classisland/classwidgets/iccce/secrandom 四安装器经 B0 审计确认：
 * 辅助函数 13 个四文件逐字一致，5 个仅差常量注入。本模块由
 * gen-shared.py 从 classwidgets.ts 机械提取生成（函数体零手改，
 * 仅参数化替换），各安装器保留平台特有逻辑。
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DEFAULT_MARKETPLACE_PROXY_URL, describeDownloadAttempt, marketplaceRequestUrls, type DownloadAttemptLogger } from "./marketplace.js";

export type SupportedPlatform = NodeJS.Platform;
export type PathApi = typeof path.win32;
export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface CompanionReleaseMetadata {
  tag_name: string;
  assets: Array<{ name: string; browser_download_url: string; digest: string }>;
}

export interface DiscoveredProcess {
  executablePath: string;
  pid: number;
  commandLine?: string;
  version?: string;
  processName?: string;
}

export interface CompanionDownloadSpec {
  productName: string;
  releaseApiUrl: string;
  releasePageUrl: string;
  repository: string;
  assetName: string;
  maxBytes: number;
}

const execFileAsync = promisify(execFile);

'''

order = ["platformPath", "normalizePath", "hashId", "defaultExists", "defaultReadFile",
         "defaultCommandRunner", "quotePowerShell", "parseJsonList",
         "discoverWindowsExternalPaths", "discoverRunningProcesses",
         "escapeRegExp", "releaseTagFromPage", "releaseAssetFromExpandedPage",
         "fetchReleasePageMetadata", "parseWindowsCommandLine",
         "waitForInstalledPlugin", "defaultVersionOf",
         "downloadLatestCompanionPlugin",
         "defaultRequestGracefulClose", "defaultForceTerminate", "defaultIsProcessRunning"]

content = header + "\n".join("\n".join([blocks[n], ""]) for n in order)
# 顺序很重要：先 export async function，再 export function（避免双前缀）
content = re.sub(r"^async function ", "export async function ", content, flags=re.M)
content = re.sub(r"^function ", "export function ", content, flags=re.M)

open(OUT, "w", encoding="utf-8").write(content)
print(f"生成 {OUT}：{content.count('export')} 个导出，{content.count(chr(10))+1} 行")
