/**
 * Tool-call safety gate, Codex-style.
 *
 * Sensitive operations (destructive shell commands, writes outside the
 * workspace, network exfiltration patterns) require an explicit user
 * confirmation before execution. Users can approve once, always for a matching
 * signature ("不再提示"), or reject. Signatures are deliberately coarse
 * (tool + command head) so "always allow" cannot accidentally whitelist
 * arbitrary shell lines.
 */
export interface ToolGuardSettings {
  /** Master switch; off restores pre-guard behaviour. Default on. */
  enabled: boolean;
  /** Approved signatures: "tool|command-head" or "tool|path". */
  approved: string[];
}

export function normalizeToolGuardSettings(raw: unknown): ToolGuardSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as { enabled?: unknown; approved?: unknown };
  const approved = Array.isArray(input.approved) ? input.approved.filter((item): item is string => typeof item === "string") : [];
  return { enabled: input.enabled !== false, approved: [...new Set(approved)].slice(0, 200) };
}

export interface GuardCheckRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

/** `impact` 是给用户看的后果说明：为什么危险、批准后可能发生什么。 */
interface RiskHit { reason: string; impact: string }

export type GuardDecision =
  | { action: "allow" }
  | { action: "confirm"; reason: string; impact?: string; signature: string };

/** Destructive shell patterns. Matched against the command head, case-insensitive. */
const DESTRUCTIVE_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string; impact: string }> = [
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/, reason: "递归/强制删除", impact: "会永久删除匹配的文件或目录，通常无法恢复。" },
  { pattern: /\brmdir\s+\/[s]/, reason: "递归删除目录", impact: "会递归删除整个目录树及其中的全部内容。" },
  { pattern: /\b(remove-item|ri|rd)\b.*-recurse/i, reason: "PowerShell 递归删除", impact: "会递归删除目录及其子项，且不进回收站。" },
  { pattern: /\b(mkfs(\.\w+)?|format\s+[a-z]:|formatfs)/i, reason: "格式化磁盘", impact: "会抹除磁盘或分区数据，受影响的数据无法恢复。" },
  { pattern: /\bdd\s+[^|]*\bof=\/dev\//, reason: "dd 直写设备", impact: "会直接覆写块设备，可能导致磁盘损坏或数据全部丢失。" },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: "关机/重启", impact: "会中断正在运行的任务，未保存的工作可能丢失。" },
  { pattern: /\bgit\s+push\b.*(--force|-f)\b/i, reason: "强制推送", impact: "会覆盖远端提交历史，协作者基于旧历史的提交可能丢失。" },
  { pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fd])/i, reason: "丢弃本地改动", impact: "会丢弃未提交的修改或未跟踪文件，无法找回。" },
  { pattern: /\b(reg\s+add|regedit|reg\s+delete)\b/i, reason: "修改注册表", impact: "会修改系统注册表，可能影响系统或其他软件的正常运行。" },
  { pattern: /\btruncate\s+table\b|\bdrop\s+(table|database)\b/i, reason: "清空/删除数据库", impact: "会不可逆地清空表或删除数据库对象。" },
  { pattern: /\bchmod\s+-R\s*777\b/, reason: "递归放开全部权限", impact: "会向所有用户放开读写执行权限，显著扩大误操作与安全风险。" },
  { pattern: /\bcurl\b[^|]*\|\s*(ba)?sh\b|\bwget\b[^|]*\|\s*(ba)?sh\b/i, reason: "下载并直接执行脚本", impact: "会把来源不明的脚本直接交给 shell 执行，等同于允许任意本机代码。" },
  { pattern: /\btaskkill\b.*\/f\b/i, reason: "强制结束进程", impact: "会强制结束进程，目标程序未保存的数据可能丢失。" },
  { pattern: /\bdel\s+\/[sqa]/i, reason: "批量删除文件", impact: "会批量删除文件，且通常不进回收站。" }
];

/** Write tools that escape the workspace or touch system areas. */
const PATH_PREFIX_RISKS: Array<{ pattern: RegExp; reason: string; impact: string }> = [
  { pattern: /^\.\.(\/|\\|$)/, reason: "工作区外相对路径", impact: "写入目标在当前工作区之外，可能覆盖项目以外的文件。" },
  { pattern: /^\/(etc|usr|bin|sbin|var|boot|sys|proc)\b/i, reason: "系统目录", impact: "目标是系统目录，改动可能影响系统或其他软件运行。" },
  { pattern: /^\/[A-Za-z_$]/, reason: "绝对路径写入", impact: "使用绝对路径写入，可能覆盖工作区外的任意文件。" },
  { pattern: /^[a-z]:\\/i, reason: "绝对路径写入", impact: "使用绝对路径写入，可能覆盖工作区外的任意文件。" },
  { pattern: /^~/, reason: "用户主目录", impact: "会写入用户主目录，可能影响个人配置或其他应用数据。" }
];

const WRITE_TOOL_ARGS = ["path", "file", "filename", "target", "dest", "destination", "outputPath", "dir", "directory"];
const COMMAND_TOOL_ARGS = ["command", "cmd", "script", "shell", "exec", "code"];

/**
 * GUI-driving tools (computer-use and friends): the action lands on a real
 * desktop with no undo. Matches `<plugin>__type`, `computer-use__key`,
 * `…__click`, `…__drag` — deliberately suffix-based so any plugin that drives
 * the screen is covered without naming it.
 */
const GUI_TOOL_PATTERN = /(^|__)(type|key|keys|click|drag|double_click)$/;

/** Typed text that commits something irreversible. */
const RISKY_TEXT_PATTERNS: Array<{ pattern: RegExp; reason: string; impact: string }> = [
  { pattern: /\brm\s+-[a-z]*[rf]/i, reason: "删除文件命令", impact: "命令会在真实桌面执行，删除结果无法撤销。" },
  { pattern: /\b(format|diskpart)\b/i, reason: "磁盘格式化/分区操作", impact: "会直接破坏磁盘分区，数据可能全部丢失。" },
  { pattern: /\breg\s+(add|delete)\b/i, reason: "修改注册表", impact: "注册表改动会应用到真实系统。" },
  { pattern: /(删除|清空|格式化|卸载|永久删除|彻底删除)/, reason: "删除类不可逆操作", impact: "该操作不可逆，执行后无法恢复原内容。" },
  { pattern: /(支付|付款|转账|下单|充值|购买|结算|扣款)/, reason: "支付/资金操作", impact: "可能产生真实扣款或资金转移。" },
  { pattern: /(发送|发表|发布|寄出|提交订单|确认发送)/, reason: "对外发送/提交", impact: "内容会真实发送给第三方，发出后无法撤回。" },
  { pattern: /(密码|口令|私钥|助记词|密钥|token|api[\s_-]?key|验证码)/i, reason: "涉及凭据/验证码", impact: "可能把密码或密钥输入到当前焦点界面，存在泄露风险。" }
];

/** Key chords that can end a session, lock the machine or wipe a dialog. */
const RISKY_KEY_PATTERNS: Array<{ pattern: RegExp; reason: string; impact: string }> = [
  { pattern: /^alt\s*\+\s*f4$/i, reason: "关闭当前窗口/退出应用", impact: "可能关闭前台窗口或退出正在运行的应用程序。" },
  { pattern: /^ctrl\s*\+\s*alt\s*\+(delete|del)$/i, reason: "安全界面（重启/锁屏）", impact: "会进入系统安全界面，可能锁屏或重启。" },
  { pattern: /^(win|meta|super)\s*\+\s*l$/i, reason: "锁屏", impact: "会立即锁定屏幕，中断当前操作。" },
  { pattern: /^(win|meta|super)\s*\+\s*(x|q)$/i, reason: "关闭全部窗口", impact: "可能关闭全部窗口或退出应用。" }
];

function guiSignature(tool: string, kind: string, value: string): string {
  return `${tool}|${kind}:${value.trim().replace(/\s+/g, " ").slice(0, 60).toLowerCase()}`;
}

/**
 * Stable "command family" head used for always-allow signatures: the first two
 * tokens plus any flag tokens that follow (up to 4 total). Path/URL/value
 * arguments are dropped so `git push --force origin master` matches an
 * approval recorded for `git push --force`, and `rm -rf /any/path` matches
 * `rm -rf`, while `git push` alone stays a different signature.
 */
function commandHead(command: string): string {
  const tokens = command.trim().split(/\s+/);
  const kept: string[] = [];
  for (const token of tokens) {
    if (kept.length >= 4) break;
    if (kept.length >= 2 && !token.startsWith("-")) break;
    kept.push(token);
  }
  return kept.join(" ").toLowerCase().slice(0, 80);
}

function inspectPath(value: string): RiskHit | undefined {
  for (const risk of PATH_PREFIX_RISKS) {
    if (risk.pattern.test(value)) return { reason: risk.reason, impact: risk.impact };
  }
  return undefined;
}

function inspectCommand(value: string): RiskHit | undefined {
  for (const risk of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (risk.pattern.test(value)) return { reason: risk.reason, impact: risk.impact };
  }
  return undefined;
}

/**
 * Classify a tool call. Confirm-worthy only when the guard is on and the call
 * is not already covered by an approved signature.
 */
export function checkToolCall(request: GuardCheckRequest, settings: ToolGuardSettings): GuardDecision {
  if (!settings.enabled) return { action: "allow" };
  const reasons: string[] = [];
  const hits: RiskHit[] = [];
  let commandSignature = "";
  for (const key of COMMAND_TOOL_ARGS) {
    const value = request.arguments[key];
    if (typeof value === "string" && value.trim()) {
      const head = commandHead(value);
      commandSignature = `${request.tool}|cmd:${head}`;
      const hit = inspectCommand(value);
      if (hit) {
        hits.push(hit);
        reasons.push(`${hit.reason}：${value.trim().slice(0, 100)}`);
      }
      break;
    }
  }
  for (const key of WRITE_TOOL_ARGS) {
    const value = request.arguments[key];
    if (typeof value === "string" && value.trim()) {
      const pathSignature = `${request.tool}|path:${value.trim().toLowerCase().slice(0, 120)}`;
      if (!commandSignature) commandSignature = pathSignature;
      const hit = inspectPath(value.trim());
      if (hit) {
        hits.push(hit);
        reasons.push(`${hit.reason}：${value.trim().slice(0, 100)}`);
      }
      break;
    }
  }
  // GUI 动作：键入文本 / 组合键，命中高风险特征才拦截（普通打字不受打扰）。
  if (!reasons.length && GUI_TOOL_PATTERN.test(request.tool)) {
    const typed = request.arguments.text;
    if (typeof typed === "string" && typed.trim()) {
      const hit = RISKY_TEXT_PATTERNS.find((entry) => entry.pattern.test(typed));
      if (hit) {
        commandSignature = guiSignature(request.tool, "text", typed);
        hits.push(hit);
        reasons.push(`${hit.reason}：${typed.trim().slice(0, 100)}`);
      }
    }
    const keys = typeof request.arguments.keys === "string"
      ? request.arguments.keys
      : typeof request.arguments.key === "string" ? request.arguments.key : "";
    if (!reasons.length && keys.trim()) {
      const hit = RISKY_KEY_PATTERNS.find((entry) => entry.pattern.test(keys.trim()));
      if (hit) {
        commandSignature = guiSignature(request.tool, "keys", keys);
        hits.push(hit);
        reasons.push(`${hit.reason}：${keys.trim().slice(0, 60)}`);
      }
    }
  }
  if (!reasons.length) return { action: "allow" };
  const signatures = [commandSignature, `${request.tool}|*`].filter(Boolean);
  if (signatures.some((signature) => settings.approved.includes(signature))) return { action: "allow" };
  const impacts = [...new Set(hits.map((hit) => hit.impact))];
  return {
    action: "confirm",
    reason: reasons.join("；"),
    ...(impacts.length ? { impact: impacts.join("；") } : {}),
    signature: commandSignature || `${request.tool}|*`
  };
}

/** Signatures to persist when the user picks "always allow". */
export function approvalSignature(request: GuardCheckRequest, decision: GuardDecision): string | undefined {
  if (decision.action !== "confirm") return undefined;
  return decision.signature;
}
