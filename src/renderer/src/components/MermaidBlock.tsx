import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { mermaidThemeFor, mermaidThemeVariables } from "../mermaid-theme.js";
import { createMermaidRenderQueue } from "../mermaid-render-queue.js";

let mermaidId = 0;
const enqueueRender = createMermaidRenderQueue();

function currentTheme() {
  return mermaidThemeFor(document.documentElement.dataset.theme === "dark");
}

export function MermaidBlock({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-diagram-${++mermaidId}`);
  const [theme, setTheme] = useState(currentTheme);

  /* 主题可在运行中切换（设置页保存后广播 data-theme），图表需随主题重绘。 */
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    setTheme(currentTheme());
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    container.textContent = "正在渲染图表…";
    container.classList.remove("mermaid-error");
    void enqueueRender(async () => {
      if (cancelled) return;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, themeVariables: mermaidThemeVariables(theme) });
      const { svg, bindFunctions } = await mermaid.render(idRef.current, chart);
      if (cancelled || !containerRef.current) return;
      containerRef.current.innerHTML = svg;
      bindFunctions?.(containerRef.current);
    }).catch((error: unknown) => {
      if (cancelled || !containerRef.current) return;
      containerRef.current.textContent = `Mermaid 图表渲染失败：${error instanceof Error ? error.message : String(error)}`;
      containerRef.current.classList.add("mermaid-error");
    });

    return () => {
      cancelled = true;
    };
  }, [chart, theme]);

  return <div ref={containerRef} className="mermaid-block" role="img" aria-label="Mermaid 图表" />;
}