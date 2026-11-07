import { Component, type ReactNode } from "react";

type VisualizationBoundaryProps = { source: string; children: ReactNode };

export class VisualizationBoundary extends Component<VisualizationBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <>
      <span role="status">图表加载或渲染失败，以下为源文本：</span>{"\n"}
      <code>{this.props.source}</code>
    </>;
    return this.props.children;
  }
}
