// src/companion-apps.test.ts
import assert from "node:assert/strict";
import path2 from "node:path";
import test from "node:test";

// src/companion-apps.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// src/companion-catalog.ts
var COMPANION_CATALOG = [
  { pluginId: "classisland-connector", appName: "ClassIsland", description: "\u8BFE\u8868\u3001\u6362\u8BFE\u548C\u6863\u6848\u914D\u7F6E", icon: "/classisland-icon.png" },
  { pluginId: "class-widgets", appName: "Class Widgets", description: "\u8BFE\u8868\u5C0F\u7EC4\u4EF6\u4E0E\u8BFE\u7A0B\u4FE1\u606F", icon: "/cw-icon.png" },
  { pluginId: "secrandom", appName: "SecRandom", description: "\u968F\u673A\u70B9\u540D", icon: "/secrandom-logo.png" },
  { pluginId: "secscore-connector", appName: "SecScore", description: "\u8BFE\u5802\u79EF\u5206", icon: "/SecScore.png" },
  { pluginId: "iccce-connector", appName: "ICC-CE", description: "\u4E92\u52A8\u753B\u677F", icon: "/iccce-logo.png" }
];
var COMPANION_PLUGIN_IDS = new Set(COMPANION_CATALOG.map((item) => item.pluginId));

// src/companion-apps.ts
function detectCompanionApps(options = {}) {
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const exists = options.exists || ((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  return COMPANION_CATALOG.map((app) => {
    const evidence = candidatePaths(app.pluginId, home, env).find(exists);
    return { ...app, detected: Boolean(evidence), ...evidence ? { evidence } : {} };
  });
}
function candidatePaths(pluginId, home, env) {
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const roaming = env.APPDATA || path.join(home, "AppData", "Roaming");
  const programFiles = env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const names = appDirNames(pluginId);
  const roots = [
    local,
    roaming,
    path.join(local, "Programs"),
    programFiles,
    programFilesX86,
    path.join(home, ".config"),
    path.join(home, ".local", "share"),
    path.join(home, "Library", "Application Support"),
    "/opt",
    "/usr/share/applications",
    path.join(home, ".local", "share", "applications"),
    "/Applications"
  ];
  const paths = names.flatMap((name) => roots.map((root) => path.join(root, name)));
  if (pluginId === "secscore-connector") {
    paths.push(...roots.flatMap((root) => [
      path.join(root, "SecScore", "SecScore.exe"),
      path.join(root, "SecScore", "secscore.exe"),
      path.join(root, "SecScore.exe"),
      path.join(root, "secscore.exe")
    ]));
  }
  if (pluginId === "class-widgets") {
    paths.push(path.join(home, ".class-widgets"), path.join(roaming, "Class Widgets"), path.join(local, "ClassWidgets"));
  }
  if (pluginId === "classisland-connector") {
    paths.push(path.join("/Applications", "ClassIsland.app"));
  }
  if (pluginId === "iccce-connector") {
    paths.push(path.join("/Applications", "ICC-CE.app"), path.join(local, "icc-ce"), path.join(home, ".config", "icc-ce"));
  }
  return [...new Set(paths)];
}
function appDirNames(pluginId) {
  if (pluginId === "classisland-connector") return ["ClassIsland", "classisland.desktop"];
  if (pluginId === "class-widgets") return ["Class Widgets", "ClassWidgets", "class-widgets", "class-widgets.desktop"];
  if (pluginId === "secrandom") return ["SecRandom", "secrandom", "secrandom.desktop"];
  if (pluginId === "secscore-connector") return ["SecScore", "secscore", "secscore.desktop"];
  if (pluginId === "iccce-connector") return ["ICC-CE", "ICC CE", "iccce", "icc-ce.desktop"];
  return [];
}

// src/companion-apps.test.ts
test("detects Class Widgets from the Linux config directory", () => {
  const home = "/home/teacher";
  const detected = detectCompanionApps({
    home,
    env: {},
    exists: (candidate) => candidate === path2.join(home, ".class-widgets")
  });
  const widgets = detected.find((app) => app.pluginId === "class-widgets");
  assert.equal(widgets?.detected, true);
  assert.equal(detected.filter((app) => app.detected).length, 1);
});
test("detects ClassIsland from LocalAppData", () => {
  const home = "C:\\Users\\teacher";
  const local = "C:\\Users\\teacher\\AppData\\Local";
  const detected = detectCompanionApps({
    home,
    env: { LOCALAPPDATA: local, APPDATA: "C:\\Users\\teacher\\AppData\\Roaming" },
    exists: (candidate) => candidate === path2.join(local, "ClassIsland")
  });
  assert.equal(detected.find((app) => app.pluginId === "classisland-connector")?.detected, true);
});
test("detects the SecScore Windows executable in its Tauri install layout", () => {
  const home = "C:\\Users\\teacher";
  const local = "C:\\Users\\teacher\\AppData\\Local";
  const executable = path2.join(local, "Programs", "SecScore", "SecScore.exe");
  const detected = detectCompanionApps({
    home,
    env: { LOCALAPPDATA: local },
    exists: (candidate) => candidate === executable
  });
  assert.equal(detected.find((app) => app.pluginId === "secscore-connector")?.detected, true);
});
