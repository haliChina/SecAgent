/**
 * 消息渲染助手（B4 自 App.tsx 拆出）。
 *
 * 选区提取 / 剪贴板兼容复制 / 用户消息引用块渲染。纯函数与纯展示，
 * 无应用状态耦合。
 */
import { parseQuotedUserMessage } from "../../../quoted-message.js";

/** 提取元素内当前文本选区（为空或选区不在元素内时返回 ""）。 */
export function selectionInElement(element: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return "";
  return selection.toString().trim();
}

/** navigator.clipboard 不可用时回退 execCommand 的复制。 */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

/** 用户消息体：引用块（若有）+ 正文。 */
export function UserQuotedContent({ content }: { content: string }) {
  const parsed = parseQuotedUserMessage(content);
  if (!parsed.quote) return <>{content}</>;
  return <>
    <blockquote className="message-quote">{parsed.quote}</blockquote>
    {parsed.body ? parsed.body : null}
  </>;
}
