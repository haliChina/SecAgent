# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R19 · 2026-10-08 19:21）

### 真源组件应用接线 — 完成 ✓（R20 交付）

- ✓ R20：7b3a5b6 三平台 windows/macos 绿（linux 收尾中）；Windows 安装包
  SecAgent-Setup-20261008-113811-7b3a5b6f0976.exe（213.7MB）已 16 线程下载、
  PE 校验后交付用户
- ☐ TODO.md 本地更新未推送（攒下轮随代码提交，避免单独触发 CI）

- ✓ composer 语音键 → 真源 VoiceRecorder（mode=auto 短按 streaming/长按 hold、
  simulated 波形、slide-to-cancel→cancel、蓝白配色、holdAfter=600）
- ✓ 工具失败展示 → 真源 ToolError（适配层放宽 target/attempt 系列为可选）
- ✓ 接线过程 CI typecheck 抓到 2 处接口不匹配（40b12e6 失败），修正后
  7b3a5b6 主检查 success ✓，三平台打包运行中
- ☐ MessageQueue 接入：需要 composer 排队发送行为（执行中收输入、完成后
  自动发）——**行为变更，待用户确认**再做
- ☐ PromptBar（35KB）：完整 composer 替换候选（含 @源菜单 //命令菜单/模型
  选择器/听写/附件）——体量大，建议下轮专项
- ☐ VoiceRecorder reactive=mic 源：把应用 micStream 传给组件替代 simulated
  （需读真源中部音频接入段，确认不与应用 getUserMedia 冲突）

### 顺延（更早遗留）
- ☐ 已有 7 组件按真源 diff 重译（day-separator 真源=列表语义，与现分隔条并存）

## 历史（已完成）## 历史（已完成）## 历史（已完成）
- ✓ R14 rareui 组件直译进 Bits.tsx（motion/react 引擎）：MatrixOrb、HookSidebar、
  ScrollProgress、DeleteButton、AnimatedCounter、VoiceNote、VoicePill、ThoughtLine、
  DaySeparator、GuardrailNotice、MessageActions、ErrorStateCard、StoppedRunTag
- ✓ R14.1 AnimatedCounter 加 odometer 开关（默认原版语义；demo 双模式）
- ✓ R15 白+蓝浅色主题（token 全换 / 去 .dark / button reset / wake 字幕折行 /
  会话列表消息预览）；CI a6404f5 全绿；Windows 安装包已交付

## 下一轮顺延
- ☐ 按真源逐个核对 7 个已有组件的动画参数（与 rare-ui 版 diff）
- ☐ number-ticker 与 AnimatedCounter 的取舍（并存或替换）
- ☐ prompt-bar 与现有 composer 的取舍
- ☐ computer-use 面板接入工具调用展示
