/**
 * 消息分支（R98，学习 DeepSeek chat-demo branches.ts）。
 *
 * 重新生成不再覆盖旧回复：新 assistant 消息带 variantOf 指回本组
 * 原始消息，原消息的 selectedVariant 记录当前显示的版本。全量消息
 * 始终保留在存储里（SQLite payload 列免费持久化两个可选字段），
 * 渲染层用 visibleMessages 过滤出当前路径——切回任意版本零成本。
 *
 * 与 DeepSeek parentId 树的差异：我们的会话是平面数组（按 seq 排序），
 * variantOf 只对 assistant 消息生效、每组只有一个「原始」节点；
 * 重新生成的变体永远追加在组原始位置之后（seq 更大但显示时插回
 * 原位），编辑提问走既有「引用重发」路径不动。
 */

import type { SessionMessage } from "./session-store.js";

/** 消息所属变体组：assistant 消息自身 id 或其 variantOf 指向的原始 id。 */
export function variantGroupId(message: SessionMessage): string | null {
  if (message.role !== "assistant") return null;
  return message.variantOf ?? message.id;
}

/** 一组消息的可见判定：
 * - 非 assistant / 无变体字段 → 可见
 * - 组内（原始消息）的 selectedVariant 指向自己或未设 → 显示自己
 * - 变体消息：原始消息 selectedVariant === 自身 id → 显示
 * 兼容：原始消息被删除（导入修剪等）时变体全部显示（孤儿保底，不静默丢内容）。 */
export function isMessageVisible(message: SessionMessage, byId: Map<string, SessionMessage>): boolean {
  if (message.role !== "assistant") return true;
  const groupId = message.variantOf ?? message.id;
  if (!message.variantOf) {
    /* 原始消息：仅当没有选中其他变体时显示。 */
    return !message.selectedVariant || message.selectedVariant === message.id;
  }
  const root = byId.get(groupId);
  if (!root) return true;
  return root.selectedVariant === message.id;
}

/** 过滤出当前路径上的可见消息（保持原顺序）。 */
export function visibleMessages(messages: SessionMessage[]): SessionMessage[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return messages.filter((message) => isMessageVisible(message, byId));
}

export interface MessageVersions {
  /** 组内全部版本（时间序：原始在前，变体按加入序）。 */
  ids: string[];
  /** 当前显示版本的数组下标。 */
  index: number;
}

/** 收集某条 assistant 消息所在组的全部版本与当前下标（无变体组返回单元素）。 */
export function messageVersions(messages: SessionMessage[], messageId: string): MessageVersions | null {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const target = byId.get(messageId);
  if (!target || target.role !== "assistant") return null;
  const groupId = variantGroupId(target)!;
  const ids = messages.filter((message) => variantGroupId(message) === groupId).map((message) => message.id);
  const root = byId.get(groupId);
  const currentId = !target.variantOf
    ? (root?.selectedVariant && root.selectedVariant !== root.id ? root.selectedVariant : target.id)
    : (root?.selectedVariant ?? groupId);
  const index = ids.indexOf(currentId);
  return { ids, index: index < 0 ? 0 : index };
}

/** 生成组显示状态的写库形状：选中原始自身 = selectedVariant 清空（回到默认态）。 */
export function variantSelection(groupId: string, targetId: string): { messageId: string; selectedVariant?: string } {
  return { messageId: groupId, selectedVariant: targetId === groupId ? undefined : targetId };
}
