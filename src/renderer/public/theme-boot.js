// 主题防闪烁（P3-5）：首帧前同步应用缓存主题。
// 放 public/（不经 TS 编译，纯 JS 无依赖），与 asset-path-fix.js 同目录同加载方式。
// 缓存可能过期/损坏——错值只影响首帧，main.tsx 随后用 settings 真值校正。
(function () {
  try {
    var stored = window.localStorage.getItem("secagent-theme");
    var theme = stored === "dark" || stored === "system" ? stored : "light";
    var dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.dataset.theme = "dark";
  } catch (error) { /* localStorage 不可用时保持默认 light */ }
})();
