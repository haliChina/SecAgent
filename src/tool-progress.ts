/**
 * 无进展重复执行熔断（R97，学习 ZCode 3.17.2）。
 *
 * 模型偶尔会陷入「同一工具、同一参数、反复调用」的空转——烧 token 也
 * 烧真实执行时间。这里在 execute 回调外包一层观察器：
 *
 * - 连续 `stallLimit` 次（默认 3）完全相同的 (name, args) 调用 → 拒绝执行，
 *   返回一条「请停止重复」的工具结果提示，把模型拉回正轨；
 * - 模型看到提示后换方法或收尾 → 计数自然复位；
 * - 仍重复 → 继续返回提示（真实动作不再执行，浪费只剩模型轮次 token）。
 *
 * 判定只看 (name, args) 不看结果：「同样动作做 N 次还没换策略」就是
 * 无进展，无论每次结果是否相同。轮询场景（等窗口/等安静）应引导用
 * wait 条件等待——提示文案里说明。
 *
 * 纯逻辑（供 model-provider 的 execute 包装使用），测试不依赖网络。
 */

/** 连续相同调用达到该次数后开始拦截。 */
const DEFAULT_STALL_LIMIT = 3;

/** 等待变化场景的工具提示：截图轮询改用 wait(quiet/change)。 */
const WAIT_HINT_TOOLS = new Set(["screenshot", "screen_view", "computer-use__screenshot"]);

export const STALL_NOTICE = "已连续多次执行完全相同的调用（相同参数）而未取得进展，本次不再执行。请改变方法：换不同参数/工具、先观察现状、或基于已有信息总结收尾。如需等待界面变化，请使用 wait 工具（条件等待）而不是反复截图。";

export interface ToolProgressVerdict {
  /** true = 本次调用应被拦截（达到停滞阈值）。 */
  blocked: boolean;
  /** 连续重复计数（含本次）。 */
  repeat: number;
}

export interface ToolProgressGuard {
  observe(name: string, args: Record<string, unknown>): ToolProgressVerdict;
}

/**
 * args 的稳定签名：键排序后 JSON 序列化。捕获键序差异——同内容不同
 * 顺序视为相同调用（模型重发时键序不稳定是常态）。
 */
export function toolCallSignature(name: string, args: Record<string, unknown> | undefined): string {
  const sorted = Object.keys(args ?? {}).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = args?.[key];
    return acc;
  }, {});
  try {
    return `${name}:${JSON.stringify(sorted)}`;
  } catch {
    /* 循环引用等不可序列化输入——退化为键集合签名，仍能抓住大部分重复。 */
    return `${name}:${Object.keys(sorted).join(",")}`;
  }
}

export function createToolProgressGuard(stallLimit: number = DEFAULT_STALL_LIMIT): ToolProgressGuard {
  let lastSignature = "";
  let repeat = 0;
  return {
    observe(name: string, args: Record<string, unknown>): ToolProgressVerdict {
      const signature = toolCallSignature(name, args);
      if (signature === lastSignature) repeat += 1;
      else {
        lastSignature = signature;
        repeat = 1;
      }
      return { blocked: repeat >= stallLimit, repeat };
    }
  };
}

/** 停滞提示是否应附等待场景引导（截图类轮询）。 */
export function stallNoticeFor(name: string): string {
  const bare = name.includes("__") ? name.split("__")[1] : name;
  return WAIT_HINT_TOOLS.has(bare) ? `${STALL_NOTICE}（截图轮询请改用 wait 条件等待）` : STALL_NOTICE;
}
