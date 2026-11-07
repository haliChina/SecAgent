import { useEffect, useRef } from "react";
import mermaid from "mermaid";

let mermaidId = 0;

export function MermaidBlock({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-diagram-${++mermaidId}`);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    container.textContent = "正在渲染图表…";
    container.classList.remove("mermaid-error");
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
    void mermaid.render(idRef.current, chart).then(({ svg, bindFunctions }) => {
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
  }, [chart]);

  return <div ref={containerRef} className="mermaid-block" role="img" aria-label="Mermaid 图表" />;
}
