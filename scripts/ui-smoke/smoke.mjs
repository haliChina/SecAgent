#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, lstat, realpath, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const { values } = parseArgs({ options: {
  renderer: { type: 'string' }, out: { type: 'string' }, tools: { type: 'string' },
  chromium: { type: 'string' }, help: { type: 'boolean' }
} });
if (values.help) {
  console.log(`Usage: node scripts/ui-smoke/smoke.mjs [--renderer out/renderer] [--out /absolute/evidence/run] [--tools /var/minis/workspace/secagent-ui-tools] [--chromium /usr/bin/chromium]
Requires external playwright-core >=1.48. Never builds, starts Electron, sends a message or edits application files.
Output must be outside the repo and new/empty. Tests chat/settings x light/dark x 1280x800/900x600.
WebGL/GPU, media, IPC, workers, API requests and external network are always disabled.`);
  process.exit(0);
}
const renderer = await realpath(resolve(values.renderer || join(repo, 'out/renderer')));
const out = resolve(values.out || join(repo, '../secagent-ui-evidence', `run-${Date.now()}`));
assert(!relative(repo, out).startsWith(`..${sep}`) ? false : true, 'Evidence must be outside the repo');
await mkdir(out, { recursive: true });
assert.equal((await readdir(out)).length, 0, 'Evidence directory must be empty (preserve previous runs)');
const tools = resolve(values.tools || '/var/minis/workspace/secagent-ui-tools');
const require = createRequire(join(tools, 'package.json'));
const { chromium } = require('playwright-core');
const pwVersion = require('playwright-core/package.json').version;
const mock = await readFile(join(here, 'bridge-mock.js'), 'utf8');
const sha = data => createHash('sha256').update(data).digest('hex');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const files = new Map(), manifest = [];
async function snapshot(directory) {
  for (const name of (await readdir(directory)).sort()) {
    const file = join(directory, name), before = await lstat(file);
    assert(!before.isSymbolicLink(), `No symlinks in renderer: ${file}`);
    if (before.isDirectory()) { await snapshot(file); continue; }
    if (!mime[extname(file)]) continue;
    const body = await readFile(file), after = await lstat(file);
    assert(before.size === after.size && before.mtimeMs === after.mtimeMs, 'Build changed while snapshotting; rerun after build finishes');
    const path = '/' + relative(renderer, file).split(sep).join('/');
    files.set(path, { body, type: mime[extname(file)] });
    manifest.push({ path, bytes: body.length, sha256: sha(body) });
  }
}
await snapshot(renderer);
const html = files.get('/index.html')?.body.toString() || '';
assert(/type="module"/.test(html) && /\.\/assets\/[^" ]+\.js/.test(html) && !/@vite\/client|\/src\/main/.test(html), 'Expected an existing production renderer build');
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const report = {
  startedAt: new Date().toISOString(), renderer, out, playwright: pwVersion,
  buildSha256: sha(JSON.stringify(manifest)), manifest,
  isolation: { realIPC: false, telemetry: false, externalNetwork: false, agentExecution: false, speech: false, webgl: false, gpu: false, reducedMotion: true, platformMock: 'linux', csp, networkPolicy: 'Only exact loopback static files; all API requests denied; service workers blocked; dead external proxy', initialJsDefinition: 'Response body bytes for script/JS requests started before UI-ready + networkidle + fonts-ready, before any interactions; HTTP headers/compression excluded. Includes classic boot scripts; no source-module inference.' },
  serverRequests: [], cases: [], cleanup: {}, errors: []
};
let origin, browser;
const home = await mkdtemp(join(tmpdir(), 'secagent-ui-smoke-'));
function allowed(url, method) {
  if (!['GET', 'HEAD'].includes(method)) return null;
  const parsed = new URL(url, origin);
  if (parsed.origin !== origin) return null;
  const path = decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname);
  if (parsed.search && !(path === '/index.html' && parsed.search === '?settings=1')) return null;
  return files.has(path) ? path : null;
}
const server = createServer((req, res) => {
  let path;
  try { path = req.headers.host === new URL(origin).host ? allowed(req.url, req.method) : null; } catch { path = null; }
  const entry = files.get(path);
  report.serverRequests.push({ method: req.method, path: req.url, status: entry ? 200 : 403, bytes: entry?.body.length || 0 });
  res.writeHead(entry ? 200 : 403, {
    'Content-Type': entry?.type || 'text/plain', 'Cache-Control': 'no-store',
    'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'microphone=(), camera=(), display-capture=(), geolocation=(), usb=(), serial=()',
    ...(entry ? { 'Content-Length': entry.body.length } : {})
  });
  res.end(req.method === 'HEAD' ? undefined : entry?.body || 'Blocked by UI smoke static allowlist');
});
const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-webgl', '--disable-3d-apis', '--mute-audio', '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--disable-extensions', '--disable-quic', '--dns-prefetch-disable', '--no-first-run', '--no-default-browser-check', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1'];
report.isolation.chromiumArgs = args;
const viewports = [{ width: 1280, height: 800 }, { width: 900, height: 600 }];
const navItems = [['settings-account', '账户与通用'], ['settings-wake', '随时唤醒'], ['settings-sessions', '已归档会话'], ['settings-system', '系统'], ['settings-updates', '更新'], ['settings-telemetry', '诊断与隐私'], ['settings-tts', '朗读'], ['settings-asr', '语音识别'], ['settings-models', '模型'], ['settings-websearch', '联网搜索'], ['settings-mcp', 'MCP 服务'], ['settings-plugins', '插件']];
const visible = locator => locator.waitFor({ state: 'visible', timeout: 15000 });
const hidden = locator => locator.waitFor({ state: 'hidden', timeout: 10000 });
async function themeIs(page, theme) {
  await page.waitForFunction(theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light') === theme, theme);
}
async function runCase(route, theme, viewport) {
  const result = { id: `${route}-${viewport.width}x${viewport.height}-${theme}`, route, theme, viewport, assertions: [], console: [], pageerror: [], requests: [], blocked: [], failures: [] };
  report.cases.push(result);
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', locale: 'zh-CN', timezoneId: 'UTC', serviceWorkers: 'block', permissions: [], acceptDownloads: false });
  let page, initial = true;
  const pending = [], initialRequests = new WeakSet();
  async function check(name, fn) {
    try { await fn(); result.assertions.push({ name, pass: true }); }
    catch (error) { result.assertions.push({ name, pass: false, error: String(error) }); result.failures.push(name); }
  }
  try {
    await context.route('**/*', async route => {
      const request = route.request();
      let permit = false;
      try { permit = !!allowed(request.url(), request.method()) && !['media', 'websocket', 'eventsource'].includes(request.resourceType()); } catch { /* deny */ }
      if (permit) await route.continue();
      else { result.blocked.push({ url: request.url(), method: request.method(), type: request.resourceType() }); await route.abort('blockedbyclient'); }
    });
    await context.routeWebSocket('**/*', socket => { result.blocked.push({ url: socket.url(), type: 'websocket' }); socket.close(); });
    // One combined init script guarantees configuration precedes mock installation.
    await context.addInitScript({ content: `window.__UI_SMOKE_OPTIONS = ${JSON.stringify({ origin, theme })};\n${mock}` });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('console', message => result.console.push({ type: message.type(), text: message.text(), location: message.location() }));
    page.on('pageerror', error => result.pageerror.push({ message: error.message, stack: error.stack }));
    page.on('crash', () => result.failures.push('renderer-crash'));
    page.on('dialog', async dialog => { result.blocked.push({ type: 'dialog', message: dialog.message() }); await dialog.dismiss(); });
    page.on('popup', async popup => { result.blocked.push({ type: 'popup' }); await popup.close(); });
    page.on('download', download => { result.blocked.push({ type: 'download' }); void download.cancel(); });
    page.on('request', request => { if (initial) initialRequests.add(request); });
    page.on('requestfailed', request => result.requests.push({ url: request.url(), type: request.resourceType(), initial: initialRequests.has(request), failure: request.failure()?.errorText }));
    page.on('response', response => {
      const request = response.request();
      const entry = { url: response.url(), type: request.resourceType(), initial: initialRequests.has(request), status: response.status() };
      result.requests.push(entry);
      if (request.resourceType() === 'script' || /\.m?js(?:\?|$)/.test(response.url())) {
        pending.push((async () => {
          try {
            entry.jsBytes = (await response.body()).length;
            entry.networkSizes = await request.sizes();
          } catch (error) { entry.measurementError = String(error); }
        })());
      }
    });
    await page.goto(`${origin}/index.html${route === 'settings' ? '?settings=1' : ''}`, { waitUntil: 'networkidle', timeout: 60000 });
    await visible(page.locator(route === 'chat' ? '.session-sidebar .sidebar-item.active' : '#settings-account.settings-section-active'));
    await visible(route === 'chat' ? page.getByRole('textbox').first() : page.getByRole('navigation', { name: '设置导航' }));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState('networkidle');
    await themeIs(page, theme);
    result.readyAtMs = await page.evaluate(() => performance.now());
    initial = false;
    await Promise.all(pending);
    result.initialJs = result.requests.filter(item => item.initial && item.jsBytes !== undefined).map(item => ({ path: new URL(item.url).pathname, bytes: item.jsBytes, status: item.status, resourceType: item.type }));
    result.initialJsBytes = result.initialJs.reduce((sum, item) => sum + item.bytes, 0);
    result.initialResourceTiming = await page.evaluate(() => performance.getEntriesByType('resource').filter(item => /\.m?js(?:\?|$)/.test(item.name)).map(item => ({ name: item.name, initiatorType: item.initiatorType, startTime: item.startTime, duration: item.duration, transferSize: item.transferSize, encodedBodySize: item.encodedBodySize, decodedBodySize: item.decodedBodySize })));
    result.initialModules = result.initialJs.filter(item => item.path.startsWith('/assets/')).map(item => item.path);
    result.uiInventory = await page.getByRole('button').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({ name: node.getAttribute('aria-label') || node.textContent.trim(), expanded: node.getAttribute('aria-expanded') })));
    result.screenshot = `${result.id}.png`;
    await page.screenshot({ path: join(out, result.screenshot), fullPage: false, animations: 'disabled', timeout: 30000 });
    result.assertions.push({ name: 'production-route-initialized-and-screenshot', pass: true });
    await check('initial-theme', () => themeIs(page, theme));
    if (route === 'chat') {
      await check('sidebar-collapse-expand', async () => {
        const before = await page.locator('.session-sidebar').boundingBox();
        await page.getByRole('button', { name: '收窄会话侧栏', exact: true }).click();
        await visible(page.getByRole('button', { name: '展开会话侧栏', exact: true }));
        assert.equal(await page.evaluate(() => localStorage.getItem('secagent.sidebar.collapsed')), '1');
        const after = await page.locator('.session-sidebar').boundingBox();
        assert(after.width < before.width, 'Sidebar must become narrower');
        await page.getByRole('button', { name: '展开会话侧栏', exact: true }).click();
        await visible(page.getByRole('button', { name: '收窄会话侧栏', exact: true }));
      });
      await check('session-menu-open-close-escape', async () => {
        const trigger = page.getByRole('button', { name: '更多操作（会话 隔离冒烟会话）', exact: true });
        const menu = page.locator('.sidebar-menu[aria-label="会话操作"]');
        await trigger.click(); await visible(menu); assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        await trigger.click(); await hidden(menu);
        await trigger.click(); await visible(menu); await page.keyboard.press('Escape'); await hidden(menu);
      });
      await check('theme-settings-event', async () => {
        const opposite = theme === 'dark' ? 'light' : 'dark';
        for (const next of [opposite, theme]) {
          await page.evaluate(async theme => { const settings = await window.secagent.getSettings(); await window.secagent.saveSettings({ ...settings, theme }); }, next);
          await themeIs(page, next);
        }
      });
      await check('settings-button-intent-no-ipc', async () => {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        assert(await page.evaluate(() => window.__uiSmoke.snapshot().calls.includes('openSettings:settings-account')));
      });
    } else {
      await check('settings-menu-open-close', async () => {
        const trigger = page.getByRole('button', { name: '更多设置操作' });
        await trigger.click(); await visible(page.getByRole('menu')); assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        await trigger.click(); await hidden(page.getByRole('menu'));
      });
      await check('settings-theme-control-and-mock-autosave', async () => {
        const toggle = page.getByRole('checkbox', { name: '深色模式', exact: true });
        for (const next of [theme === 'dark' ? 'light' : 'dark', theme]) {
          await toggle.setChecked(next === 'dark'); await themeIs(page, next);
          await page.waitForFunction(theme => window.__uiSmoke.snapshot().settings.theme === theme, next);
        }
      });
      for (const [id, label] of navItems) await check(`navigation:${id}`, async () => {
        await page.getByRole('navigation', { name: '设置导航' }).getByRole('button', { name: label, exact: true }).click();
        await visible(page.locator(`#${id}.settings-section-active`));
        assert.equal(new URL(page.url()).hash, `#${id}`);
        if (id === 'settings-telemetry') assert.equal(await page.locator('#settings-telemetry input[type=checkbox]').isChecked(), false);
        if (id === 'settings-sessions') await visible(page.getByText('隔离归档示例', { exact: true }));
      });
    }
    await page.waitForLoadState('networkidle');
    await Promise.all(pending);
    result.bridge = await page.evaluate(() => window.__uiSmoke.snapshot());
    await check('isolation-remains-disabled', async () => {
      assert.equal(result.bridge.settings.telemetry.enabled, false);
      assert.equal(result.bridge.settings.wake.voiceEnabled, false);
      assert.equal(result.bridge.settings.providers.length, 0);
      assert.equal(result.bridge.denied.length, 0, JSON.stringify(result.bridge.denied));
      assert.equal(result.blocked.length, 0, JSON.stringify(result.blocked));
      assert(await page.evaluate(() => !window.electron && !window.require && !window.process && !window.ipcRenderer));
    });
    await check('no-pageerror-or-console-error', async () => {
      assert.equal(result.pageerror.length, 0, JSON.stringify(result.pageerror));
      assert.equal(result.console.filter(message => message.type === 'error').length, 0, JSON.stringify(result.console));
    });
    await check('all-static-requests-and-byte-measurements-succeeded', async () => {
      assert(result.initialJsBytes > 0);
      assert.equal(result.requests.filter(item => item.failure || item.status >= 400 || item.measurementError).length, 0);
    });
  } catch (error) {
    result.failures.push(String(error));
    if (page && !page.isClosed()) {
      result.bridge = await page.evaluate(() => window.__uiSmoke?.snapshot()).catch(() => null);
      await page.screenshot({ path: join(out, `${result.id}-failed.png`), animations: 'disabled', timeout: 10000 }).catch(() => {});
    }
  } finally {
    await context.close();
    result.pass = result.failures.length === 0;
    await writeFile(join(out, `${result.id}.json`), JSON.stringify(result, null, 2) + '\n');
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}: ${result.initialJsBytes ?? '?'} initial JS bytes; ${result.pageerror.length} page errors; ${result.failures.join('; ')}`);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  report.errors.push(`Interrupted: ${signal}`);
  void browser?.close();
});
try {
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  origin = `http://127.0.0.1:${server.address().port}`;
  report.server = origin;
  browser = await chromium.launch({ executablePath: values.chromium || '/usr/bin/chromium', headless: true, args, env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: home, TMPDIR: home, LANG: 'C.UTF-8' }, timeout: 60000 });
  report.chromium = browser.version();
  for (const route of ['chat', 'settings']) for (const viewport of viewports) for (const theme of ['light', 'dark']) await runCase(route, theme, viewport);
} catch (error) {
  report.errors.push(error.stack || String(error));
} finally {
  report.cleanup.browserLaunchSucceeded = Boolean(browser);
  try { if (browser) await browser.close(); report.cleanup.browserClosed = browser ? true : null; } catch (error) { report.errors.push(String(error)); }
  await new Promise(ok => { server.close(ok); server.closeAllConnections(); });
  report.cleanup.serverClosed = !server.listening;
  await rm(home, { recursive: true, force: true });
  report.cleanup.temporaryHomeRemoved = true;
  report.finishedAt = new Date().toISOString();
  report.pass = !report.errors.length && report.cases.length === 8 && report.cases.every(item => item.pass);
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = ['# Isolated UI smoke', '', `Result: ${report.pass ? 'PASS' : 'FAIL'}`, `Chromium: ${report.chromium || 'launch failed'}; Playwright: ${pwVersion}`, `Build SHA-256: ${report.buildSha256}`, '', 'WebGL/GPU disabled; 2D canvas native; reduced-motion enabled. Fake Linux bridge, no real IPC/media/model/tool execution. No production bundle or HTML rewrites.', '', '| Case | Result | Initial JS bytes | Initial assets/chunks |', '|---|---|---:|---|', ...report.cases.map(item => `| ${item.id} | ${item.pass ? 'PASS' : 'FAIL'} | ${item.initialJsBytes ?? 'n/a'} | ${(item.initialModules || []).join(', ')} |`), '', 'Initial JS = uncompressed response-body bytes, including boot scripts, measured before interaction. Not gzip size, CWV, or original TS-module attribution. Console, page errors, all requests, bridge audit and per-case assertions are in JSON.', '', `Cleanup: ${JSON.stringify(report.cleanup)}`, '', 'Not covered: Electron/window IPC, real settings persistence or cross-window synchronization, voice/wake/microphone/TTS, real models/agents/tools, authentication, plugins/market/update execution, sending chat, attachments, complex conversation/markdown, 3D appearance, pixel-diff/a11y completeness, Windows/macOS chrome, OS egress sandboxing.', '', ...report.errors];
  await writeFile(join(out, 'summary.md'), lines.join('\n') + '\n');
  console.log(`Report: ${join(out, 'report.json')}`);
  if (!report.pass) process.exitCode = 1;
}
