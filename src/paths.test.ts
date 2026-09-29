import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LEGACY_WORKSPACE, WORKSPACE_ENV, defaultWorkspaceRoot, migrateLegacyWorkspace, resolveDefaultWorkspace } from "./paths.js";

test("default workspace follows the platform data directory", () => {
  const resolved = resolveDefaultWorkspace({});
  assert.equal(resolved, defaultWorkspaceRoot({}));
  if (process.platform === "win32") {
    assert.match(resolved, /[\\/]SecAgent[\\/]workspace$/);
    assert.notEqual(resolved, path.join(os.homedir(), "SecAgentWorkspace"));
  } else if (process.platform === "darwin") {
    assert.equal(resolved, path.join(os.homedir(), "Library", "Application Support", "SecAgent", "workspace"));
  } else {
    assert.equal(resolved, path.join(os.homedir(), ".config", "SecAgent", "workspace"));
  }
});

test("honours XDG_CONFIG_HOME on linux-style environments", () => {
  const xdg = path.join(os.tmpdir(), "secagent-xdg-home");
  assert.equal(defaultWorkspaceRoot({ XDG_CONFIG_HOME: xdg, APPDATA: path.join(os.tmpdir(), "appdata") }, "linux"), path.join(xdg, "SecAgent", "workspace"));
});

test("honours APPDATA on windows-style environments", () => {
  const appData = path.join(os.tmpdir(), "appdata");
  assert.equal(defaultWorkspaceRoot({ APPDATA: appData }, "win32"), path.join(appData, "SecAgent", "workspace"));
});

test("resolves SECTL_WORKSPACE as an absolute workspace path", () => {
  const configured = path.join(os.tmpdir(), "secagent-env-workspace");
  assert.equal(resolveDefaultWorkspace({ [WORKSPACE_ENV]: configured }), configured);
});

test("ignores an empty SECTL_WORKSPACE value", () => {
  assert.equal(resolveDefaultWorkspace({ [WORKSPACE_ENV]: "   " }), defaultWorkspaceRoot({}));
});

test("migrateLegacyWorkspace moves the legacy home directory once", () => {
  const target = defaultWorkspaceRoot({});
  if (path.resolve(LEGACY_WORKSPACE) === path.resolve(target)) return; // already colocated
  const legacyExisted = fs.existsSync(LEGACY_WORKSPACE);
  const targetExisted = fs.existsSync(target);
  if (!legacyExisted && !targetExisted) {
    fs.mkdirSync(LEGACY_WORKSPACE, { recursive: true });
    fs.writeFileSync(path.join(LEGACY_WORKSPACE, "marker.txt"), "data", "utf8");
  }
  const first = migrateLegacyWorkspace({});
  if (legacyExisted || targetExisted) {
    assert.equal(first, undefined); // nothing to do or target already present
    return;
  }
  assert.equal(first, target);
  assert.ok(fs.existsSync(path.join(target, "marker.txt")));
  assert.ok(!fs.existsSync(LEGACY_WORKSPACE));
  assert.equal(migrateLegacyWorkspace({}), undefined); // idempotent
  fs.rmSync(target, { recursive: true, force: true });
});

test("migrateLegacyWorkspace respects an explicit workspace override", () => {
  assert.equal(migrateLegacyWorkspace({ [WORKSPACE_ENV]: "/tmp/secagent-override" }), undefined);
});
