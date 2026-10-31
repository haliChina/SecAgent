/**
 * Tool-call decision pipeline.
 *
 * Every tool call is classified before execution (allow / confirm / deny) and
 * judged again after execution (accept / block). Hooks compose monotonically:
 * a later "allow" can never overturn an earlier "deny" or "confirm", and a
 * single post "block" is enough to discard a result. This keeps the decision
 * order-independent, so adding a hook can only tighten safety, never loosen it.
 */
export interface ToolCallContext {
  /** Fully-qualified tool key, e.g. "guarded__sh". */
  tool: string;
  /** Arguments exactly as requested by the model. */
  arguments: Record<string, unknown>;
  /** Natural-language request that triggered the call, used for audit text. */
  request: string;
  sessionId: string;
}

export type PreToolDecision =
  | { action: "allow" }
  | { action: "confirm"; reason: string }
  | { action: "deny"; reason: string };

export type PostToolDecision =
  | { action: "accept" }
  | { action: "block"; reason: string };

export type PreToolHook = (context: ToolCallContext) => PreToolDecision | Promise<PreToolDecision>;
export type PostToolHook = (context: ToolCallContext, result: unknown) => PostToolDecision | Promise<PostToolDecision>;

/**
 * Run every pre hook in order. Intervention is monotonic: deny is final, and a
 * confirm already raised by an earlier hook survives later allow decisions.
 */
export async function resolvePreDecision(context: ToolCallContext, hooks: PreToolHook[]): Promise<PreToolDecision> {
  let decision: PreToolDecision = { action: "allow" };
  for (const hook of hooks) {
    const next = await hook(context);
    if (next.action === "deny") return next;
    if (next.action === "confirm" && decision.action === "allow") decision = next;
  }
  return decision;
}

/** Run every post hook; the first block wins and later accepts cannot revive the result. */
export async function resolvePostDecision(context: ToolCallContext, result: unknown, hooks: PostToolHook[]): Promise<PostToolDecision> {
  for (const hook of hooks) {
    const next = await hook(context, result);
    if (next.action === "block") return next;
  }
  return { action: "accept" };
}
