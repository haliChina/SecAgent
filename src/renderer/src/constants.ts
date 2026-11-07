export type TraceEvent = { sessionId: string; sequence: number; at: string; stage: string; data: unknown };

export const traceLabel: Record<string, string> = {
  "user.request": "收到教师指令",
  "mcp.tools/list": "发现 MCP 工具",
  "secagent.skills/list": "发现 Skills",
  "model.agent.request": "准备模型请求",
  "model.request": "发送模型请求",
  "model.request/failed": "模型请求失败",
  "model.fallback/switch": "切换备用模型",
  "model.output.delta": "模型正在生成",
  "model.output.reset": "开始调用工具",
  "model.response": "收到完整模型响应",
  "mcp.tools/call": "调用 MCP 工具",
  "mcp.tools/result": "MCP 工具返回",
  "secagent.tools/call": "读取 Skill",
  "secagent.tools/result": "Skill 已读取",
  "model.agent.result": "模型任务完成",
  "assistant.response": "回复已保存",
  "runtime.stopped": "已手动停止",
  "runtime.error": "运行出错"
};

export const reasoningEffortLabels: Record<ReasoningEffort, string> = { none: "不思考", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" };

/** 回复过程中的轮播使用技巧（设置里可关闭）。只写应用里真实存在的能力。 */
export const responseTips = [
  "输入 /new 新建会话，/stop 停止当前回复，/settings 打开设置",
  "长按输入框可以直接说话，松开即发送",
  "把图片拖进输入框，或点输入框的图片按钮添加附件",
  "在消息上点右键，可以复制或用引用继续追问",
  "/read 朗读最后一条回复，/stop-read 停止朗读",
  "设置「系统」页可以单独关闭不想用的技能",
  "设置里能切换浅色 / 深色主题，或跟随系统"
] as const;

/** 官方服务的虚拟档位：主界面在“自定义模型模式”开启时只暴露这三档（低延迟档位暂缓）。 */
export const officialTiers = [
  { id: "virtual-fast", name: "快速", description: "优先使用最快的上游模型" },
  { id: "virtual-standard", name: "标准", description: "使用标准档上游模型" },
  { id: "virtual-deep", name: "深度", description: "使用更深推理的上游模型" }
] as const;
export const tierDefaultId = "virtual-standard";

export const ttsVoices = [
  ["zh-CN-XiaoxiaoNeural", "晓晓（女声，自然）"],
  ["zh-CN-XiaoyiNeural", "晓伊（女声，温柔）"],
  ["zh-CN-YunxiNeural", "云希（男声，年轻）"],
  ["zh-CN-YunjianNeural", "云健（男声，沉稳）"],
  ["zh-CN-YunyangNeural", "云扬（男声，播音）"]
] as const;
export const ttsRates = [["-30%", "较慢"], ["-15%", "慢"], ["+0%", "正常"], ["+15%", "快"], ["+30%", "较快"]] as const;
