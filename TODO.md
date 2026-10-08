# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R23 · 2026-10-08 20:38）

### PromptBar 真源直译 — 完成 ✓
- ✓ 862 行真源直译进 Bits（@源 //命令 模型 推理强度 附件 听写 发送/停止/
  SVG send 键形变动画），hugeicons 13 个→lucide，tsc 类型零真实错误
- ✓ 主检查 success（56aeef6），三平台打包运行中
- ✓ demo V5：PromptBar 白蓝配色（真源 props 原生换色 background/color/
  menuBackground/sparkColor）、命令菜单交互验证、VLM 终检通过
- ☐ **应用 composer 替换 PromptBar：待用户确认**（需迁移 textarea 长按
  语音三分区/图片粘贴/拖拽上传/引用——onDictate 对接语音流）
- ☐ **MessageQueue 接入：待用户确认**（排队发送行为变更）
- ☐ 已有 7 组件真源 diff 重译评估（day-separator 真源=列表段落语义，
  与现分隔条语义不同，并存合理；其余差异大的已用真源版替换）

## 历史（已完成）## 历史（已完成）## 历史（已完成）## 历史（已完成）## 历史（已完成）
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
