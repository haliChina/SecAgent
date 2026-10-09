# SecAgent UI 重构 · 代办清单

> 每轮对话更新本文件：完成打 ✓，进行中标 🔶，未动留 ☐。
> 约定：每轮对话（用户发一次）tool_call 上限 100 次，做不完的顺延下一轮。

## 本轮（R39 · 2026-10-09）

### PR #1 merge master（3fd7d5f）✓
- master 新进 4 提交：overlay 权限+createOverlay / 运行预算+GUI 确认闸门 /
  api.onActivity (#2) / Windows CI EBUSY 修复 (#3)
- 唯一冲突：main.ts import 行（并集解决）；tsc EXIT=0；
  通道 79→81（+overlay:ignore-mouse/move，master 新功能，预期）
- PR#1 mergeable: true ✓

### UI 借鉴研究（DeepSeek-Harness + ZCode）✓ 2026-10-09
可落地的设计要点（按对 SecAgent 的适用度排序）：
1. 【DSH】运行轨迹视图：时间线 + 每次工具调用记录与执行详情，
   "让每一次运行有迹可循"——我们已有 sessions:runtime-events
   数据流，缺的是前端 Timeline 面板（P3 候选：TraceView）
2. 【ZCode】对话面板是一等公民：不藏在侧边栏，主窗对话流为核心
   布局——校准我们主窗信息层级（当前已接近，保持）
3. 【DSH】Session/Workspace 管理组：分组/扁平切换、搜索、fork、
   归档——sessions:list 可加 search/fork/archive（后端 P4 候选）
4. 【ZCode】语义化主题 Token 贯穿：zai-light/zai-dark 枚举
   贯穿设置页与侧栏——我们暗色主题 R1-R14 已做，补 token 命名
   系统化审查（P3 候选）
5. 【DSH】工具调用独立渲染：conversation.chat.node 按 key 分发
   ——我们已有 MessageActivities，对齐此模式扩展
6. 【ZCode】轻量克制：侧栏底部齿轮设置入口、Cmd+K 系快捷键
   习惯——低成本高感知

### B2 main.ts 解体 — 第四批（d1+d2）完成 ✓
- ✓ B2-d1：windows.ts（351 行）窗口/托盘/菜单/overlay 域（ba6b151）
- ✓ B2-d2：wake.ts（173 行）+ ipc-sessions.ts（341 行）（7ee4038）
- ✓ **main.ts：1691 → 263 行（-84%）**，纯装配入口
- ✓ B2 拆出 13 个域模块；81 IPC 通道全程零变化；tsc EXIT=0
- 本轮 tsc 抓 5 处接线错（相对路径×3/import 重复×1/漏导出×1）全修

### B2 全程战果（R38-R39）
main.ts 1691 → 263 行；拆出：main-log / autostart /
companion-bridge / workspace-preview / ipc-companions /
main-telemetry / ipc-plugins / ipc-official / ipc-speech /
ipc-settings / windows / wake / ipc-sessions（13 个域模块）
- 验证网战绩：CI tsc 抓 import 归属/引用漏接；自查抓凭记忆
  错写 models:list；IPC diff 抓通道漏搬；本轮 tsc 抓 5 处
- 流程铁律：后台 tsc 必须等 EXIT= 行；搬家必须逐字对照 git 原文

### P3 续（UI 阶段，基于借鉴研究）
- TraceView 运行轨迹面板（sessions:runtime-events 数据已有）
- 对话面板一等公民布局校准
- session 搜索/fork/归档；主题 token 系统化

## 本轮（R38 · 2026-10-09）

### B2 main.ts 解体 — 第三批（c1-c3）完成 ✓（Build 全绿 bc6e83c）
- ✓ B2-c1：main-telemetry.ts（Sentry/脱敏）+ ipc-plugins.ts
  （9 通道）；1282→1173
- ✓ B2-c2：ipc-speech.ts（13 通道 speech/tts/voice-wake）；1118→1057
- ✓ B2-c3：ipc-settings.ts（14 通道 models/providers/settings/
  updates/diagnostics/shell）；1057→927
- ✓ main.ts 累计：1691 → 927 行（-764，-45%）
- ✓ 拆出域模块 9 个（main-log/autostart/companion-bridge/
  workspace-preview/ipc-companions/ipc-plugins/main-telemetry/
  ipc-official/ipc-speech/ipc-settings）
- 本轮被验证网抓住 4 次（全部当场修复）：
  · CI tsc：DEFAULT_WORKSPACE import 归属写错（config.js→paths.js）
  · CI tsc：officialProvider/runSectlOAuthLogin 引用漏接
  · 自查：models:list 凭记忆错写 Models.make()（原文 fetch 官方端点）
  · IPC diff：models:fetch 通道漏搬
- 流程沉淀：后台 tsc 必须等 EXIT= 退出码行（读空 log 当 0 造成
  一次 CI 翻车）；搬运必须逐字对照 git 原文
- ✓ 安装包交付：SecAgent-Setup-20261009-132855-bc6e83c18073.exe
- ☐ B2-d（下轮）：窗口/托盘/菜单域 + sessions/wake 域
  （settings:save 联动 wake 快捷键同批拆），目标 main.ts < 500
- ☐ P3 续：delete-button/animated-counter 等组件重写

## 本轮（R37 · 2026-10-09）

### B2 main.ts 解体 — 前两批完成 ✓（CI 全绿 1f388bb）
- ✓ B2-a：main-log.ts（logMain 双流日志）/autostart.ts（三平台自启动）/
  companion-bridge.ts（UAC 提权桥+安装串行锁）拆出 + 死代码
  createElevatedAutostartTask 清除；1691→1515
- ✓ B2-b：workspace-preview.ts（文件预览窗）/ipc-companions.ts
  （14 通道域模块，窗口访问器注入）；1515→1283
- ✓ 验收纪律：IPC 通道清单 diff = 零（70 handle + 9 on）每批验证；
  tsc 全量 0 错误；纯搬家零逻辑改动
- ✓ CI 全绿（tsc + 24 测试文件 + 冒烟）
- ☐ B2-c（下轮）：窗口/托盘/菜单域 + sessions 域（含 wake 复合体）
  + speech/tts/official/settings/oobe/updates 域分批拆出，
  目标 main.ts < 500 行装配入口
- ☐ Build 三平台 + 交付安装包（B2 全部完成后）

## 本轮（R36 · 2026-10-09）

### B1-2 四安装器统一到共享内核 — 完成 ✓（CI 全绿 7acb6d1）
- ✓ 新增 companion-installer-shared.ts（392 行）：22+ 个四文件逐字/
  仅差常量的函数机械提取（gen-shared.py 可重跑复核），参数化注入
  （进程 exe 名/注册表匹配模式/release 资产名/下载 spec 六字段）
- ✓ 四安装器迁移（每件一提交，测试契约保行为）：
  · classwidgets 813→476（-337）
  · secrandom 852→666（-186；保留 win-only 版本查询/固定 tag 链）
  · classisland 943→598（-345；保留双 exe runtime 进程判断）
  · iccce 1094→894（-200 保守版；保留进程发现 PS 脚本差异/
    日志诊断 15 特有函数）
- ✓ 四安装器 3702 → 2634 行（-1068，-29%）；测试 36/36 全绿
- ✓ 两个被测试网抓住的真 bug：
  · shared 降级链漏传 assetName（classisland 403 用例暴露——
    classwidgets 无该路径覆盖故试点时侥幸全绿）
  · CI tsc 抓到 7 个类型错误（TDZ 顺序/TPhase 泛型/残留 5 参/
    漏 import——esbuild 只查语法不查类型，本地验证盲区已补 tsc）
- ✓ 安装包已交付：SecAgent-Setup-20261009-121717-7acb6d1bf2ac.exe
- ☐ B2（下轮）：main.ts 解体（1691 行 70 IPC 通道按域分组）
- ☐ P3 续：delete-button/animated-counter 等组件重写

## 本轮（R34 · 2026-10-09）

### 用户扩权：UX 及后端一并重写 — P3 首批 + 后端 B0/B1-1 完成 ✓
- ✓ P3 首批三组件（ThoughtLine/VoicePill/DaySeparator）：
  样式随组件走（各自 .css）+ 类名/DOM 不变纯迁移；每组件一提交
- ✓ 删 styles.css 死块：rb-vp 真源 CSS 236 行（R24 注入从未接线）+
  composer 区 rb-vp 补丁行；929 → 677 行（累计 -288）
- ✓ 后端 B0 审计（BACKEND-REWRITE-PLAN.md）：
  main.ts 1691 行 70 IPC 通道（后端的 Bits.tsx）；四安装器平行复制
  3702 行（classisland/classwidgets/iccce/secrandom 同接口同五阶段）；
  asr/tts 分层是范本；24 测试文件是安全网
- ✓ B1-1 死代码清除（8b14cdb）：12 死导出 + 2 传导孤儿（writeDirect/
  writeWithWindowsUac）；复查确认 startCompanionProcessWithSameElevation
  被三安装器使用故保留（避免误删）
- ✓ P3 安装包已交付：SecAgent-Setup-20261009-102810-929ce67cd454.exe
- ☐ B1-2（下轮）：四安装器提取 CompanionInstallerBase（3702 → ~1500 行）
- ☐ B2：main.ts 解体（70 IPC 通道按域分组）
- ☐ P3 续：delete-button/animated-counter/hook-sidebar/prompt-bar 等组件
- ☐ B4：App.tsx 1019 行拆分 + styles.css 按窗口分域

## 本轮（R33 · 2026-10-09）

### P2 设计 token 统一 — 完成 ✓（CI 全绿 b390090）
- ✓ Tailwind v4 @theme 增 --color-accent/--color-accent-text 映射
  （组件可用 bg-accent/10 等主题类）
- ✓ 新建 parts/theme.ts TS 色板（SVG/canvas 场景唯一真源）：
  ACCENT/ACCENT_DEEP/ACCENT_SKY/ACCENT_PALE/ACCENT_MID/ACCENT_SOFT/
  ACCENT_FAINT + ERROR_RED/OK_GREEN
- ✓ 10 文件硬编码蓝 → 色板 import（App/MarkdownContent/MathDiagram/
  WakeOverlay/delete-button/hook-sidebar/matrix-orb/prompt-bar/aui-feedback）
- ✓ CSS：#2563EB 19 处 → var(--accent)；rgba(37,99,235,α) 23 处 →
  color-mix(in srgb, var(--accent) N%, transparent)（Electron 42 支持）
- ✓ 过程修正：首轮正则把 alpha .10 误当 10（产出 1000%/4500% 会 clamp
  成纯色），两轮修复后百分比 8-50% 与原 alpha 逐一核对通过
- ✓ 验收：改主题蓝只需动 :root --accent + parts/theme.ts 两处；
  parts 目录 hex 残留仅注释
- ✓ 安装包已交付：SecAgent-Setup-20261009-101333-b39009086d7f.exe
- ☐ 装机验证：视觉应与 R32 完全一致（纯重构无视觉变化）；重点看
  录音取消态辉光/插件搜索框 focus 环/唤醒边框渐变
- ☐ P3（下轮）：逐组件真源重写（thought-line → voice-pill → …）+
  同步删全局 CSS 对应段

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
