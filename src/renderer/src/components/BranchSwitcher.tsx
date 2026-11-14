/**
 * 消息分支切换器（R98，学习 DeepSeek chat-demo BranchSwitcher）。
 *
 * 挂在可见 assistant 消息的 actions 行：该消息属于多版本组时显示
 * ‹ 2/3 ›——左右切版本（旧版本永远还在库里，切换零成本）。
 * 单版本组不渲染任何东西。
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { messageVersions, type MessageVersions } from "../../../session-branches.js";
import type { SessionMessage } from "../../../session-store.js";

export function BranchSwitcher({ messages, message, onSwitch }: {
  messages: SessionMessage[];
  message: SessionMessage;
  onSwitch: (targetId: string) => void;
}) {
  const versions: MessageVersions | null = messageVersions(messages, message.id);
  if (!versions || versions.ids.length <= 1) return null;
  const total = versions.ids.length;
  const prev = versions.ids[(versions.index - 1 + total) % total];
  const next = versions.ids[(versions.index + 1) % total];
  return <div className="branch-switcher" role="group" aria-label={`回复版本 ${versions.index + 1} / ${total}`}>
    <button type="button" className="branch-switcher-button" aria-label="上一个版本" disabled={total <= 1} onClick={() => onSwitch(prev)}><ChevronLeft size={13} strokeWidth={2} aria-hidden /></button>
    <span className="branch-switcher-count">{versions.index + 1} / {total}</span>
    <button type="button" className="branch-switcher-button" aria-label="下一个版本" disabled={total <= 1} onClick={() => onSwitch(next)}><ChevronRight size={13} strokeWidth={2} aria-hidden /></button>
  </div>;
}
