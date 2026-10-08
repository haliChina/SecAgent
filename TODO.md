# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R16 · 2026-10-08 17:11）

### 样式修复（用户 5 图）
- ☐ 图1 主窗口标题栏：右侧控制按钮黑底残留 + 应用图标仍为橙色 → 蓝系
- ☐ 图2 wake 悬浮卡片：灰白→深灰渐变背景残留（浅色主题应白卡）
- ☐ 图3 设置弹窗 HookSidebar：虚线轨穿行、项间距过密
- ☐ 图4/图5 DaySeparator：圆点两态不一致（实心小点 vs 空心圆环）
- ☐ 图6 MatrixOrb 运行球：黑色容器背景残留（应浅色底蓝点阵）

### 真源组件直译（reactbits.dev + assistant-ui.com，替代 rare-ui 转抄基线）
已有组件按真源核对：voice-pill、thought-line、guardrail-notice、message-actions、
error-state、stopped-run、day-separator（7 个，先 diff 关键参数再决定是否重译）
新增直译：prompt-bar、tool-error、message-queue、speaker-identity、
regenerate-menu、computer-use、branched-menu、number-ticker（8 个）

## 历史（已完成）
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
