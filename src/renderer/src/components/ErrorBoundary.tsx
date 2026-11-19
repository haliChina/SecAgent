import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
  componentStack: string | null;
  copied: boolean;
}

/**
 * 窗口级渲染崩溃兜底（R6 真机白屏的系统性防线）。
 *
 * 背景：渲染期抛异常（如 IPC 运行时数据缺字段）时整棵 React 树卸载，用户只看
 * 到原生标题栏——即「白屏」。tsc / build / test 与静态 review 都无法覆盖这类
 * 「运行时数据契约断裂」（CI 全绿 + 真机白屏）。
 *
 * R7 起从设置窗口推广到主窗口/wake 窗口：三条 render 路径统一包住。
 * R8 增加「复制错误信息」：桌面应用报障场景，用户一键把错误栈贴进 issue。
 * crashTitle 显示在错误卡片标题；windowTitle 可选地保留各窗口原生标题栏
 * （settings-shell 外壳复用，视觉不跳）。
 */
export class WindowErrorBoundary extends Component<{ crashTitle: string; windowTitle?: string; children: ReactNode }, State> {
  state: State = { error: null, componentStack: null, copied: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[renderer] 渲染崩溃:", error, info.componentStack);
    // R28：React #130（元素类型 undefined）这类错误只有组件栈能定位到具体组件，
    // 落到 state 里随错误一起展示/复制，报障时无需翻 DevTools。
    if (info.componentStack) this.setState({ componentStack: info.componentStack });
  }

  private copyDetails = (): void => {
    const error = this.state.error;
    if (!error) return;
    const details = this.state.componentStack
      ? `${String(error.stack || error)}\n\nComponent stack:${this.state.componentStack}`
      : String(error.stack || error);
    void navigator.clipboard?.writeText(details).then(() => {
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 2000);
    }).catch(() => undefined);
  };

  render(): ReactNode {
    if (this.state.error) {
      return <main className="settings-shell has-window-title" role="alert">
        {this.props.windowTitle ? <div className="settings-window-title">{this.props.windowTitle}</div> : null}
        <div className="settings-crash">
          <h2>{this.props.crashTitle}</h2>
          <p>渲染过程中发生异常（此前这类错误表现为整窗白屏）。详细信息：</p>
          <pre>{String(this.state.error.stack || this.state.error)}</pre>
          {this.state.componentStack ? <details className="settings-crash-components"><summary>组件栈（定位用）</summary><pre>{this.state.componentStack}</pre></details> : null}
          <div className="settings-crash-actions">
            <button type="button" onClick={this.copyDetails}>{this.state.copied ? "已复制" : "复制错误信息"}</button>
            <button type="button" className="settings-crash-retry" onClick={() => this.setState({ error: null, componentStack: null, copied: false })}>重试</button>
          </div>
        </div>
      </main>;
    }
    return this.props.children;
  }
}
