/**
 * Resilient loader for the local sherpa-onnx speech engine.
 *
 * `sherpa-onnx` is a CommonJS package wrapping an Emscripten WASM runtime; its
 * on-disk layout (wasm + model files) must stay intact at require time. Bundling
 * it into the main-process bundle breaks the wasm lookup, so the loader always
 * resolves the package at runtime — via `createRequire` in ESM hosts, the host
 * `require` in CJS bundles, or dynamic import as a last resort — and reports a
 * readable error instead of crashing the app.
 */
import { createRequire } from "node:module";

type SherpaModule = typeof import("sherpa-onnx");

const MODULE_ID = "sherpa-onnx";
let cached: SherpaModule | undefined;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadSherpaOnnx(): Promise<SherpaModule> {
  if (cached) return cached;
  const failures: string[] = [];

  // 1) createRequire anchored at this file: works under plain `node` (CLI) and
  //    in the Electron main bundle, because node_modules is still resolvable
  //    from the emitted file location.
  try {
    const requireAtHere = createRequire(import.meta.url);
    cached = requireAtHere(MODULE_ID) as SherpaModule;
    return cached;
  } catch (error) {
    failures.push(`createRequire: ${describe(error)}`);
  }

  // 2) Host-provided require: electron-vite emits a CJS bundle where a real
  //    `require` exists on the module scope. The dynamic member access keeps
  //    bundlers from rewriting it.
  const hostRequire = (globalThis as { require?: (id: string) => unknown }).require;
  if (typeof hostRequire === "function") {
    try {
      cached = hostRequire(MODULE_ID) as SherpaModule;
      return cached;
    } catch (error) {
      failures.push(`require: ${describe(error)}`);
    }
  }

  // 3) Dynamic import: last resort for ESM-only hosts.
  try {
    cached = (await import(/* @vite-ignore */ MODULE_ID)) as SherpaModule;
    return cached;
  } catch (error) {
    failures.push(`import: ${describe(error)}`);
  }

  throw new Error(
    `本地语音引擎 sherpa-onnx 加载失败（${failures.join("；")}）。` +
    "已安装的桌面版会把引擎放在 resources 目录；开发模式请先执行 npm install。"
  );
}
