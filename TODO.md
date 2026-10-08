# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R24 · 2026-10-08 21:14）

### 用户实测反馈修复（R21 包 9 项 UI + 唤醒不发声）— 完成 ✓
- ✓ demo 8 组件样式暴毙：根因=直译组件 Tailwind 类 demo 无 Tailwind，
  postcss 编译 utilities 注入 demo HTML，AnimatedCounter/侧栏等全恢复
- ✓ Cancel 残留：--vp-* 60 变量整块缺失（r19 漏搬），真源 voice-pill
  CSS 注入（.rb-vp 前缀共存）
- ✓ 录音框打架/主主主主/HookSidebar 卡片化/Orb溢出/小Orb/今天空框/
  ScrollProgress 点不动/图标对齐/标题栏配色 —— 9 项全修（e94c647）
- ✓ 唤醒不发声：模型未输出 <tts> 标签 → 静音；完成态整段朗读兜底
- ☐ PromptBar 替换 composer 专项（拍板=是：语音三分区/附件/引用迁移）
- ✓ 安装包已交付：SecAgent-Setup-20261008-134156-0cc77615078d.exe（三平台 CI 全绿，含 9 项 UI 修复+TTS 兜底+思考反馈+确认音）
- ☐ 语音识别设置意义不明已修（主引擎下拉）；待新版包验证

## 历史（已完成）## 历史（已完成）## 历史（已完成）## 历史（已完成）## 历史（已完成）## 历史（已完成）
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
