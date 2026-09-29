import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const WORKSPACE_ENV = "SECTL_WORKSPACE";

/**
 * Platform-appropriate per-user data root for SecAgent.
 *
 * Historically the workspace defaulted to `~/SecAgentWorkspace`, which litters
 * the home directory on every platform (and on Windows lands directly in
 * `C:\Users\<name>`). The new default follows each OS convention and matches
 * Electron's own `app.getPath("userData")` root, so there is exactly one
 * directory to look at:
 *
 *   - Windows:  %APPDATA%\SecAgent\workspace
 *   - macOS:    ~/Library/Application Support/SecAgent/workspace
 *   - Linux:    $XDG_CONFIG_HOME/SecAgent/workspace (~/.config/SecAgent/workspace)
 *
 * Electron's userData directory (Roaming on Windows) then holds both the
 * Chromium caches and the SecAgent workspace side by side, instead of
 * spreading state across home, Roaming and the install directory.
 */
export function defaultWorkspaceRoot(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const appData = env.APPDATA?.trim();
    if (appData) return path.join(appData, "SecAgent", "workspace");
    return path.join(os.homedir(), "AppData", "Roaming", "SecAgent", "workspace");
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "SecAgent", "workspace");
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".config"), "SecAgent", "workspace");
}

/** Resolve the default workspace, allowing the host process to override it. */
export function resolveDefaultWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[WORKSPACE_ENV]?.trim();
  return configured ? expandPath(configured) : defaultWorkspaceRoot(env);
}

export const DEFAULT_WORKSPACE = resolveDefaultWorkspace();

export function expandPath(input: string, base = process.cwd()): string {
  const expanded = input === "~" || input.startsWith("~/")
    ? path.join(os.homedir(), input.slice(2))
    : input;
  return path.resolve(base, expanded);
}

/** The pre-migration default workspace location. */
export const LEGACY_WORKSPACE = path.join(os.homedir(), "SecAgentWorkspace");

/**
 * Move a legacy `~/SecAgentWorkspace` to the platform-appropriate default the
 * first time the app runs after the change. No-op when the override env var is
 * set, the legacy directory is gone, or the target already exists.
 */
export function migrateLegacyWorkspace(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env[WORKSPACE_ENV]?.trim()) return undefined;
  const target = defaultWorkspaceRoot(env);
  if (path.resolve(LEGACY_WORKSPACE) === path.resolve(target)) return undefined;
  if (!fs.existsSync(LEGACY_WORKSPACE) || fs.existsSync(target)) return undefined;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(LEGACY_WORKSPACE, target);
    return target;
  } catch {
    // Cross-device rename (e.g. home on another drive): copy then retire the old tree.
    try {
      fs.cpSync(LEGACY_WORKSPACE, target, { recursive: true });
      const retired = `${LEGACY_WORKSPACE}.migrated`;
      fs.rmSync(retired, { recursive: true, force: true });
      fs.renameSync(LEGACY_WORKSPACE, retired);
      return target;
    } catch {
      return undefined;
    }
  }
}
