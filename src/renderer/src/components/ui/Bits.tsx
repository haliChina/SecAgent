/* R31 P1 步骤 1（纯搬家，零行为变化）：Bits.tsx 已解体为 parts/ 域文件，
   本文件仅作 barrel，维持 App/SettingsApp/MessageActivities 既有导入路径。
   P1 步骤 2 已删除 _dead-* 死组件（15 个，约 2000 行）。审计见 UI-REWRITE-PLAN.md。 */
export * from "./parts/scroll-progress.js";
export * from "./parts/matrix-orb.js";
export * from "./parts/aurora-backdrop.js";
export * from "./parts/day-separator.js";
export * from "./parts/thought-line.js";
export * from "./parts/voice-pill.js";
export * from "./parts/delete-button.js";
export * from "./parts/animated-counter.js";
export * from "./parts/hook-sidebar.js";
export * from "./parts/aui-shared.js";
export * from "./parts/tool-error.js";
export * from "./parts/aui-feedback.js";
export * from "./parts/prompt-bar.js";
