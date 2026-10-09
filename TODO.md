# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R32 · 2026-10-09）

### 用户定调：白蓝黑配色，去橙 — 完成 ✓（CI 全绿 48308c5）
- ✓ 全局暖色审计（hex 全量分类扫描 + Tailwind 色名类）：
  橙黄棕紫共 5 个 TSX 文件 + 16 处 CSS + MathDiagram 教具整窝
- ✓ delete-button DB_ACCENT #FF5F2E → #2563EB（品牌橙清零）
- ✓ MatrixOrb bash 黄特判删除统一蓝；WakeOverlay 彩虹边框 → 蓝系流光
- ✓ MathDiagram：尺寸橙/米黄面/公式红 → 蓝系（#2563EB/#DBEAFE/#EFF6FF）
- ✓ aui-feedback amber 图标 → 蓝；prompt-bar sparkColor 默认浅紫 → 蓝
- ✓ styles.css 16 处：插件启动/更新警告/工具确认/幻觉提醒/OOBE 状态黄 → 蓝
- ✓ 错误红（#F87171）/成功绿（#4ADE80）作为功能语义色保留
- ✓ 终验：全 renderer hex 扫描，暖色仅剩 2 处注释中的真源历史色说明
- ✓ 安装包已交付：SecAgent-Setup-20261009-081351-48308c5db9d3.exe
- ☐ 装机验证：删除确认/唤醒边框/数学图表/插件状态均为蓝系
- ☐ P2（下轮）：硬编码色收敛到主题 CSS 变量（#2563EB → var(--accent)）

## 本轮（R31 · 2026-10-09）

### 用户定调：停止雕花，分步重写 UI — P0+P1 完成 ✓（CI 全绿 947bfd7）
- ✓ P0 审计：Bits.tsx 4882 行单体含 15 个零引用死组件（约 2000 行/40%）；
  styles.css 965 行含多代僵尸（旧反馈卡族/旧 composer 模型选择器族等）
- ✓ UI-REWRITE-PLAN.md：P0 审计 + P1~P5 分阶段计划（token 统一 →
  逐组件真源重写样式随组件走 → 按窗口分域 CSS → 孤儿扫描进 CI）
- ✓ P1-1 纯搬家：Bits.tsx → parts/ 13 个域文件 + barrel（导入路径零改动）；
  全量 tsc 仅 1 处断链（AuiQueuedMessage 归位）已修复
- ✓ P1-2 清除：死组件 4 文件 + 孤儿 CSS（旧反馈卡/旧模型选择器族），
  共 -2125 行；每个类名删前 rg 全 TSX 验证零引用
- ✓ 安装包已交付：SecAgent-Setup-20261009-074434-947bfd7d0924.exe
- ☐ 装机冒烟：行为应零变化（纯结构迁移）；异常即反馈
- ☐ P2（下轮）：设计 token 统一（组件内硬编码色 → CSS variables）

## 本轮（R30 · 2026-10-09）

### R29.1 包实测：HookSidebar 仍无样式 — 完成 ✓（CI 全绿 8bdae2c）
- ✓ 根因实锤：styles.css 267 行旧版 fixed 全高窄条规则
  .settings-shell:not(.oobe-shell) .settings-nav（specificity 0-3-0）
  一直压过 R24 卡片化 [data-slot=hook-sidebar]（0-2-0）→ 卡片样式从未
  生效。R28 只删了 254 行区规则，漏了这条 :not(.oobe-shell) 变体
- ✓ 删 267 旧窄条 / 268 button width（重复）/ 284 错误 960px 回退 /
  191 两列网格隐患（钩线依赖垂直堆叠+offsetTop）
- ✓ shell 让位 padding-left 268→246px（卡片右缘 210+36 间距，内容更宽）
- ✓ 安装包已交付：SecAgent-Setup-20261009-035741-8bdae2c8e512.exe
- ☐ 装机验证：设置页左侧为圆角卡片（top76/左22/宽188/边框/内滚），
  钩线跟随选中项、悬停灰轨正常

## 本轮（R29.1 · 2026-10-09）

### R29 包实测：max 状态切模型后 effort 滑杆拉不动 — 完成 ✓（CI 全绿 224b26d）
- ✓ 根因：单档模型（官方服务[默认]/glm-4.x[高]/deepseek[高]）档位长度 1，
  滑杆 setEffort(round(k*(len-1))) 恒 0 = 当前档 → return，渲染成可拖滑杆
  但永远拉不动。改为静态说明行「该模型固定为「X」，不支持调节」
- ✓ 多档同步 effect 回声防护：lastSyncedEffort ref 区分外部真实变化 vs
  拖动回声（efforts 每渲染新数组、effect 频跑，stale defaultEffort 会把
  滑杆反复拽回旧位置）；列表收缩越界只夹取不回跳
- ✓ setEffort 以 safeEffortIndex 为比较基准 + 残留越界 state 归一化
- ✓ 安装包已交付：SecAgent-Setup-20261009-022259-224b26d420b0.exe
- ☐ 装机验证：GLM-5(max) 切官方模型→显示「固定为默认」；切 Qwen→滑杆可拖

## 本轮（R29 · 2026-10-09）

### R28 包实测追加反馈 — 完成 ✓（CI 全绿 c190678）
- ✓ effort 模型切换不回退：真源回退改「不超过当前档的最高档」（GLM-5 max→Qwen
  回 high 而非掉 low）；PromptBar effortIndex 加 defaultEffort 同步 effect +
  渲染期 safeEffortIndex 夹取（level 空白/滑杆 aria 越界根除）
- ✓ **React #130 根因实锤**：renderPbIcon 对 undefined icon 直接 <Ico/> 渲染
  undefined 组件——点 + 打开来源菜单即触发（真源 Source.icon 必填、应用侧未传）。
  非法/缺失返回 null + 行兜底 PaperclipIcon
- ✓ effort 菜单无用问号图标删除；标题/快慢标注中文化（推理强度/更快/更深入思考）
- ✓ 安装包已交付：SecAgent-Setup-20261009-010001-c1906784fedf.exe（R29 版）
- ☐ 装机验证：+ 按钮不再崩溃、effort 切模型正确回退显示

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
