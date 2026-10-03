import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * 设置窗口渲染崩溃兜底（R6 真机白屏的系统性防线）。
 *
 * 背景：设置窗口的 React 树在渲染期抛异常（如 IPC 运行时数据缺字段）时
 * 整树卸载，用户只看到原生标题栏——即「白屏」。tsc / build / test 与静态
 * review 都无法覆盖这类「运行时数据契约断裂」（CI 全绿 + 真机白屏）。
 * 此组件把崩溃变成可见的错误卡片（含栈与重试），让下次暗雷当场可诊断。
 */
export class SettingsErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[settings] 渲染崩溃:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return <main className="settings-shell has-window-title" role="alert">
        <div className="settings-window-title">SecAgent设置</div>
        <div className="settings-crash">
          <h2>设置页遇到错误</h2>
          <p>渲染过程中发生异常（此前这类错误表现为整窗白屏）。详细信息：</p>
          <pre>{String(this.state.error.stack || this.state.error)}</pre>
          <button type="button" onClick={() => this.setState({ error: null })}>重试</button>
        </div>
      </main>;
    }
    return this.props.children;
  }
}
