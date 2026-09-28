import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Keep native/WASM-heavy dependencies as runtime requires: bundling
  // sherpa-onnx (Emscripten loader + .wasm + onnx models) into the main or
  // preload bundle breaks its on-disk lookups, which is exactly what made the
  // local speech model fail to load in packaged builds.
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: "src/electron/main.ts" } }
  },
  // Electron runs sandboxed preload scripts as CommonJS.  A `.cjs` filename is
  // important because this package otherwise opts into ESM via `type: module`.
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: "src/electron/preload.ts",
        output: { format: "cjs", entryFileNames: "[name].cjs" }
      }
    }
  },
  renderer: { root: "src/renderer", plugins: [react()] }
});
