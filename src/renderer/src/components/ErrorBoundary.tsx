import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * 窗口级渲染崩溃兜底（R6 真机白屏的系统性防线）。
 *
 * 背景：渲染期抛异常（如 IPC 运行时数据缺字段）时整棵 React 树卸载，用户只看
 * 到原生标题栏——即「白屏」。tsc / build / test 与静态 review 都无法覆盖这类
 * 「运行时数据契约断裂」（CI 全绿 + 真机白屏）。
 *
 * R7 起从设置窗口推广到主窗口/wake 窗口：三条 render 路径统一包住。
 * crashTitle 显示在错误卡片标题；windowTitle 可选地保留各窗口原生标题栏
 * （settings-shell 外壳复用，视觉不跳）。
 */
export class WindowErrorBoundary extends Component<{ crashTitle: string; windowTitle?: string; children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[renderer] 渲染崩溃:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return <main className="settings-shell has-window-title" role="alert">
        {this.props.windowTitle ? <div className="settings-window-title">{this.props.windowTitle}</div> : null}
        <div className="settings-crash">
          <h2>{this.props.crashTitle}</h2>
          <p>渲染过程中发生异常（此前这类错误表现为整窗白屏）。详细信息：</p>
          <pre>{String(this.state.error.stack || this.state.error)}</pre>
          <button type="button" onClick={() => this.setState({ error: null })}>重试</button>
        </div>
      </main>;
    }
    return this.props.children;
  }
}
