import { lazy, memo, Suspense, type ComponentProps } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { VisualizationBoundary } from "./VisualizationBoundary.js";

const MermaidBlock = lazy(() => import("./MermaidBlock.js").then((module) => ({ default: module.MermaidBlock })));
const MafsBlock = lazy(() => import("./MafsBlock.js").then((module) => ({ default: module.MafsBlock })));
const R3FBlock = lazy(() => import("./R3FBlock.js").then((module) => ({ default: module.R3FBlock })));
const MathDiagramBlock = lazy(() => import("./MathDiagramBlock.js").then((module) => ({ default: module.MathDiagramBlock })));

type MarkdownCodeProps = ComponentProps<"code"> & { inline?: boolean };

function MarkdownCode({ inline, className, children, ...props }: MarkdownCodeProps) {
  const language = /language-(\w+)/.exec(className || "")?.[1];
  const chart = String(children).replace(/\n$/, "");
  const visualization = !inline && (
    language === "mermaid" ? <MermaidBlock chart={chart} /> :
    language === "mafs" ? <MafsBlock source={chart} /> :
    language === "r3f" ? <R3FBlock source={chart} /> :
    language === "mathdiagram" ? <MathDiagramBlock source={chart} /> : null
  );
  if (visualization) return <VisualizationBoundary key={language} source={chart}>
    <Suspense fallback={<span role="status">正在加载图表…</span>}>{visualization}</Suspense>
  </VisualizationBoundary>;
  return <code className={className} {...props}>{children}</code>;
}

function expandMafsTags(markdown: string): string {
  const expanded = markdown
    .replace(/<Mafs\b[^>]*>([\s\S]*?)<\/Mafs>/gi, (_, source: string) => `\n\n\`\`\`mafs\n${source.trim()}\n\`\`\`\n\n`)
    .replace(/<R3F\b[^>]*>([\s\S]*?)<\/R3F>/gi, (_, source: string) => `\n\n\`\`\`r3f\n${source.trim()}\n\`\`\`\n\n`)
    .replace(/<MathDiagram\b[^>]*>([\s\S]*?)<\/MathDiagram>/gi, (_, source: string) => `\n\n\`\`\`mathdiagram\n${source.trim()}\n\`\`\`\n\n`);
  return expanded.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?div\b[^>]*>/gi, "\n");
}

export const MarkdownContent = memo(function MarkdownContent({ children }: { children: string }) {
  // P3-7 不可信输出处理：
  // - 原始 HTML 不渲染——插件链无 rehype-raw，模型输出里的 <script>/<img onerror> 等
  //   会被 react-markdown 直接丢弃（只保留可显示的文本/结构）
  // - URL 协议白名单——显式传 defaultUrlTransform（https?/ircs?/mailto/xmpp +
  //   相对地址），javascript:/data: 等被替换为空串；行为由 ansi.test.ts 上锁
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} urlTransform={defaultUrlTransform} components={{ code: MarkdownCode }}>{expandMafsTags(children)}</ReactMarkdown>;
});
