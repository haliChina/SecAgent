# SecAgent

SecAgent 是一个把自然语言转换为工具调用的桌面 Agent：支持多模型提供商、语音输入、本地工具、MCP 服务与插件。本仓库包含桌面端（Electron + React）与 CLI 两种使用方式。

## 数据目录

SecAgent 的所有数据（配置、密钥、会话、日志）集中存放在**一个**按平台约定的工作区目录：

| 平台 | 默认工作区 |
|---|---|
| Windows | `%APPDATA%\SecAgent\workspace` |
| macOS | `~/Library/Application Support/SecAgent/workspace` |
| Linux | `$XDG_CONFIG_HOME/SecAgent/workspace`（未设置时为 `~/.config/SecAgent/workspace`） |

首次启动时，旧版遗留在 `~/SecAgentWorkspace` 的数据会**自动迁移**到上述目录（跨盘符时降级为复制，旧目录改名为 `SecAgentWorkspace.migrated` 备查）。

需要使用其他目录时，设置 `SECTL_WORKSPACE` 环境变量；CLI 命令可用 `--workspace` 参数覆盖。工作区内布局：

```
<工作区>/
├── secagent.yaml      # 配置（模型提供商、MCP、语音、更新等）
├── .env               # API 密钥（不要提交、不要手写变量名，见下文）
├── sessions/          # 会话历史（session.json + runtime.jsonl）
├── logs/              # 运行日志
└── skills/            # SKILL.md 技能文件
```

## 模型提供商

桌面端“设置 → 模型提供商”中添加提供商：填名称、Base URL、粘贴 API Key 即可。**不需要手写环境变量名**——保存时按提供商名自动生成（如 `SECAGENT_DEEPSEEK_API_KEY`），密钥只写入工作区 `.env`，绝不进入 `secagent.yaml`。同一个预设添加两次（例如两个账号）会自动加编号后缀，避免密钥互相覆盖。

所有模型选择处（主页模型菜单、默认模型、唤醒模型）均**按提供商分组显示**，不同提供商下的同名模型不会再混淆。多个 Google 提供商（官方 key + 中转）的模型会全部列出。

YAML 手写示例（与设置界面等价）：

```yaml
agent:
  providers:
    - id: deepseek
      name: DeepSeek
      provider: openai-compatible
      apiKeyEnv: SECAGENT_DEEPSEEK_API_KEY   # .env 中的变量名（自动生成）
      baseUrl: https://api.deepseek.com/v1
      endpoint: /chat/completions
      maxTokens: 16384
      models:
        - id: deepseek-chat
          name: DeepSeek V3
```

## 模型稳定性（重试 / 备用切换 / 冷却）

面向阿里云百炼等“赠送资源包”平台设计——资源包用尽时无需手动换模型：

- **自动重试**：同一模型对网络类错误重试一次；
- **多轮 fallback**：当前模型失败后按顺序切换到其他已配置模型，全部失败才报错；切换链覆盖每一个已启用模型；
- **失败记忆与冷却**：配额耗尽 / 鉴权失败的模型进入冷却期（普通错误 5 分钟起指数退避；资源包类 60 分钟），期间被跳过，成功一次即自动恢复。状态持久化在工作区 `.model-health.json`，重启后仍然生效；
- 语音识别（ASR）链同样支持：第三方 → 官方 → 本地逐级回退，连续失败的提供方短暂禁用。

以上行为均可在“设置 → 系统 → 模型稳定性”中分开关控制。

## 敏感操作确认（Codex 风格）

模型请求执行删除文件、格式化磁盘、强制推送、写系统注册表、写工作区外路径、下载并执行等操作时，会弹窗要求确认：

- **拒绝**：工具调用被拦截，模型收到说明并改用其他方式；
- **允许一次**：仅本次放行；
- **总是允许此类**：按「工具 + 命令头」签名记忆（如 `bash|rm`），不同命令不会误放行；签名保存在 `secagent.yaml` 的 `guard.approved`。

GUI 动作（任何 `*__type` / `*__key` / `*__click` / `*__drag` 工具，例如 [SecAgent-ComputerUse](https://github.com/haliChina/SecAgent-ComputerUse)）同样受此闸门保护：键入含「支付 / 删除 / 发送 / 验证码 / rm -rf / format」等特征的文本，或按下 `alt+f4`、`ctrl+alt+delete`、`win+l` 等组合键时会要求确认；普通打字与 `ctrl+c`、`f5` 之类快捷键不受打扰。

CLI 模式下通过终端 `y/N` 确认；非交互环境（管道 / CI）默认拒绝。5 分钟无响应自动拒绝。总开关位于“设置 → 系统 → 安全与检测”。

## 运行预算（步数上限 + 图片历史）

工具调用循环默认不设上限（读写类任务经常需要很多轮），但长任务尤其是带截图的界面操作会让上下文和费用随步数线性膨胀。`secagent.yaml` 中新增：

```yaml
budget:
  maxToolTurns: 0        # 单轮工具调用上限，0 = 不限制；达到后要求模型收尾并停止调用
  keepRecentImages: 2    # 上下文里保留最近几张工具返回图片，更早的替换为文字占位
```

达到 `maxToolTurns` 时，最后一轮会先提醒模型总结进展，随后停止继续调用工具并返回总结（`model.budget.stop` trace 事件）。图片裁剪对 OpenAI 兼容 / Responses / Anthropic / Gemini 四种消息形态都生效，只保留最新 N 张。四项参数也可在“设置 → 系统 → 运行预算”里调整。

## 幻觉检测

最终回答会经过轻量启发式检测，命中时在回答下方显示提醒条（仅提醒、不拦截）：

- 工具调用**失败**后回答却声称“已成功完成”；
- 回答陷入重复循环（小模型过载时的常见模式）；
- 引用了本轮从未产生的材料（“如上表所示”但没有任何工具产出）。

## CLI

CLI 的每次 `run` 都会持久化为一个会话，并默认实时打印模型思考片段、工具调用、工具返回结果和最终回答。模型请求失败时会保存错误消息并返回非零退出码。

```bash
cd SecAgent
npm install
npm run build:cli

# 初始化工作区（默认使用上文平台目录；也可用 --workspace 指定）
node dist/index.js init

# 执行单条消息；命令结束时会打印 [session] <会话 ID>
node dist/index.js run "查询李明当前积分" --workspace ./demo-workspace

# 查看历史会话，复制会话 ID
node dist/index.js sessions list --workspace ./demo-workspace

# 接着指定历史会话运行
node dist/index.js run "把刚才的结果总结一下" --session <会话 ID> --workspace ./demo-workspace

# 进入交互式续聊；不指定 --session 时默认打开最近会话
node dist/index.js chat --session <会话 ID> --workspace ./demo-workspace
```

交互式 `chat` 中输入 `:history` 查看当前会话，输入 `:use <会话 ID>` 切换会话，输入 `exit` 退出。需要完整的模型请求/响应原始事件时，加上 `--verbose`。

CLI 直接调用 SecScore 的 HTTP MCP（默认 `http://127.0.0.1:3901/mcp`），支持查学生、真实写入、审计和撤销。

## 语音输入（多提供方 + 自动回退）

语音识别（ASR）被抽象为独立的提供方层（`src/asr/`），支持三种后端并按链自动回退：

| 顺序 | 提供方 | 说明 |
|---|---|---|
| 1 | 第三方云端 | 任意 OpenAI 兼容 `/audio/transcriptions` 端点，内置小米 MiMo ASR / SiliconFlow SenseVoice / Groq Whisper 预设 |
| 2 | 官方云端 | SECTL 官方服务 WebSocket（需登录），仅在位于回退链中时启用 |
| 3 | 本地离线 | 随应用打包的 sherpa-onnx 流式模型，无需网络 |

设置 → 语音识别中可选择“自动”（默认，按上表顺序回退）或固定某一后端，并支持一键“测试识别服务连通性”。API Key 同样不需要手写环境变量名，保存时自动写入 `.env`。

主界面输入框支持鼠标或触摸长按 0.7 秒说话，松开后一次性识别并插入输入框；向左侧“拖动至此取消”区域松开可取消。也可以点击麦克风按钮开始，再在录音条上松开完成识别。

## 工具与技能

模型可直接调用所有已发现的 MCP 工具，以及 Pi 风格的 `look_at`、`read`、`write`、`edit`、`bash` 五个本地工具；`look_at` 会读取工作区或本地路径中的图片并以多模态内容返回给模型，每次调用仍会写入本地审计。

基础系统提示词写死在源码 `src/system-prompt.ts` 中，不支持通过工作区 `secagent.yaml` 配置：旧配置里的 `agent.systemPrompt` 会被忽略，并在保存设置时自动移除。SecAgent 会自动扫描工作目录下三层以内、文件名大小写不敏感的 `SKILL.md`，并将扫描到的 Skill 名称、描述和入口文件追加到系统提示词中。模型需要完整流程时会调用 `secagent__read_skill` 读取对应文件。Skill 不需要写入 `secagent.yaml`，文件可直接手动编辑。

```md
---
name: SecScore
description: 处理学生查询、积分加减分和撤销。
---
# SecScore
```

隐藏 MCP 工具的声明方式、通用调用入口，以及 Skill/MCP 开发者约定见 [`docs/skill-mcp-convention.md`](docs/skill-mcp-convention.md)。

## 开发与 CI

```bash
npm install
npm run build    # tsc 全量类型检查 + electron-vite 打包（main/preload/renderer）
npm test         # node --test dist/**/*.test.js
```

GitHub Actions：

- **CI**（`.github/workflows/ci.yml`）：每次 push / PR 运行——类型检查、完整构建、单元测试、CLI 冒烟（`init` + `doctor`）；
- **Build**（`.github/workflows/build.yml`）：三平台打包并上传构建产物。

## 更新检查与诊断日志

SecAgent 会优先读取签名的 `updates.json` 通道清单；清单暂不可用时回退到 GitHub Releases API，并依次尝试代理和直连。安装包下载后必须通过 SHA-256 校验。

更新设置页面中的“打开日志目录”可直接打开工作区的 `logs` 目录；“导出诊断日志”会生成脱敏 ZIP，适合提交故障信息。日志位于上文“数据目录”表格中对应平台的 `<工作区>/logs`。

发布者如需启用签名清单，应将与 `src/update-public-key.ts` 匹配的私钥配置为 GitHub Actions Secret：`SECAGENT_UPDATE_PRIVATE_KEY`。私钥不得提交到仓库。

## 开源致谢

本项目的部分界面组件（滚动进度、空状态球体、侧导航、删除确认、数字滚动、语音消息等）按 [Rare UI](https://rareui.com/)（[GitHub](https://github.com/swamimalode07/rare-ui)，MIT）的源码移植，动效使用同款 [Motion](https://motion.dev/) 引擎；消息操作、日期分隔、错误状态、工具失败卡等交互模式参考自 [assistant-ui](https://www.assistant-ui.com/)（[GitHub](https://github.com/assistant-ui/assistant-ui)）；录音状态、思考折叠线等动效参考自 [React Bits](https://reactbits.dev/)（[GitHub](https://github.com/DavidHDev/react-bits)）。感谢这些项目带来的设计启发。
