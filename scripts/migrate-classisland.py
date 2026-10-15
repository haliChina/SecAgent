#!/usr/bin/env python3
"""B1-2：迁移 classisland.ts 到共享内核（行号倒序删除，rg 1-based 已修正）。
保留 9 个特有函数（runtime 进程判断/插件就绪探测/健康等待/restart args/
canonical exe/readPackageType/布局解析）。"""
import re, subprocess, sys

P = "src/classisland.ts"

def spans():
    out = subprocess.run(["rg", "-n", "^(async )?function [a-zA-Z]", P], capture_output=True, text=True).stdout.strip().split("\n")
    return {int(l.split(":", 1)[0]) - 1: re.match(r"(?:async )?function ([A-Za-z]+)", l.split(":", 1)[1]).group(1) for l in out}

KILL = {"platformPath", "normalizePath", "hashId", "defaultExists", "defaultReadFile",
        "defaultCommandRunner", "quotePowerShell", "parseJsonList",
        "discoverWindowsExternalPaths", "discoverRunningProcesses",
        "escapeRegExp", "releaseTagFromPage", "releaseAssetFromExpandedPage",
        "fetchReleasePageMetadata", "parseWindowsCommandLine",
        "waitForInstalledPlugin", "defaultVersionOf",
        "downloadLatestClassIslandPlugin",
        "defaultRequestGracefulClose", "defaultForceTerminate", "defaultIsProcessRunning"}

st = spans()
lines = open(P, encoding="utf-8").read().split("\n")
for start in sorted(st.keys(), reverse=True):
    name = st[start]
    if name not in KILL:
        continue
    if lines[start].rstrip().endswith("}"):
        end = start
    else:
        end = start
        while lines[end] != "}":
            end += 1
    del lines[start:end+1]
    while start < len(lines) and lines[start].strip() == "":
        del lines[start]
s = "\n".join(lines)

# —— ReleaseMetadata 接口删除（shared 版替代）——
ln = s.split("\n")
try:
    i0 = next(i for i, l in enumerate(ln) if l.startswith("interface ClassIslandReleaseMetadata {"))
    i1 = i0
    while ln[i1] != "}":
        i1 += 1
    del ln[i0:i1+2]
    s = "\n".join(ln)
except StopIteration:
    pass

# —— 调用点适配 ——
subs = [
    ("await discoverRunningProcesses(platform, commandRunner)",
     "await discoverRunningProcesses(platform, commandRunner, [WINDOWS_CLASSISLAND_EXE, WINDOWS_CLASSISLAND_RUNTIME_EXE])"),
    ("await discoverWindowsExternalPaths(commandRunner, env)",
     '''await discoverWindowsExternalPaths(commandRunner, env, {
      displayNameFilter: "-like '*ClassIsland*'",
      targetPathPattern: "(?i)ClassIsland"
    })'''),
    ("await downloadLatestClassIslandPlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log(\"download.attempt\", attempt))",
     "await downloadLatestCompanionPlugin(this.fetcher, this.options.now || Date.now, (phase, message) => report(phase, message), (attempt) => log(\"download.attempt\", attempt), CLASSISLAND_DOWNLOAD_SPEC)"),
]
for old, new in subs:
    assert old in s, f"调用点未命中: {old[:70]}"
    s = s.replace(old, new, 1)

# —— compareClassIslandVersions → 委托 shared（保持测试契约导出）——
old_cmp = '''export function compareClassIslandVersions(left: string, right: string): number {
  const parse = (value: string) => value.trim().replace(/^v/i, "").split(/[.+-]/).map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}'''
new_cmp = "export function compareClassIslandVersions(left: string, right: string): number {\n  return compareVersions(left, right);\n}"
assert old_cmp in s, "compareClassIslandVersions 函数体不匹配"
s = s.replace(old_cmp, new_cmp, 1)

# —— DOWNLOAD_SPEC 常量（在 RELEASE_API_URL 定义后插入）——
anchor = 'export const CLASSISLAND_RELEASE_API_URL = `https://api.github.com/repos/${CLASSISLAND_PLUGIN_REPOSITORY}/releases/latest`;'
assert anchor in s
s = s.replace(anchor, anchor + '''

const CLASSISLAND_DOWNLOAD_SPEC = {
  productName: "ClassIsland",
  releaseApiUrl: CLASSISLAND_RELEASE_API_URL,
  releasePageUrl: `https://github.com/${CLASSISLAND_PLUGIN_REPOSITORY}/releases/latest`,
  repository: CLASSISLAND_PLUGIN_REPOSITORY,
  assetName: CLASSISLAND_PLUGIN_ASSET_NAME,
  maxBytes: MAX_CLASSISLAND_PLUGIN_BYTES,
} satisfies CompanionDownloadSpec;''', 1)

# —— import 插入 ——
IMPORT = ('import { compareVersions, defaultCommandRunner, defaultExists, defaultForceTerminate, defaultIsProcessRunning, '
          'defaultReadFile, defaultRequestGracefulClose, defaultVersionOf, discoverRunningProcesses, discoverWindowsExternalPaths, '
          'downloadLatestCompanionPlugin, hashId, normalizePath, parseJsonList, parseWindowsCommandLine, platformPath, '
          'waitForInstalledPlugin, type CommandRunner, type CompanionDownloadSpec, type DiscoveredProcess, type Fetcher, type PathApi, type SupportedPlatform } '
          'from "./companion-installer-shared.js";\n')
anchor_imp = 'from "./companion-package.js";\n'
assert anchor_imp in s
s = s.replace(anchor_imp, anchor_imp + IMPORT, 1)

# —— RunningProcess 类型别名 ——
old_iface = "export interface ClassIslandRunningProcess {\n  executablePath: string;\n  pid: number;\n  commandLine?: string;\n  version?: string;\n  processName?: string;\n}"
assert old_iface in s
s = s.replace(old_iface, "export type ClassIslandRunningProcess = DiscoveredProcess;")

# —— 本地 type 定义删除 ——
for pat in [r"^type SupportedPlatform = NodeJS\.Platform;\n",
            r"^type PathApi = typeof path\.win32;\n",
            r"^type Fetcher = \(input: string \| URL, init\?: RequestInit\) => Promise<Response>;\n",
            r"^type CommandRunner = \(file: string, args: string\[\]\) => Promise<\{ stdout: string; stderr: string \}>;\n"]:
    s = re.sub(pat, "", s, count=1, flags=re.M)

s = re.sub(r"\n{3,}", "\n\n", s)
open(P, "w", encoding="utf-8").write(s)

# —— 平衡验证 ——
d = 0
for ch in s:
    if ch == "{": d += 1
    elif ch == "}": d -= 1
assert d == 0, f"括号不平衡：{d}"
print(f"classisland 迁移完成：{s.count(chr(10))+1} 行")
