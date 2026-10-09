#!/usr/bin/env python3
"""B1-2：迁移 iccce.ts 到共享内核（保守版）。
行为差异函数保留（用户红线：原版行为是金标准）：
- discoverRunningProcesses（PS 脚本无 processName 字段、join 无空格）
- defaultVersionOf（仅 win32 六行版）
- downloadLatestIcccePlugin（单 URL 直连结构，非 directUrl 数组包裹）
- 15 个 iccce 特有函数（日志诊断/健康探测）"""
import re, subprocess, sys

P = "src/iccce.ts"

def spans():
    out = subprocess.run(["rg", "-n", "^(async )?function [a-zA-Z]", P], capture_output=True, text=True).stdout.strip().split("\n")
    return {int(l.split(":", 1)[0]) - 1: re.match(r"(?:async )?function ([A-Za-z]+)", l.split(":", 1)[1]).group(1) for l in out}

KILL = {"platformPath", "normalizePath", "hashId", "defaultExists", "defaultReadFile",
        "defaultCommandRunner", "quotePowerShell", "parseJsonList",
        "discoverWindowsExternalPaths",
        "escapeRegExp", "releaseTagFromPage", "releaseAssetFromExpandedPage",
        "fetchReleasePageMetadata", "parseWindowsCommandLine",
        "waitForInstalledPlugin",
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

# —— 调用点适配 ——
subs = [
    ("await discoverWindowsExternalPaths(commandRunner, env)",
     '''await discoverWindowsExternalPaths(commandRunner, env, {
      displayNameFilter: "-match '(?i)(ICC\\\\s*[- ]?CE|Ink\\\\s*Canvas)'",
      targetPathPattern: "(?i)(InkCanvasForClass|Ink Canvas|ICC[- ]?CE)"
    })'''),
    ("release = await fetchReleasePageMetadata(fetcher, now)",
     "release = await fetchReleasePageMetadata(fetcher, now, ICCCE_RELEASE_PAGE_URL, ICCCE_PLUGIN_REPOSITORY, ICCCE_PLUGIN_ASSET_NAME)"),
]
for old, new in subs:
    assert old in s, f"调用点未命中: {old[:70]}"
    s = s.replace(old, new)

# —— import 注入（companion-package 之后）——
IMPORT = ('import { defaultCommandRunner, defaultExists, defaultForceTerminate, defaultIsProcessRunning, defaultReadFile, defaultRequestGracefulClose, discoverWindowsExternalPaths, fetchReleasePageMetadata, hashId, normalizePath, parseJsonList, parseWindowsCommandLine, platformPath, quotePowerShell, waitForInstalledPlugin, type CommandRunner, type DiscoveredProcess, type Fetcher, type PathApi, type SupportedPlatform } from "./companion-installer-shared.js";\n')
anchor = 'from "./companion-package.js";\n'
assert anchor in s
s = s.replace(anchor, anchor + IMPORT, 1)

# —— 本地 type 定义删除（shared 已供）——
for pat in [r"^type SupportedPlatform = NodeJS\.Platform;\n",
            r"^type PathApi = typeof path\.win32;\n",
            r"^type Fetcher = \(input: string \| URL, init\?: RequestInit\) => Promise<Response>;\n",
            r"^type CommandRunner = \(file: string, args: string\[\]\) => Promise<\{ stdout: string; stderr: string \}>;\n"]:
    s = re.sub(pat, "", s, count=1, flags=re.M)

s = re.sub(r"\n{3,}", "\n\n", s)
open(P, "w", encoding="utf-8").write(s)

d = 0
for ch in s:
    if ch == "{": d += 1
    elif ch == "}": d -= 1
assert d == 0, f"括号不平衡：{d}"
print(f"iccce 迁移完成：{s.count(chr(10))+1} 行")
