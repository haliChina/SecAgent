#!/usr/bin/env python3
"""B1-2：迁移 secrandom.ts 到共享内核（行号倒序删除版）。
保留：defaultVersionOf（平台差异版）/downloadLatestSecRandomPlugin 及其
release 解析链（固定 tag 结构）/8 个特有函数。"""
import re, subprocess, sys

P = "src/secrandom.ts"

def spans():
    out = subprocess.run(["rg", "-n", "^(async )?function [a-zA-Z]", P], capture_output=True, text=True).stdout.strip().split("\n")
    # rg 行号 1-based → list 0-indexed 转换
    return {int(l.split(":", 1)[0]) - 1: re.match(r"(?:async )?function ([A-Za-z]+)", l.split(":", 1)[1]).group(1) for l in out}

KILL = {"platformPath", "normalizePath", "hashId", "defaultExists", "defaultReadFile",
        "defaultCommandRunner", "quotePowerShell", "parseJsonList",
        "discoverWindowsExternalPaths", "discoverRunningProcesses",
        "parseWindowsCommandLine",
        "waitForInstalledPlugin",
        "defaultRequestGracefulClose", "defaultForceTerminate", "defaultIsProcessRunning"}

st = spans()
lines = open(P, encoding="utf-8").read().split("\n")
for start in sorted(st.keys(), reverse=True):
    name = st[start]
    if name not in KILL:
        continue
    if lines[start].rstrip().endswith("}"):
        end = start  # 单行函数：签名行即完整函数
    else:
        end = start
        while lines[end] != "}":
            end += 1
    del lines[start:end+1]
    # 吞块后空行（保持段落）
    while start < len(lines) and lines[start].strip() == "":
        del lines[start]
s = "\n".join(lines)

# —— 调用点适配 ——
subs = [
    ("await discoverRunningProcesses(platform, commandRunner)",
     """await discoverRunningProcesses(platform, commandRunner, ["SecRandom.Desktop.exe", "secrandom.exe"])"""),
    ("await discoverWindowsExternalPaths(commandRunner, env)",
     """await discoverWindowsExternalPaths(commandRunner, env, {
      displayNameFilter: "-like '*SecRandom*'",
      targetPathPattern: "(?i)SecRandom"
    })"""),
]
for old, new in subs:
    assert old in s, f"调用点未命中: {old[:70]}"
    s = s.replace(old, new)

# —— import（放 companion-package import 之后）——
IMPORT = ('import { defaultCommandRunner, defaultExists, defaultForceTerminate, defaultIsProcessRunning, defaultReadFile, '
          'defaultRequestGracefulClose, discoverRunningProcesses, discoverWindowsExternalPaths, hashId, normalizePath, '
          'parseJsonList, parseWindowsCommandLine, platformPath, waitForInstalledPlugin, '
          'type CommandRunner, type DiscoveredProcess, type Fetcher, type PathApi, type SupportedPlatform } from "./companion-installer-shared.js";\n')
anchor = 'from "./companion-package.js";\n'
assert anchor in s
s = s.replace(anchor, anchor + IMPORT, 1)

# —— 类型别名（RunningProcess 接口 → DiscoveredProcess；字段一致）——
old_iface = "export interface SecRandomRunningProcess {\n  executablePath: string;\n  pid: number;\n  commandLine?: string;\n  version?: string;\n}"
assert old_iface in s
s = s.replace(old_iface, "export type SecRandomRunningProcess = DiscoveredProcess;")

# 本地 type 定义删除（shared 已供）
for pat in [r"^type SupportedPlatform = NodeJS\.Platform;\n",
            r"^type PathApi = typeof path\.win32;\n",
            r"^type Fetcher = \(input: string \| URL, init\?: RequestInit\) => Promise<Response>;\n",
            r"^type CommandRunner = \(file: string, args: string\[\]\) => Promise<\{ stdout: string; stderr: string \}>;\n"]:
    s = re.sub(pat, "", s, count=1, flags=re.M)

s = re.sub(r"\n{3,}", "\n\n", s)
open(P, "w", encoding="utf-8").write(s)
print(f"secrandom 迁移完成：{s.count(chr(10))+1} 行")
