import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { PluginManager } from "./plugin-manager.js";

test("plugin rules receive the original input and can return a direct reply", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-rule-"));
  const archivePath = path.join(workspace, "rule-test.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "rule-test", name: "Rule test", version: "1.0.0", main: "main.mjs", permissions: ["agent.rules"] })));
  archive.addFile("main.mjs", Buffer.from(`
export function activate(api) {
  api.registerRule("score", /给(?<name>.+?)加(?<delta>\\d+)分/g, (input, match) => ({
    kind: "reply", message: JSON.stringify({ input, name: match.groups.name, delta: match.groups.delta })
  }));
}
`));
  archive.writeZip(archivePath);
  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    await manager.install(archivePath);
    const first = await manager.matchRule("给张三加1分");
    const second = await manager.matchRule("给李四加2分");
    assert.equal(first?.decision.kind, "reply");
    assert.deepEqual(JSON.parse((first?.decision as { kind: "reply"; message: string }).message), { input: "给张三加1分", name: "张三", delta: "1" });
    assert.deepEqual(JSON.parse((second?.decision as { kind: "reply"; message: string }).message), { input: "给李四加2分", name: "李四", delta: "2" });
    await manager.shutdown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("plugin-scoped config survives plugin manager restart", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-config-"));
  const archivePath = path.join(workspace, "config-test.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({
    apiVersion: 1,
    id: "config-test",
    name: "Config test",
    version: "1.0.0",
    main: "main.mjs",
    permissions: ["agent.settings"],
    settingsPages: [{ id: "test", title: "Test" }],
  })));
  archive.addFile("main.mjs", Buffer.from(`
export function activate(api) {
  api.registerSettingsHandler("test", async (action, args) => {
    if (action === "set") { api.setConfig(args); return api.getConfig(); }
    return api.getConfig();
  });
}
`));
  archive.writeZip(archivePath);

  try {
    const first = new PluginManager(workspace);
    await first.initialize();
    await first.install(archivePath);
    await first.callSettings("config-test", "test", "set", { accountId: "account-1", classId: "class-1" });
    await first.shutdown();

    const second = new PluginManager(workspace);
    await second.initialize();
    const config = await second.callSettings("config-test", "test", "get");
    assert.deepEqual(config, { accountId: "account-1", classId: "class-1" });
    await second.shutdown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("plugin pre-rules resolve a structured tool action without model involvement", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-pre-rule-"));
  const archivePath = path.join(workspace, "pre-rule-test.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({
    apiVersion: 1,
    id: "pre-rule-test",
    name: "Pre-rule test",
    version: "1.0.0",
    main: "main.mjs",
    permissions: ["agent.tools", "agent.pre_rules"]
  })));
  archive.addFile("main.mjs", Buffer.from(`
export function activate(api) {
  api.registerTool({ name: "draw", description: "draw", hidden: true, inputSchema: { type: "object" } }, async (args) => ({ students: [{ name: args.name || "Alice" }] }));
  api.registerPreRule("draw_command", (input) => input === "点名" ? { tool: "draw", arguments: { name: "Alice" }, render: (result) => result.students[0].name } : undefined);
}
`));
  archive.writeZip(archivePath);

  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    await manager.install(archivePath);
    const match = await manager.matchPreRule("点名");
    assert.ok(match);
    assert.equal(match?.toolKey, "pre-rule-test__draw");
    assert.deepEqual(match?.arguments, { name: "Alice" });
    assert.equal(await match?.render?.(await manager.callTool(match.toolKey, match.arguments)), "Alice");
    assert.equal(await manager.matchPreRule("普通问题"), undefined);
    await manager.shutdown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("installing a newer version replaces the active plugin", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-update-"));
  const createArchive = (version: string, marker: string): string => {
    const archivePath = path.join(workspace, `${version}.zip`);
    const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
    archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "update-test", name: "Update test", version, main: "main.mjs", permissions: ["agent.prompts"] })));
    archive.addFile("main.mjs", Buffer.from(`export function activate(api) { api.registerPrompt("marker", () => "${marker}"); }`));
    archive.writeZip(archivePath);
    return archivePath;
  };

  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    await manager.install(createArchive("1.0.0", "old"));
    assert.equal((await manager.getPromptContributions())[0].text, "old");
    await manager.install(createArchive("1.1.0", "new"));
    assert.equal(manager.list()[0].version, "1.1.0");
    assert.equal((await manager.getPromptContributions())[0].text, "new");
    await manager.shutdown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

/** 模拟 Windows 行为：目录内含进程已加载的 .node 原生模块时，rmSync 抛 EPERM。 */
function lockDirectory(dir: string): () => void {
  const original = fs.rmSync;
  (fs as unknown as { rmSync: typeof fs.rmSync }).rmSync = ((target: fs.PathLike, options?: fs.RmOptions) => {
    if (typeof target === "string" && target.startsWith(dir)) {
      throw Object.assign(new Error(`EPERM: 模拟已加载的原生模块锁定 ${target}`), { code: "EPERM" });
    }
    return original(target, options);
  }) as typeof fs.rmSync;
  return () => { (fs as unknown as { rmSync: typeof fs.rmSync }).rmSync = original; };
}

function versionedMarkerArchive(workspace: string, id: string, version: string, marker: string): string {
  const archivePath = path.join(workspace, `${id}-${version}.zip`);
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id, name: "Lock test", version, main: "main.mjs", permissions: ["agent.prompts"] })));
  archive.addFile("main.mjs", Buffer.from(`export function activate(api) { api.registerPrompt("marker", () => "${marker}"); }`));
  archive.writeZip(archivePath);
  return archivePath;
}

test("升级被进程锁定的旧版本：不得半删除旧目录，且安装必须成功（找不到主入口的根因）", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-locked-upgrade-"));
  const oldVersionDir = path.join(workspace, "plugins", "installed", "locked-upgrade", "1.0.0");
  const newVersionDir = path.join(workspace, "plugins", "installed", "locked-upgrade", "1.1.0");
  const unlock = lockDirectory(oldVersionDir);
  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    await manager.install(versionedMarkerArchive(workspace, "locked-upgrade", "1.0.0", "old"));
    assert.equal((await manager.getPromptContributions())[0].text, "old");
    // 旧版本"正在运行"（koffi.node 已加载、目录被锁）时直接装新版本
    await manager.install(versionedMarkerArchive(workspace, "locked-upgrade", "1.1.0", "new"));
    assert.equal(manager.list()[0].version, "1.1.0");
    assert.equal((await manager.getPromptContributions())[0].text, "new");
    // 关键断言：旧目录必须保持完整——绝不允许出现"main.mjs 已删、清单还在"的半删除状态
    assert.equal(fs.existsSync(path.join(oldVersionDir, "main.mjs")), true);
    assert.equal(fs.existsSync(path.join(oldVersionDir, "secagent-plugin.json")), true);
    await manager.shutdown();
    unlock();
    // 重启：启动期清理移除孤儿旧版本（此时无模块加载，删除必成），新版本继续可用
    const restarted = new PluginManager(workspace);
    await restarted.initialize();
    assert.equal(fs.existsSync(oldVersionDir), false);
    assert.equal(fs.existsSync(path.join(newVersionDir, "main.mjs")), true);
    assert.equal((await restarted.getPromptContributions())[0].text, "new");
    await restarted.shutdown();
  } finally {
    unlock();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("同版本重装被锁目录：改名隔离而不是失败，重启后清理隔离目录", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-locked-reinstall-"));
  const versionDir = path.join(workspace, "plugins", "installed", "locked-reinstall", "1.0.0");
  const pluginDir = path.dirname(versionDir);
  const unlock = lockDirectory(versionDir);
  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    await manager.install(versionedMarkerArchive(workspace, "locked-reinstall", "1.0.0", "first"));
    // 同版本重装：目标目录被锁（进程已加载其中的 .node）
    await manager.install(versionedMarkerArchive(workspace, "locked-reinstall", "1.0.0", "second"));
    assert.equal((await manager.getPromptContributions())[0].text, "second");
    // 被锁目录被改名隔离为 .trash-*，新内容就位
    const quarantined = fs.readdirSync(pluginDir).filter((name) => name.startsWith(".trash-"));
    assert.equal(quarantined.length, 1);
    assert.equal(fs.existsSync(path.join(versionDir, "main.mjs")), true);
    await manager.shutdown();
    unlock();
    const restarted = new PluginManager(workspace);
    await restarted.initialize();
    assert.equal(fs.readdirSync(pluginDir).filter((name) => name.startsWith(".trash-")).length, 0);
    assert.equal((await restarted.getPromptContributions())[0].text, "second");
    await restarted.shutdown();
  } finally {
    unlock();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("plugin SVG preview writes a workspace artifact and invokes the preview handler", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-preview-"));
  const archivePath = path.join(workspace, "preview-test.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "preview-test", name: "Preview test", version: "1.0.0", main: "main.mjs", permissions: ["agent.tools", "agent.preview"] })));
  archive.addFile("main.mjs", Buffer.from(`
export function activate(api) {
  api.registerTool({ name: "preview", description: "preview", inputSchema: { type: "object" } }, (args) => api.openSvgPreview(args));
}
`));
  archive.writeZip(archivePath);
  const handled: Array<{ filePath: string; title: string }> = [];
  const manager = new PluginManager(workspace, undefined, async (request) => { handled.push(request); return true; });
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const result = await manager.callTool("preview-test__preview", { svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>你好</text></svg>", title: "预览测试", fileName: "测试.md" }) as { path: string; relativePath: string; bytes: number; previewOpened: boolean };
    assert.equal(result.previewOpened, true);
    assert.equal(result.relativePath.startsWith("exports/handdrawn-markdown/"), true);
    assert.equal(fs.readFileSync(result.path, "utf8").includes("你好"), true);
    assert.deepEqual(handled.map((item) => item.title), ["预览测试"]);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("plugin SVG export can skip opening a preview window", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-export-only-"));
  const archivePath = path.join(workspace, "export-only-test.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "export-only-test", name: "Export only test", version: "1.0.0", main: "main.mjs", permissions: ["agent.tools", "agent.preview"] })));
  archive.addFile("main.mjs", Buffer.from(`
export function activate(api) {
  api.registerTool({ name: "export", description: "export", inputSchema: { type: "object" } }, (args) => api.openSvgPreview(args));
}
`));
  archive.writeZip(archivePath);
  let previewCalls = 0;
  const manager = new PluginManager(workspace, undefined, async () => { previewCalls += 1; return true; });
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const result = await manager.callTool("export-only-test__export", { svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" />", openPreview: false }) as { path: string; previewOpened: boolean };
    assert.equal(result.previewOpened, false);
    assert.equal(previewCalls, 0);
    assert.equal(fs.existsSync(result.path), true);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("SVG preview requires the agent.preview permission", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-preview-permission-"));
  const archivePath = path.join(workspace, "preview-permission-test.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "preview-permission-test", name: "Preview permission test", version: "1.0.0", main: "main.mjs", permissions: ["agent.tools"] })));
  archive.addFile("main.mjs", Buffer.from(`
export function activate(api) {
  api.registerTool({ name: "preview", description: "preview", inputSchema: { type: "object" } }, (args) => api.openSvgPreview(args));
}
`));
  archive.writeZip(archivePath);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    await manager.install(archivePath);
    await assert.rejects(() => manager.callTool("preview-permission-test__preview", { svg: "<svg></svg>" }), /agent\.preview/);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("loads an Agent Plugin package with nested archive root, skills, and MCP metadata", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-agent-plugin-"));
  const archivePath = path.join(workspace, "agent-plugin.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  const root = "agent-package/";
  archive.addFile(`${root}plugin.json`, Buffer.from(JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "acme.tools",
    version: "1.2.3",
    description: "Portable tools",
    repository: "https://example.com/acme/tools"
  })));
  archive.addFile(`${root}skills/deploy/SKILL.md`, Buffer.from("---\nname: deploy\ndescription: Deploy the service safely.\n---\n# Deploy\n"));
  archive.addFile(`${root}skills/broken/SKILL.md`, Buffer.from("This is not an Agent Skill."));
  archive.addFile(`${root}mcp.json`, Buffer.from(JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: { local: { type: "stdio", command: "./bin/server", args: ["--data", "${PLUGIN_DATA}"] } }
  })));
  archive.writeZip(archivePath);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    const status = await manager.install(archivePath);
    assert.equal(status.id, "acme.tools");
    assert.equal(status.format, "agent");
    assert.equal(status.version, "1.2.3");
    assert.deepEqual(manager.getSkills().map((skill) => skill.name), ["acme.tools/deploy"]);
    assert.deepEqual(manager.getMcpServers().map((server) => `${server.pluginId}/${server.name}/${server.type}`), ["acme.tools/local/stdio"]);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

function overlayTestZip(permissions: string[]): { workspace: string; archivePath: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-overlay-"));
  const archivePath = path.join(workspace, "overlay-test.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "overlay-test", name: "Overlay test", version: "1.0.0", main: "main.mjs", permissions })));
  archive.addFile("main.mjs", Buffer.from(`
export function activate(api) { globalThis.__overlayTestApi = api; }
`));
  archive.writeZip(archivePath);
  return { workspace, archivePath };
}

test("overlay: 未声明 agent.overlay 权限时拒绝", async () => {
  const { workspace, archivePath } = overlayTestZip([]);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const api = (globalThis as unknown as { __overlayTestApi: { createOverlay(input: unknown): Promise<unknown> } }).__overlayTestApi;
    await assert.rejects(
      () => api.createOverlay({ url: "http://127.0.0.1:1/", width: 200, height: 200 }),
      /未声明权限/
    );
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("overlay: 无 Electron 环境时提示不支持", async () => {
  const { workspace, archivePath } = overlayTestZip(["agent.overlay"]);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const api = (globalThis as unknown as { __overlayTestApi: { createOverlay(input: unknown): Promise<unknown> } }).__overlayTestApi;
    await assert.rejects(
      () => api.createOverlay({ url: "http://127.0.0.1:1/", width: 200, height: 200 }),
      /不支持 overlay/
    );
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("overlay: 参数校验 + 停用时自动关闭", async () => {
  const { workspace, archivePath } = overlayTestZip(["agent.overlay"]);
  const seen: string[] = [];
  const closed: string[] = [];
  const manager = new PluginManager(workspace, undefined, undefined, async (req) => {
    seen.push(`${req.pluginId}:${req.url}`);
    return {
      show: async () => {},
      hide: async () => {},
      close: async () => { closed.push(req.pluginId); },
      setBounds: async () => {}
    };
  });
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const api = (globalThis as unknown as { __overlayTestApi: { createOverlay(input: unknown): Promise<unknown> } }).__overlayTestApi;
    await assert.rejects(() => api.createOverlay({ url: "https://evil.com/x", width: 200, height: 200 }), /本地/);
    await assert.rejects(() => api.createOverlay({ url: "http://127.0.0.1:1/", width: 10, height: 200 }), /64~1600/);
    await assert.rejects(() => api.createOverlay({ url: "not-a-url", width: 200, height: 200 }), /URL 无效/);
    const handle = (await api.createOverlay({ url: "http://127.0.0.1:1234/?token=abc", width: 200, height: 200 })) as {
      show(): Promise<void>; hide(): Promise<void>; close(): Promise<void>; setBounds(b: unknown): Promise<void>;
    };
    assert.equal(typeof handle.show, "function");
    assert.equal(typeof handle.setBounds, "function");
    assert.deepEqual(seen, ["overlay-test:http://127.0.0.1:1234/?token=abc"]);
    // 停用插件 → overlay 自动关闭
    await manager.setEnabled("overlay-test", false);
    assert.deepEqual(closed, ["overlay-test"]);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// ---- Windows 实机 0.5.3→0.5.4 升级 EPERM：旧版 koffi .node 仍映射在进程内 ----
// rmSync 对 installed/<id> 抛 EPERM。修复契约：重试后改名隔离到 .trash-*，
// 安装继续成功；下次启动（任何插件加载前）清扫 .trash-*。

function createLockedArchive(workspace: string, version: string, marker: string): string {
  const archivePath = path.join(workspace, `locked-${version}.zip`);
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  archive.addFile("secagent-plugin.json", Buffer.from(JSON.stringify({ apiVersion: 1, id: "locked-test", name: "Locked test", version, main: "main.mjs", permissions: ["agent.prompts"] })));
  archive.addFile("main.mjs", Buffer.from(`export function activate(api) { api.registerPrompt("marker", () => "${marker}"); }`));
  archive.writeZip(archivePath);
  return archivePath;
}

/** 把 fs.rmSync 替换为对 installed/<id> 目录抛 EPERM，模拟 Windows 句柄锁死。 */
function lockPluginDir(pluginDirInPath: string): () => void {
  const realRmSync = fs.rmSync;
  (fs as unknown as { rmSync: typeof fs.rmSync }).rmSync = ((target: fs.PathLike, options: fs.RmOptions) => {
    if (typeof target === "string" && target.includes(pluginDirInPath)) {
      const error = new Error("EPERM: operation not permitted, unlink") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    }
    return realRmSync(target, options);
  }) as typeof fs.rmSync;
  return () => { (fs as unknown as { rmSync: typeof fs.rmSync }).rmSync = realRmSync; };
}

test("upgrading while the old plugin directory is locked leaves it intact and sweeps it on next start", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-locked-upgrade-"));
  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    await manager.install(createLockedArchive(workspace, "1.0.0", "old"));
    assert.equal((await manager.getPromptContributions())[0].text, "old");

    const unlock = lockPluginDir(path.join("installed", "locked-test"));
    try {
      await manager.install(createLockedArchive(workspace, "1.1.0", "new"));
    } finally {
      unlock();
    }
    // 安装成功：新版本就位、提示词来自新插件
    assert.equal(manager.list()[0].version, "1.1.0");
    assert.equal((await manager.getPromptContributions())[0].text, "new");
    assert.equal(fs.existsSync(path.join(workspace, "plugins", "installed", "locked-test", "1.1.0")), true);
    // 升级路径完全不碰旧版本目录（不删除、不隔离）——被锁也无所谓，不产生 .trash-*
    assert.equal(fs.existsSync(path.join(workspace, "plugins", "installed", "locked-test", "1.0.0")), true);
    const trash = fs.readdirSync(path.join(workspace, "plugins", "installed")).filter((name) => name.startsWith(".trash-"));
    assert.equal(trash.length, 0);
    await manager.shutdown();

    // 模拟重启：initialize 清扫孤儿版本目录（状态里只有 1.1.0），再加载插件
    const restarted = new PluginManager(workspace);
    await restarted.initialize();
    assert.equal(fs.existsSync(path.join(workspace, "plugins", "installed", "locked-test", "1.0.0")), false);
    assert.equal(restarted.list()[0].version, "1.1.0");
    assert.equal((await restarted.getPromptContributions())[0].text, "new");
    await restarted.shutdown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("uninstalling a locked plugin directory also succeeds via quarantine", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-locked-uninstall-"));
  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    await manager.install(createLockedArchive(workspace, "1.0.0", "old"));
    const unlock = lockPluginDir(path.join("installed", "locked-test"));
    try {
      await manager.uninstall("locked-test");
    } finally {
      unlock();
    }
    assert.equal(manager.list().length, 0);
    assert.equal(fs.existsSync(path.join(workspace, "plugins", "installed", "locked-test")), false);
    const trash = fs.readdirSync(path.join(workspace, "plugins", "installed")).filter((name) => name.startsWith(".trash-locked-test-"));
    assert.equal(trash.length, 1);
    await manager.shutdown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("when both deletion and quarantine fail on reinstall, install reports the restart guidance and keeps the old version active", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-plugin-locked-stuck-"));
  try {
    const manager = new PluginManager(workspace);
    await manager.initialize();
    await manager.install(createLockedArchive(workspace, "1.0.0", "old"));
    const realRmSync = fs.rmSync;
    const realRenameSync = fs.renameSync;
    // 同版本重装：目标目录 installed/locked-test/1.0.0 删不掉（EPERM）也隔离不了（改名失败）
    // ——升级路径已不碰旧目录，双失败只会在同版本重装时发生。
    (fs as unknown as { rmSync: typeof fs.rmSync }).rmSync = ((target: fs.PathLike, options: fs.RmOptions) => {
      if (typeof target === "string" && target.includes(path.join("installed", "locked-test", "1.0.0"))) {
        const error = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return realRmSync(target, options);
    }) as typeof fs.rmSync;
    (fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
      if (typeof from === "string" && from.includes(path.join("installed", "locked-test", "1.0.0"))) throw new Error("EPERM: rename not permitted");
      return realRenameSync(from, to);
    }) as typeof fs.renameSync;
    try {
      await assert.rejects(
        () => manager.install(createLockedArchive(workspace, "1.0.0", "new")),
        /完全退出 SecAgent/
      );
    } finally {
      (fs as unknown as { rmSync: typeof fs.rmSync }).rmSync = realRmSync;
      (fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = realRenameSync;
    }
    // 失败不破坏既有安装，且旧版本被自动重新激活——服务不停摆到重启
    assert.equal(manager.list()[0].version, "1.0.0");
    assert.equal((await manager.getPromptContributions())[0].text, "old");
    await manager.shutdown();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// ---- flashMarker（操作落点发光标记，computer-use 0.7.3+）----

test("flashMarker: 透传 flashHandler + kind/radius 归一，非法坐标静默", async () => {
  const { workspace, archivePath } = overlayTestZip([]);
  const calls: unknown[][] = [];
  const manager = new PluginManager(workspace, undefined, undefined, undefined, (x, y, opts) => {
    calls.push([x, y, opts]);
  });
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const api = (globalThis as unknown as { __overlayTestApi: { flashMarker(x: number, y: number, opts?: { kind?: string; radius?: number }): void } }).__overlayTestApi;
    api.flashMarker(100, 200, { kind: "type" });
    api.flashMarker(10.6, 20.4); // 非整数坐标四舍五入
    api.flashMarker(Number.NaN, 1); // NaN 静默丢弃
    api.flashMarker(3, Number.POSITIVE_INFINITY); // Infinity 静默丢弃
    api.flashMarker(1, 2, { kind: "bogus" as unknown as string }); // kind 非法由宿主侧归一为 click（handler 原样收到，不抛错）
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], [100, 200, { kind: "type" }]);
    assert.deepEqual(calls[1], [11, 20, undefined]);
    assert.deepEqual(calls[2], [1, 2, { kind: "bogus" }]);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("flashMarker: 无 flashHandler（纯服务端）时为 no-op 不抛错", async () => {
  const { workspace, archivePath } = overlayTestZip([]);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const api = (globalThis as unknown as { __overlayTestApi: { flashMarker(x: number, y: number): void } }).__overlayTestApi;
    api.flashMarker(0, 0); // 不得抛错
    api.flashMarker(Number.NaN, Number.NaN);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("installs a ZCode official plugin layout (deep manifest, skills, inline mcpServers)", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-zcode-plugin-"));
  const archivePath = path.join(workspace, "zcode-plugin.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  const root = "computer-use/0.6.5/";
  archive.addFile(`${root}.zcode-plugin/plugin.json`, Buffer.from(JSON.stringify({
    name: "computer-use",
    version: "0.6.5",
    description: "Computer Use: automate desktop apps.",
    author: { name: "Z.ai" },
    license: "Apache-2.0",
    skills: "skills"
  })));
  archive.addFile(`${root}skills/computer-use/SKILL.md`, Buffer.from("---\nname: computer-use\ndescription: Use when a task needs a native desktop app's own UI.\n---\n# Computer Use\nBootstrap every call.\n"));
  archive.writeZip(archivePath);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    const status = await manager.install(archivePath);
    assert.equal(status.id, "computer-use");
    assert.equal(status.format, "zcode");
    assert.equal(status.version, "0.6.5");
    assert.deepEqual(manager.getSkills().map((skill) => skill.name), ["computer-use/computer-use"]);
    assert.deepEqual(manager.getMcpServers(), []);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("ZCode inline mcpServers expand variables and rewrite cache paths", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-zcode-mcp-"));
  const archivePath = path.join(workspace, "zcode-mcp.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  const root = "documents/0.2.1/";
  archive.addFile(`${root}.zcode-plugin/plugin.json`, Buffer.from(JSON.stringify({
    name: "documents",
    version: "0.2.1",
    description: "DOCX skills and viewer",
    skills: "skills",
    mcpServers: {
      documents: {
        type: "stdio",
        command: "C:\\Users\\Admin\\AppData\\Local\\Programs\\ZCode\\ZCode.exe",
        args: [
          "C:\\Users\\Admin\\AppData\\Local\\Programs\\ZCode\\resources\\glm\\zcode.cjs",
          "__zcode-plugin-host",
          "C:\\Users\\Admin\\.zcode\\cli\\plugins\\cache\\zcode-plugins-official\\documents\\0.2.1/dist/server.mjs"
        ],
        cwd: "${ZCODE_PROJECT_DIR}",
        env: { ZCODE_PLUGIN_DATA: "${ZCODE_PLUGIN_DATA}", ZCODE_WORKSPACE_ROOT: "${ZCODE_PROJECT_DIR}", ZCODE_JDK: "${user_config.jdk_major}" },
        isolation: "workspace"
      }
    }
  })));
  archive.addFile(`${root}skills/docx/SKILL.md`, Buffer.from("---\nname: docx\ndescription: DOCX production skills.\n---\n# DOCX\n"));
  archive.writeZip(archivePath);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    const status = await manager.install(archivePath);
    assert.equal(status.format, "zcode");
    const servers = manager.getMcpServers();
    assert.equal(servers.length, 1);
    const server = servers[0];
    assert.equal(server.name, "documents");
    assert.equal(server.type, "stdio");
    /* 缓存路径重写：末段 dist/server.mjs 指向本机解包根 */
    const last = server.args![2];
    assert.ok(last.startsWith(server.root), `rewritten arg should point into plugin root: ${last}`);
    assert.ok(last.endsWith(path.join("dist", "server.mjs")), `rewritten arg should keep relative tail: ${last}`);
    assert.ok(!last.includes("zcode-plugins-official"), "cache marker must be gone");
    /* cwd 展开 + env 值展开（user_config 置空） */
    assert.equal(server.cwd, server.dataRoot);
    assert.equal(server.env!.ZCODE_PLUGIN_DATA, server.dataRoot);
    assert.equal(server.env!.ZCODE_WORKSPACE_ROOT, server.dataRoot);
    assert.equal(server.env!.ZCODE_JDK, "");
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("a marketplace collection zip is rejected with a friendly message", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "secagent-zcode-market-"));
  const archivePath = path.join(workspace, "marketplace.zip");
  const archive = new AdmZip() as unknown as { addFile(name: string, data: Buffer): void; writeZip(file: string): void };
  for (const [name, version] of [["computer-use", "0.6.5"], ["browser-use", "0.5.1"]] as const) {
    archive.addFile(`${name}/${version}/.zcode-plugin/plugin.json`, Buffer.from(JSON.stringify({ name, version, skills: "skills" })));
    archive.addFile(`${name}/${version}/skills/x/SKILL.md`, Buffer.from("---\nname: x\ndescription: x.\n---\n"));
  }
  archive.writeZip(archivePath);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    await assert.rejects(() => manager.install(archivePath), /插件合集（marketplace 结构，含 2 个插件）/);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// ---- agentActivity（「Agent 正在操作电脑」常驻徽标，2026-10-26，对齐 ZCode）----

test("agentActivity: 转发 badgeHandler（active 归一/label 校验/无 handler 静默）", async () => {
  const { workspace, archivePath } = overlayTestZip([]);
  const calls: { active: boolean; label?: string }[] = [];
  const manager = new PluginManager(workspace, undefined, undefined, undefined, undefined, (input) => {
    calls.push({ ...input });
  });
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const api = (globalThis as unknown as { __overlayTestApi: { agentActivity(input: { active: boolean; label?: string }): void } }).__overlayTestApi;
    api.agentActivity({ active: true, label: "computer-use" });
    api.agentActivity({ active: 1 as unknown as boolean }); // truthy 但非 boolean → 归一 false（立即隐藏）
    api.agentActivity({ active: true, label: 123 as unknown as string }); // 非法 label → undefined
    api.agentActivity(null as unknown as { active: boolean }); // null 静默
    api.agentActivity({ active: false }); // 显式结束
    assert.deepEqual(calls, [
      { active: true, label: "computer-use" },
      { active: false, label: undefined },
      { active: true, label: undefined },
      { active: false, label: undefined }
    ]);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("agentActivity: 无 badgeHandler（纯服务端环境）静默不抛", async () => {
  const { workspace, archivePath } = overlayTestZip([]);
  const manager = new PluginManager(workspace);
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const api = (globalThis as unknown as { __overlayTestApi: { agentActivity(input: { active: boolean }): void } }).__overlayTestApi;
    api.agentActivity({ active: true });
    assert.ok("无 handler 时静默");
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("flashMarker: chord kind 与 label/direction 原样透传（宿主五形态）", async () => {
  const { workspace, archivePath } = overlayTestZip([]);
  const calls: unknown[][] = [];
  const manager = new PluginManager(workspace, undefined, undefined, undefined, (x, y, opts) => {
    calls.push([x, y, opts]);
  });
  try {
    await manager.initialize();
    await manager.install(archivePath);
    const api = (globalThis as unknown as { __overlayTestApi: { flashMarker(x: number, y: number, opts?: { kind?: string; label?: string; direction?: number }): void } }).__overlayTestApi;
    api.flashMarker(80, 90, { kind: "chord", label: "Ctrl+C" });
    api.flashMarker(80, 90, { kind: "scroll", direction: -1 });
    assert.deepEqual(calls[0], [80, 90, { kind: "chord", label: "Ctrl+C" }]);
    assert.deepEqual(calls[1], [80, 90, { kind: "scroll", direction: -1 }]);
  } finally {
    await manager.shutdown();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
