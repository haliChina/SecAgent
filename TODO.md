# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R28 · 2026-10-09）

### R27 包（9010c1f）实测反馈修复 — 完成 ✓（CI 全绿 eeb4c49）
- ✓ 模型菜单提供商标签溢出：行 name flex-none→shrink+truncate + 菜单 200→260px
  （Qwen3.7-Flash-260715 不再把 FreeAlliCloud 挤出边界）
- ✓ 设置页 HookSidebar 无样式/线条与选项叠加：根因=旧版 .settings-nav 窄条规则
  （display:grid/width132/a 链接）无 layer 覆盖组件 Tailwind utilities；删旧规则；
  组件侧加测量防御（零尺寸跳过+逐按钮 observe+双 rAF，修 filter 索引错位）
- ✓ PromptBar Effort 最高动效与外框间距：根因=.composer 旧外框与 PromptBar 自带
  外框双层嵌套；:has(.app-promptbar) 无形化 composer，附件/引用/状态补边距
- ✓ React #130 崩溃：静态排查无果（tsc 全绿下无 undefined 组件），ErrorBoundary
  增加 componentStack 展示+复制，下次崩溃可直接定位组件 → 待复现取栈
- ✓ eeb4c49 CI + Build 三平台全绿；安装包已交付：
  SecAgent-Setup-20261009-003752-eeb4c4942d1c.exe（R28 四问题修复版）
- ☐ 图5 若复现：需用户告知触发路径
- ☐ #130 若复现：新版崩溃页有「组件栈（定位用）」，展开复制即可定位组件

### R27（上一轮）PromptBar 替换 composer — 完成 ✓（tsc 0 错误 + build 全绿）
- ✓ Bits.tsx：PromptBar 加受控桥 props（value/onDraftChange/model/onModelChange/
  onAttachRemove/onDictateCancel），不传即真源行为；修桥 prop `model` 与真源内部
  `const model` 重名（TS2300×2+2322+2339×2+2345+18048 共 7 错）
- ✓ App.tsx：composer 内行换 <PromptBar>（模型/推理强度菜单+滑杆、@图片源、
  听写桥 startPromptDictation/cancelPromptDictation、附件名兑现）；
  语音三分区/hold 长按/引用块/Orb dock 全保留；删旧菜单 state+死代码
- ✓ styles.css：R26 order 撤销（旧结构消失）、旧 textarea 规则 >限定防泄漏、
  .app-promptbar 适配
- ✓ 本地 node_modules 系统性损坏（pnpm-hoisted 旧树：rollup 二进制截断 SIGBUS、
  mermaid-parser/zustand/sentry-conventions 残缺）→ npm ci 全新重装修复
- ☐ 浏览器复现页人工验证（外观/胶囊/菜单溢出）+ 新版安装包交付
- ☐ 69c5afe CI + 打包（windows 包出来后交付）
- ☐ 图5 若复现：需用户告知触发路径（点哪个按钮/快捷键）

### R24 包实测反馈（69c5afe）
- ✓ 录音两套 UI 打架（第一次残留乱码+X、第二次叠加双波形）：VoicePill 改
  仅处理中显示，录音期 VoiceRecorder 波形独占
- ✓ 设置页右侧被挤出（R24 的 fixed nav+margin-left 错上加错）：grid 双列
- ✓ Aurora 动效被 empty-state 裁剪拦断（R24 引入）：撤销，aurora 自带裁剪
- ✓ 设置窗口最小化异常：显式 skipTaskbar:false
- ☐ 69c5afe CI + 打包（windows 包出来后交付）
- ☐ 图5 若复现：需用户告知触发路径（点哪个按钮/快捷键）

### 上轮（R24 · 2026-10-08 21:14）

### 用户实测反馈修复（R21 包 9 项 UI + 唤醒不发声）— 完成 ✓
- ✓ demo 8 组件样式暴毙：根因=直译组件 Tailwind 类 demo 无 Tailwind，
  postcss 编译 utilities 注入 demo HTML，AnimatedCounter/侧栏等全恢复
- ✓ Cancel 残留：--vp-* 60 变量整块缺失（r19 漏搬），真源 voice-pill
  CSS 注入（.rb-vp 前缀共存）
- ✓ 录音框打架/主主主主/HookSidebar 卡片化/Orb溢出/小Orb/今天空框/
  ScrollProgress 点不动/图标对齐/标题栏配色 —— 9 项全修（e94c647）
- ✓ 唤醒不发声：模型未输出 <tts> 标签 → 静音；完成态整段朗读兜底
- ✓ PromptBar 替换 composer 专项（拍板=是：语音三分区/附件/引用迁移）→ R27 完成
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
- ☐ computer-use 面板接入工具调用展示
