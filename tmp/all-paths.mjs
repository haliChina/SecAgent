// src/paths.test.ts
import assert from "node:assert/strict";
import fs2 from "node:fs";
import os2 from "node:os";
import path2 from "node:path";
import test from "node:test";

// src/paths.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var WORKSPACE_ENV = "SECTL_WORKSPACE";
function defaultWorkspaceRoot(env = process.env, platform = process.platform) {
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
function resolveDefaultWorkspace(env = process.env) {
  const configured = env[WORKSPACE_ENV]?.trim();
  return configured ? expandPath(configured) : defaultWorkspaceRoot(env);
}
var DEFAULT_WORKSPACE = resolveDefaultWorkspace();
function expandPath(input, base = process.cwd()) {
  const expanded = input === "~" || input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
  return path.resolve(base, expanded);
}
var LEGACY_WORKSPACE = path.join(os.homedir(), "SecAgentWorkspace");
function migrateLegacyWorkspace(env = process.env) {
  if (env[WORKSPACE_ENV]?.trim()) return void 0;
  const target = defaultWorkspaceRoot(env);
  if (path.resolve(LEGACY_WORKSPACE) === path.resolve(target)) return void 0;
  if (!fs.existsSync(LEGACY_WORKSPACE) || fs.existsSync(target)) return void 0;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(LEGACY_WORKSPACE, target);
    return target;
  } catch {
    try {
      fs.cpSync(LEGACY_WORKSPACE, target, { recursive: true });
      const retired = `${LEGACY_WORKSPACE}.migrated`;
      fs.rmSync(retired, { recursive: true, force: true });
      fs.renameSync(LEGACY_WORKSPACE, retired);
      return target;
    } catch {
      return void 0;
    }
  }
}

// src/paths.test.ts
test("default workspace follows the platform data directory", () => {
  const resolved = resolveDefaultWorkspace({});
  assert.equal(resolved, defaultWorkspaceRoot({}));
  if (process.platform === "win32") {
    assert.match(resolved, /[\\/]SecAgent[\\/]workspace$/);
    assert.notEqual(resolved, path2.join(os2.homedir(), "SecAgentWorkspace"));
  } else if (process.platform === "darwin") {
    assert.equal(resolved, path2.join(os2.homedir(), "Library", "Application Support", "SecAgent", "workspace"));
  } else {
    assert.equal(resolved, path2.join(os2.homedir(), ".config", "SecAgent", "workspace"));
  }
});
test("honours XDG_CONFIG_HOME on linux-style environments", () => {
  const xdg = path2.join(os2.tmpdir(), "secagent-xdg-home");
  assert.equal(defaultWorkspaceRoot({ XDG_CONFIG_HOME: xdg, APPDATA: path2.join(os2.tmpdir(), "appdata") }, "linux"), path2.join(xdg, "SecAgent", "workspace"));
});
test("honours APPDATA on windows-style environments", () => {
  const appData = path2.join(os2.tmpdir(), "appdata");
  assert.equal(defaultWorkspaceRoot({ APPDATA: appData }, "win32"), path2.join(appData, "SecAgent", "workspace"));
});
test("resolves SECTL_WORKSPACE as an absolute workspace path", () => {
  const configured = path2.join(os2.tmpdir(), "secagent-env-workspace");
  assert.equal(resolveDefaultWorkspace({ [WORKSPACE_ENV]: configured }), configured);
});
test("ignores an empty SECTL_WORKSPACE value", () => {
  assert.equal(resolveDefaultWorkspace({ [WORKSPACE_ENV]: "   " }), defaultWorkspaceRoot({}));
});
test("migrateLegacyWorkspace moves the legacy home directory once", () => {
  const target = defaultWorkspaceRoot({});
  if (path2.resolve(LEGACY_WORKSPACE) === path2.resolve(target)) return;
  const legacyExisted = fs2.existsSync(LEGACY_WORKSPACE);
  const targetExisted = fs2.existsSync(target);
  if (!legacyExisted && !targetExisted) {
    fs2.mkdirSync(LEGACY_WORKSPACE, { recursive: true });
    fs2.writeFileSync(path2.join(LEGACY_WORKSPACE, "marker.txt"), "data", "utf8");
  }
  const first = migrateLegacyWorkspace({});
  if (legacyExisted || targetExisted) {
    assert.equal(first, void 0);
    return;
  }
  assert.equal(first, target);
  assert.ok(fs2.existsSync(path2.join(target, "marker.txt")));
  assert.ok(!fs2.existsSync(LEGACY_WORKSPACE));
  assert.equal(migrateLegacyWorkspace({}), void 0);
  fs2.rmSync(target, { recursive: true, force: true });
});
test("migrateLegacyWorkspace respects an explicit workspace override", () => {
  assert.equal(migrateLegacyWorkspace({ [WORKSPACE_ENV]: "/tmp/secagent-override" }), void 0);
});
