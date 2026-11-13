/** Mermaid 的 initialize 修改共享配置，必须与对应 render 一起顺序执行。 */
export function createMermaidRenderQueue() {
  let tail: Promise<void> = Promise.resolve();
  return (task: () => Promise<void>): Promise<void> => {
    const result = tail.then(task);
    // 单张图失败不能阻止后续图表，错误仍由本次调用方展示。
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
