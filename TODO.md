# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R18 · 2026-10-08 18:29 继续）

### 样式修复（用户 5 图）— 全部完成 ✓
- ✓ 图1 titleBarOverlay 白底深符号 + 双窗 backgroundColor 白（橙图标实测已蓝，ClassIsland 侧除外）
- ✓ 图2 AuroraBackdrop 蓝系光斑 + 白 fade
- ✓ 图3 设置布局 190px/min-width 640/divider 透气
- ✓ 图4/5 ScrollProgress 单节禁止展开
- ✓ 图6 composer-orb-dock 白化
（CI ec179ec 主检查 success；a621377 三平台打包运行中/低风险）

### 真源直译 — 已完成
- ✓ assistant-ui elements 7 个：NumberTicker/ToolError/MessageQueue/RegenerateMenu/
  SpeakerIdentity/ComputerUse/DaySeparatorTranscript（R17，CI ec179ec 绿）
- ✓ react-bits 2 个：VoiceRecorder（voice-pill 真源完整重译：hold/toggle/slide-cancel/
  波形/音节曲线/stop-reason 状态机）、BranchedMenu（SVG 分支线动画树菜单）（R18，a621377）
- ✓ demo 验证：17 类组件挂载零错误；ToolError/BranchedMenu/NumberTicker/VoiceRecorder
  渲染正常；发现并修复 demo @theme 残留深色 token（R15 替换未命中的遗留）

### 应用侧接线（待定项，下轮讨论）
- ☐ VoiceRecorder 替换 composer 语音键（hold 模式对接 handleMicPointerDown）
- ☐ ToolError 接入工具调用失败展示
- ☐ MessageQueue 接入排队发送
- ☐ PromptBar（35KB）评估：替换 composer
- ☐ 已有 7 组件按真源 diff 重译（day-separator 真源=列表语义，与现分隔条并存）

## 历史（已完成）## 历史（已完成）
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
