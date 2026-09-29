/**
 * Lightweight hallucination signals for final answers.
 *
 * Heuristics only — nothing here blocks an answer. Findings are surfaced as a
 * warning strip in the UI and as trace events, so the user can double-check
 * claims the model makes after tools failed, or answers degenerated into
 * repetition loops (a common failure mode of smaller models under load).
 */
export interface HallucinationSignal {
  /** Stable id for UI i18n/lookup. */
  id: "claims_success_after_tool_failure" | "repetition_loop" | "contradicts_empty_tools" | "fabricated_tool_reference";
  detail: string;
}

export interface HallucinationReport {
  /** 0 = clean; each signal adds 1. Not a probability. */
  score: number;
  signals: HallucinationSignal[];
}

export interface TurnEvidence {
  /** Tool calls from this run with their outcome, in call order. */
  toolCalls: Array<{ name: string; ok: boolean }>;
  /** Whether the run completed without the agent loop erroring out. */
  runCompleted: boolean;
}

const REPETITION_WINDOW = 24;

function normalizedLines(text: string): string[] {
  return text.split(/\n+/).map((line) => line.trim().replace(/\s+/g, " ")).filter((line) => line.length >= 8);
}

/**
 * Detect n-gram repetition loops. Answers where a single chunk of ~8 words
 * covers most of the text, repeated many times, are almost always generation
 * loops rather than intentional emphasis.
 */
function detectRepetitionLoop(text: string): HallucinationSignal | undefined {
  const lines = normalizedLines(text);
  if (lines.length < REPETITION_WINDOW) return undefined;
  const chunks = lines.map((line) => {
    const words = line.split(" ");
    return words.length <= 8 ? words.join(" ") : words.slice(0, 8).join(" ");
  });
  const counts = new Map<string, number>();
  for (const chunk of chunks) counts.set(chunk, (counts.get(chunk) || 0) + 1);
  let maxCount = 0;
  let topChunk = "";
  for (const [chunk, count] of counts) {
    if (count > maxCount) { maxCount = count; topChunk = chunk; }
  }
  if (maxCount >= REPETITION_WINDOW && maxCount / chunks.length >= 0.4) {
    return { id: "repetition_loop", detail: `回答疑似陷入循环重复（「${topChunk.slice(0, 40)}…」出现 ${maxCount} 次，占正文 ${(100 * maxCount / chunks.length).toFixed(0)}%）。` };
  }
  return undefined;
}

const SUCCESS_CLAIM_PATTERN = /(?:已(?:经)?(?:成功|完成|执行)|操作已(?:成功)?|successfully (?:completed|done)|done\.)/i;
const FAILURE_ACK_PATTERN = /(?:失败|未能|无法|没有成功|出错|error|failed)/i;
const TOOL_MENTION = /(?:工具|调用|secagent__|secscore|plugin)/i;

/** The model asserts an operation succeeded while the very tools it called failed. */
function detectSuccessClaimAfterFailure(evidence: TurnEvidence, text: string): HallucinationSignal | undefined {
  const failures = evidence.toolCalls.filter((call) => !call.ok);
  if (!failures.length) return undefined;
  const head = text.slice(0, 600);
  const claimsSuccess = SUCCESS_CLAIM_PATTERN.test(head) && !FAILURE_ACK_PATTERN.test(head);
  const mentionsTool = TOOL_MENTION.test(text) || /(?:操作|积分|写入|保存|修改|创建)/.test(head);
  if (claimsSuccess && mentionsTool) {
    const names = [...new Set(failures.map((call) => call.name))].slice(0, 3).join("、");
    return { id: "claims_success_after_tool_failure", detail: `本轮工具 ${names} 实际执行失败，但回答开头声称操作已成功。请核实后再采信。` };
  }
  return undefined;
}

const FABRICATED_REFERENCE = /(?:如上(?:方|图|文)所示|从(?:上述|以上)(?:结果|截图|表格)可见|(?:as shown|as mentioned) (?:above|in the table))/i;

/** Refers to evidence (tables/screenshots/results) that were never produced this turn. */
function detectFabricatedReference(evidence: TurnEvidence, text: string): HallucinationSignal | undefined {
  if (evidence.toolCalls.length > 0) return undefined;
  const match = text.match(FABRICATED_REFERENCE);
  if (match) return { id: "fabricated_tool_reference", detail: `回答引用了不存在的材料（「${match[0]}」），但本轮没有任何工具产生数据。` };
  return undefined;
}

export function detectHallucination(finalText: string, evidence: TurnEvidence): HallucinationReport {
  const signals: HallucinationSignal[] = [];
  const repetition = detectRepetitionLoop(finalText);
  if (repetition) signals.push(repetition);
  const successClaim = detectSuccessClaimAfterFailure(evidence, finalText);
  if (successClaim) signals.push(successClaim);
  const fabricated = detectFabricatedReference(evidence, finalText);
  if (fabricated) signals.push(fabricated);
  return { score: signals.length, signals };
}
