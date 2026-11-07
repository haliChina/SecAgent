# UI 重写计划（P0 审计 · 2026-10-09）

> 背景：R24-R30 七轮补丁式修复屡次失效（HookSidebar 三轮才修好、React #130 整窗崩溃、
> effort 滑杆死锁），根因是在 4882 行单文件 + 965 行补丁叠补丁的全局 CSS 上盲改。
> 本计划放弃"雕花"，改为分阶段重写，每阶段可验证、可回退。

## P0 审计结果（已完成）

### 代码地形

| 文件 | 行数 | 问题 |
|---|---|---|
| components/ui/Bits.tsx | 4882 | 21 个真源组件混居一个文件；**15 个组件零引用（约 2000 行，占 40%）** |
| styles.css | 965 | 568 条选择器；12 处 R21-R30 历史补丁注释区；特异性战争区：settings（R30 已排雷）、composer、wake |
| App.tsx | 1019 | 主窗口；17 个 Bits 导入 |
| SettingsApp.tsx | 489 | 设置窗口；AnimatedCounter + HookSidebar |
| MessageActivities.tsx | - | 仅 ToolError |

### 死组件清单（零 TS 引用，git 历史保留）

| 组件 | 约行数 | 来源 |
|---|---|---|
| MessageActions / ToolErrorCard / ErrorStateCard / GuardrailNotice / StoppedRunTag | 92 | 旧版反馈卡（已被 Aui* 系替代） |
| NumberTicker / MessageQueue / RegenerateMenu / SpeakerIdentity / ComputerUse / DaySeparatorTranscript | ~400 | assistant-ui 转录件，从未接线 |
| VoiceNote / VoiceNoteGroup | 694 | rare-ui 语音消息，从未接线 |
| VoiceRecorder | 586 | react-bits 录音器（唤醒录音另有实现） |
| BranchedMenu | 200 | react-bits，从未接线 |

对应孤儿 CSS：`.message-actions/.message-action/.tool-error-card/.error-state-card/
.error-state-body/.error-state-icon/.guardrail-notice/.guardrail-body/.guardrail-icon/
.stopped-run-tag`（651-681 行区）。

### 导入关系（Bits 的全部消费者）

- App.tsx：AuroraBackdrop, DaySeparator, DeleteButton, MatrixOrb, PromptBar, ScrollProgress,
  ThoughtLine, VoicePill, AuiGuardrailNotice, AuiMessageActions, AuiErrorState, AuiStoppedRun,
  daySeparatorId, daySeparatorLabel
- SettingsApp.tsx：AnimatedCounter, HookSidebar
- MessageActivities.tsx：ToolError

## 阶段与验收标准

### P1（本轮）：解体 + 死代码清除
- 步骤 1（纯搬家）：Bits.tsx 按真源组件拆为 `ui/parts/*.tsx`，一组件一文件；
  死组件进 `ui/parts/_dead-*.tsx`；Bits.tsx 降级为 barrel（`export *`），
  三个消费者导入路径零改动。
- 步骤 2（清除）：删 `_dead-*` 文件 + barrel 对应行 + 孤儿 CSS 块。
- 验收：`tsc` + `electron-vite build` + 单测全绿；装机行为零变化（纯结构迁移）。

### P2：设计 token 统一
- 组件内硬编码色（DB_ACCENT `#FF5F2E`、HookSidebar `#2563EB`、DB_SURFACE `#F4F4F9`、
  AUI_* 等）全部收敛到 `:root` 主题变量，组件只引用变量。
- 验收：`rg '#[0-9A-Fa-f]{6}' ui/parts/` 仅允许出现在注释中。

### P3：逐组件重写（每组件一提交）
- 从依赖最少的开始（thought-line → voice-pill → day-separator → … → prompt-bar）。
- 每个组件：以真源为底重写（props 契约按应用实际裁剪，不再带死参数）；
  样式随组件走（scoped 类前缀）；同步删除 styles.css 对应段并跑孤儿扫描。
- 验收：该组件类名在全局 CSS 零残留；装机逐项核对交互。

### P4：styles.css 按窗口分域
- 拆为 `base-tokens.css / chat.css / settings.css / oobe.css / wake.css`，
  各窗口入口只引自己的域文件。
- 验收：跨窗口选择器数为零；总行数较 965 显著下降。

### P5：终检
- 孤儿选择器扫描脚本（类名在 CSS 出现但无任何 TSX 引用即报错）进 CI。
- 验收：CI 常驻防回归。

## 已知特异性雷区（P3/P4 逐个排掉）

- settings 区：`.settings-shell:not(.oobe-shell) .settings-nav`（0-3-0）曾压制卡片化
  （0-2-0）三轮——R30 已删，P3 重写 HookSidebar 时样式随组件走，彻底免疫。
- composer 区：`.composer:has(.app-promptbar)` 等外框无形化补丁，待 P3 PromptBar
  重写时收编。
- wake 区：voice-pill 滤镜降级等补丁块。
