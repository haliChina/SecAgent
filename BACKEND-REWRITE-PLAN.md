# 后端重写计划（B 系列 · 2026-10-09 R33 审计）

> 承接 UI-REWRITE-PLAN.md（P 系列）。用户指示：UX 及后端一并重写优化。
> 同一纪律：先审计后动手，每阶段可验证、可回退、独立提交。

## B0 审计结果（2026-10-09）

### 代码地形（src/ 共 ~15.2k 行主进程 + electron/ 2.6k + asr/ 3.1k + tts/ 0.9k）

| 区域 | 规模 | 问题 |
|---|---|---|
| electron/main.ts | **1691 行** | 后端的 Bits.tsx：70 个 IPC 通道 + 自启动三平台策略 + 窗口管理（主/设置/唤醒/预览）+ 伴随进程执行器 + 4 安装器接线 + 更新管理 + 文件预览 + 快捷键全部混居 |
| 四大安装器 | **3702 行** | classisland(943)/classwidgets(813)/iccce(1094)/secrandom(852) 平行复制：同 `install(targetIds, onProgress, executor)` 签名、同五阶段（downloading/verifying/installing/closing/restarting）、同 GitHub release 下载+版本比对+进程发现模式，仅常量与细节不同 |
| companion-package.ts | 1044 行 | 打包侧，与安装器共享领域概念但独立实现 |
| 死导出 | 12 个 | isLocalAsrAvailable/isRemoteAsrEvent/findAsrPreset/companionCatalog/writeCompanionPackage/startCompanionProcessUnelevated/DEFAULT_TOOL_GUARD/approvalSignature/MIMO_TTS_VOICES/DEFAULT_TTS_SETTINGS/TTS_PROVIDER_LABELS/isValidWakeHotkey（连测试都零引用） |
| asr/ tts/ | 结构好 | provider 分文件 + manager 中转，可作后端重写的范本 |
| 测试覆盖 | 24 测试文件 | 强项！任何重构的安全网，必须保持全绿 |

### 风险与依赖

- CI 已含全部单测 + 冒烟：每次重构提交即时验证
- 安装器四兄弟有各自 .test.ts（classisland 536/iccce 514 行等）：重构时以测试为契约
- main.ts 无测试（Electron 主进程惯例）：靠类型 + 三平台打包冒烟

## 阶段计划

### B1：清死 + 安装器统一（风险低收益大）
- 删 12 个死导出（~150 行）
- 四安装器提取 `CompanionInstallerBase`（模板方法）：
  每平台一个 descriptor（repo/asset/version 正则/可执行名/安装目录/健康 URL）
  + 平台差异子类。预期 3702 → ~1500 行
- 验收：四个安装器 .test.ts 全绿不改断言；IPC 行为零变化

### B2：main.ts 解体（纯搬家先行）
- 按域拆分：`main/windows.ts`（主/设置/唤醒/预览窗口）、`main/ipc-*.ts`
  （按域分组 70 通道）、`main/autostart.ts`、`main/companion-executors.ts`
- main.ts 变装配入口（<300 行）
- 验收：IPC 通道清单 diff 为零（改前改后各 dump 一份对比）

### B3：随解体逐域真源重写（同 UI P3 纪律）
- 每域一提交；IPC handler 瘦身为纯委托（业务已在域模块）

### B4：UX 剩余部分（与 UI P3 并轨）
- App.tsx 1019 行拆分（消息流/composer/轨道面板等）
- SettingsApp/OobeWizard 拆分
- styles.css 678 行继续按窗口分域（P4 原计划）

### B5：终检
- 死导出扫描脚本进 CI（防复发）
- 孤儿 CSS 扫描脚本进 CI（UI P5 原计划）

## 顺序与并行

UI P 系列（组件重写）与 B 系列交替推进，每轮一个可交付安装包。
B1 优先（最大 ROI：-2200 行且测试保护完整）。
