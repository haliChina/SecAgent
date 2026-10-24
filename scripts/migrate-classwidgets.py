#!/usr/bin/env python3
"""B1-2：迁移 classwidgets.ts（行号倒序删除版，避免 span 回退 bug）。"""
import re, subprocess, sys

P = "src/classwidgets.ts"

# 1) 收集要删的函数行区间（签名行 → 顶格 } 行）
def spans():
    out = subprocess.run(["rg", "-n", "^(async )?function [a-zA-Z]", P], capture_output=True, text=True).stdout.strip().split("\n")
    starts = {}
    for l in out:
        n, sig = l.split(":", 1)
        name = re.match(r"(?:async )?function ([A-Za-z]+)", sig).group(1)
        starts[int(n)] = name
    return starts

KILL = {"platformPath", "normalizePath", "hashId", "defaultExists", "defaultReadFile",
        "defaultCommandRunner", "quotePowerShell", "parseJsonList",
        "discoverWindowsExternalPaths", "discoverRunningProcesses",
        "escapeRegExp", "releaseTagFromPage", "releaseAssetFromExpandedPage",
        "fetchReleasePageMetadata", "parseWindowsCommandLine",
        "waitForInstalledPlugin", "defaultVersionOf",
        "downloadLatestClassWidgetsPlugin",
        "defaultRequestGracefulClose", "defaultForceTerminate", "defaultIsProcessRunning"}

starts = spans()
lines = open(P, encoding="utf-8").read().split("\n")
# 顶格 } 行集合
close_lines = {i for i, l in enumerate(lines) if l == "}"}

ranges = []
for n0, name in starts.items():
    if name not in KILL:
        continue
    i0 = n0 - 1  # 0-based
    # 前导 JSDoc（整段以 */ 结尾且紧邻）
    j = i0 - 1
    while j >= 0 and lines[j].strip().startswith(("*", "//")):
        j -= 1
    if j >= 0 and lines[j].strip() == "/**":
        i0 = j
    # 函数闭 }（>= i0 的第一个顶格 }）
    i1 = min(c for c in close_lines if c >= i0)
    ranges.append((i0, i1, name))

assert len(ranges) == len(KILL), f"应删 {len(KILL)} 实删 {len(ranges)}：{[r[2] for r in ranges]}"
for i0, i1, name in sorted(ranges, reverse=True):
    # 连带尾部空行
    e = i1 + 1
    while e < len(lines) and lines[e] == "":
        e += 1
    del lines[i0:e]
s = "\n".join(lines)
# 删 ReleaseMetadata 接口（体含嵌套 {}，按行删）
lines2 = s.split("\n")
i0 = next(i for i, l in enumerate(lines2) if l.startswith("interface ClassWidgetsReleaseMetadata {"))
i1 = i0
while lines2[i1] != "}":
    i1 += 1
del lines2[i0:i1+2]
s = "\n".join(lines2)

# 2) 调用点适配
subs = [
    ("await discoverRunningProcesses(platform, commandRunner)",
     "await discoverRunningProcesses(platform, commandRunner, [WINDOWS_CLASSWIDGETS_EXE])"),
    ("await discoverWindowsExternalPaths(commandRunner, env)",
     """await discoverWindowsExternalPaths(commandRunner, env, {
      displayNameFilter: "-like '*Class*Widgets*'",
      targetPathPattern: "(?i)Class.?Widgets"
    })"""),
    ("await downloadLatestClassWidgetsPlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log(\"download.attempt\", attempt))",
     "await downloadLatestCompanionPlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log(\"download.attempt\", attempt), CLASSWIDGETS_DOWNLOAD_SPEC)"),
]
for old, new in subs:
    assert old in s, f"调用点未命中: {old[:70]}"
    s = s.replace(old, new)

# waitForInstalledPlugin：末尾加 compareVersions 注入（多行调用，正则处理）
s = re.sub(
    r"(await waitForInstalledPlugin\(\s*\(\) => installedPluginVersion\(group\[0\]\.pluginsPath, this\.platform, exists, defaultReadFile\),\s*packageData\.version,\s*this\.options\.waitForPluginTimeoutMs,\s*this\.options\.waitForPluginPollMs)\s*\)",
    r"\1, compareClassWidgetsVersions\n        )", s, count=1)
assert "compareClassWidgetsVersions\n        )" in s, "waitForInstalledPlugin 注入未命中"

# 3) DownloadSpec 常量（插在 CLASSWIDGETS_RELEASE_API_URL 常量后）
s = s.replace(
    "export const CLASSWIDGETS_RELEASE_API_URL = `https://api.github.com/repos/${CLASSWIDGETS_PLUGIN_REPOSITORY}/releases/latest`;",
    "export const CLASSWIDGETS_RELEASE_API_URL = `https://api.github.com/repos/${CLASSWIDGETS_PLUGIN_REPOSITORY}/releases/latest`;\n\n/** B1-2：共享下载内核的差异化描述（GitHub Release 下载降级链/资产名/体积上限）。 */\nexport const CLASSWIDGETS_DOWNLOAD_SPEC: CompanionDownloadSpec = {\n  productName: \"Class Widgets\",\n  releaseApiUrl: CLASSWIDGETS_RELEASE_API_URL,\n  releasePageUrl: CLASSWIDGETS_RELEASE_PAGE_URL,\n  repository: CLASSWIDGETS_PLUGIN_REPOSITORY,\n  assetName: CLASSWIDGETS_PLUGIN_ASSET_NAME,\n  maxBytes: MAX_CLASSWIDGETS_PLUGIN_BYTES\n};")

# 4) import 区（companion-package 后加 shared）
s = s.replace(
    'import { closeHostProcesses, enumerateHostProcesses, installCompanionPackage, startCompanionProcessWithSameElevation, type CompanionExecutor, type CompanionLogger, type CompanionPackageSpec, type HostProcessFilter, type HostProcessInfo } from "./companion-package.js";',
    'import { closeHostProcesses, enumerateHostProcesses, installCompanionPackage, startCompanionProcessWithSameElevation, type CompanionExecutor, type CompanionLogger, type CompanionPackageSpec, type HostProcessFilter, type HostProcessInfo } from "./companion-package.js";\nimport { defaultCommandRunner, defaultExists, defaultForceTerminate, defaultIsProcessRunning, defaultReadFile, defaultRequestGracefulClose, defaultVersionOf, discoverRunningProcesses, discoverWindowsExternalPaths, downloadLatestCompanionPlugin, parseJsonList, platformPath, waitForInstalledPlugin, type CommandRunner, type CompanionDownloadSpec, type DiscoveredProcess, type Fetcher, type PathApi, type SupportedPlatform } from "./companion-installer-shared.js";')

# 5) 类型兼容
s = s.replace("export interface ClassWidgetsRunningProcess {\n  executablePath: string;\n  pid: number;\n  commandLine?: string;\n  version?: string;\n  processName?: string;\n}",
              "export type ClassWidgetsRunningProcess = DiscoveredProcess;")
# 本地类型别名（供保留代码引用）
s = s.replace("const execFileAsync = promisify(execFile);",
              "type SupportedPlatform = NodeJS.Platform;\ntype PathApi = typeof path.win32;\ntype Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;\ntype CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;\n\nconst execFileAsync = promisify(execFile);")
# 上面 import 里已有同名 type → 改为不重复定义：直接删本地别名
s = s.replace("type SupportedPlatform = NodeJS.Platform;\ntype PathApi = typeof path.win32;\ntype Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;\ntype CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;\n\nconst execFileAsync", "const execFileAsync")

# 6) 旧独立 type 行删除（源文件头部 27-30 行的本地 type 定义）
for pat in [r"^type SupportedPlatform = NodeJS\.Platform;\n",
            r"^type PathApi = typeof path\.win32;\n",
            r"^type Fetcher = \(input: string \| URL, init\?: RequestInit\) => Promise<Response>;\n",
            r"^type CommandRunner = \(file: string, args: string\[\]\) => Promise<\{ stdout: string; stderr: string \}>;\n"]:
    s = re.sub(pat, "", s, count=1, flags=re.M)

s = re.sub(r"\n{3,}", "\n\n", s)
open(P, "w", encoding="utf-8").write(s)
print(f"迁移完成：{s.count(chr(10))+1} 行")
