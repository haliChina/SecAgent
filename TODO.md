# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R21 · 2026-10-08 20:04）

### VoiceRecorder 真实麦克风源 + 4 组件真源接线 — 完成 ✓
- ✓ reactive=mic：组件自管 getUserMedia/AudioContext 生命周期，失败降级
  end(mic-denied)→cancel（与识别流并存安全：closeMic 只关自己的流）
- ✓ AuiGuardrailNotice/AuiMessageActions/AuiErrorState/AuiStoppedRun 真源
  直译接线（幻觉提醒/消息操作条/桥接错误卡/停止标签），适配层可选化 +
  未传回调按钮隐藏 + copied 内部化 + ShimmerLabel 流光内联
- ✓ CI：070eaf0 主检查抓到 AuiReaction 缺失 → 4f21124 主检查 success ✓
- ✓ linux/windows/macos（7b3a5b6）全绿确认；R19 安装包已交付
- ☐ MessageQueue 接入：**待用户确认排队行为变更**（执行中收输入完成后自动发）
- ☐ PromptBar 专项（862 行/35KB：@源 //命令 模型选择 推理强度 附件 听写——
  与应用 composer 能力一一对应，hugeicons 13 个待映射 lucide）
- ☐ 三平台（4f21124）打包完成后提取新版安装包交付

## 历史（已完成）## 历史（已完成）## 历史（已完成）## 历史（已完成）
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
