/* Test-only: injected by smoke.mjs before production scripts, never shipped. */
(() => {
  'use strict';
  const options = window.__UI_SMOKE_OPTIONS;
  if (!options || location.origin !== options.origin || location.hostname !== '127.0.0.1') {
    throw new Error('UI smoke mock requires the isolated loopback runner');
  }
  if (window.secagent || window.electron || window.require || window.process) {
    throw new Error('Refusing to replace a real Electron/Node bridge');
  }
  const copy = value => structuredClone(value);
  const calls = [], denied = [], listeners = new Map();
  const record = name => calls.push(name);
  const block = name => function () {
    denied.push(name);
    throw new Error(`UI_SMOKE_FORBIDDEN: ${name}`);
  };
  const lock = (target, key, value) => Object.defineProperty(target, key, {
    value, writable: false, configurable: false
  });
  const subscribe = name => callback => {
    record(name);
    if (typeof callback !== 'function') throw new TypeError(`${name}: callback required`);
    const set = listeners.get(name) || new Set();
    listeners.set(name, set); set.add(callback);
    return () => set.delete(callback);
  };
  const emitSettings = () => {
    for (const callback of listeners.get('onSettingsChanged') || []) callback(copy(settings));
  };
  const date = '2026-10-01T12:00:00.000Z';
  const sessions = [
    { meta: { id: 'smoke-empty', title: '隔离冒烟会话', createdAt: date, updatedAt: date }, messages: options.scenario === 'messages' ? [
      { id: 'fixture-user', role: 'user', content: '请整理本周课堂计划。', createdAt: date, attachments: [{ id: 'fixture-image', name: '课堂示意图', mimeType: 'image/svg+xml', size: 100, dataUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#1d4ed8"/><text x="40" y="130" fill="white" font-size="36">UI preview fixture</text></svg>') }] },
      { id: 'fixture-assistant', role: 'assistant', content: '## 本周课堂计划\n\n这是仅用于界面验证的本地假数据，不会执行任何工具。\n\n```mathdiagram\n<CylinderVolumeProof radius="2" height="5" showCorrespondence="true" />\n```\n\n```mafs\n{"viewBox":{"x":[-2,2],"y":[-1,2],"padding":8},"plots":[{"type":"circle","x":0,"y":0,"radius":1}]}\n```\n\n```mermaid\ngraph LR\n A[阅读] -->|已完成| B[讨论]\n```', createdAt: date },
      { id: 'fixture-composer-pending', role: 'user', content: '', createdAt: date, attachments: [{ id: 'fixture-pending-image', name: '隔离测试图片', mimeType: 'image/png', size: 100, dataUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#16a34a"/></svg>') }] }
    ] : [] },
    { meta: { id: 'smoke-second', title: '课堂计划 React', preview: '阅读与键盘焦点', createdAt: date, updatedAt: date }, messages: [] },
    { meta: { id: 'smoke-archive', title: '隔离归档示例', createdAt: date, updatedAt: date, archived: true }, messages: [] }
  ];
  const models = [{ id: 'smoke-display-only', name: '隔离展示模型（不可运行）', model: 'smoke-display-only', provider: 'fixture', providerLabel: '纯本地假数据' }];
  let settings = {
    providers: [], models: [], defaultModelId: 'smoke-display-only', defaultReasoningEffort: 'high',
    theme: options.theme === 'dark' ? 'dark' : 'light', customModelMode: false,
    sendShortcut: 'enter', responseTips: false, commands: [{ name: 'fixture', prompt: '本地自定义命令内容', description: '仅测试' }], rules: { enabled: false, text: '' }, archive: { auto: false, retentionDays: 7 },
    telemetry: { enabled: false }, wake: { hotkey: 'Ctrl+Alt+A', voiceEnabled: false, voicePhrase: '隔离测试' },
    speech: { provider: 'local', betterRecognition: false, chain: [], audio: { input: 'auto', output: 'auto' }, noise: { profile: 'standard', hotwords: [] } },
    tts: { provider: 'windows', chain: ['windows'], voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%' },
    updates: { channel: 'stable', autoCheck: false, autoDownload: false, autoInstallOnQuit: false },
    mcp: { servers: {} }, autostart: false, autostartHidden: false,
    resilience: { autoRetry: false, fallbackEnabled: false, fallbackModelIds: [], rememberFailures: false, cooldownBaseMinutes: 5, quotaCooldownMinutes: 60 },
    guard: { enabled: true, approved: [] }, budget: { maxToolTurns: 1, keepRecentImages: 0 },
    hallucinationEnabled: false, webSearch: { bigmodelKeyConfigured: false, deepseekKeyConfigured: false }
  };
  const failures = new Set(options.scenario === 'initialization-error' ? ['listSessions'] : []);
  const read = (name, fn) => async (...args) => {
    record(name);
    if (failures.delete(name)) throw new Error('隔离测试失败：' + name);
    return copy(fn(...args));
  };
  const api = {
    platform: 'linux', telemetryConfig: Object.freeze({ enabled: false, sentryDsn: '' }),
    getSettings: read('getSettings', () => settings),
    listSessions: read('listSessions', () => sessions.map(session => session.meta)),
    getSession: read('getSession', id => {
      const session = sessions.find(item => item.meta.id === id);
      if (!session) throw new Error('Unknown fixture session');
      return session;
    }),
    createSession: read('createSession', () => { const session = { meta: { id: `smoke-created-${sessions.length}`, title: '新会话', createdAt: date, updatedAt: date }, messages: [] }; sessions.unshift(session); return session; }),
    renameSession: read('renameSession', (id, title) => { const session = sessions.find(item => item.meta.id === id); session.meta.title = title; return session; }),
    archiveSession: read('archiveSession', (id, archived) => { const session = sessions.find(item => item.meta.id === id); session.meta.archived = archived; return session; }),
    deleteSession: read('deleteSession', id => { const index = sessions.findIndex(item => item.meta.id === id); if (index >= 0) sessions.splice(index, 1); return sessions.map(item => item.meta); }),
    listModels: read('listModels', () => models),
    listProviders: read('listProviders', () => []),
    listPlugins: read('listPlugins', () => options.scenario === 'panels' ? [{ id: 'fixture', name: '本地测试插件', version: '0.0.0', enabled: true, state: 'ready', settingsPages: [{ id: 'service', title: '隔离服务面板' }] }] : []),
    callPluginSettings: read('callPluginSettings', (pluginId, pageId, action) => {
      if (pluginId !== 'fixture' || pageId !== 'service') return block('unknown-plugin')();
      record('panel:' + action);
      if (action === 'describe') return { panels: [{ id: 'local', title: '本地服务', statusAction: 'status', pollMs: 1000 }] };
      if (action === 'status') return { phase: 'ready', progress: 75, message: '仅内存状态，未启动服务', facts: [{ label: '环境', value: '隔离夹具' }], actions: [{ id: 'fail', label: '模拟操作失败' }, { id: 'start', label: '模拟启动成功' }, { id: 'danger', label: '模拟危险操作', danger: true, confirm: '仅修改内存测试状态，是否继续？' }] };
      if (action === 'fail') return { ok: false, error: '夹具：启动失败' };
      if (action === 'start') return { ok: true, note: '夹具：已启动' };
      if (action === 'danger') return { ok: true, note: '夹具：已确认' };
      return block('unknown-plugin-action')();
    }),
    // Pure in-memory send; never reaches a model, network, tool or filesystem.
    sendMessage: read('sendMessage', (id, text) => {
      const session = sessions.find(item => item.meta.id === id);
      session.messages.push({ id: 'sent-' + calls.length, role: 'user', content: text, createdAt: date });
      session.messages.push({ id: 'reply-' + calls.length, role: 'assistant', content: '本地夹具回复', createdAt: date });
      return session;
    }),
    listMarketplace: read('listMarketplace', () => []),
    listSkills: read('listSkills', () => []),
    getRuntimeEvents: read('getRuntimeEvents', () => []),
    officialStatus: read('officialStatus', () => ({ loggedIn: false, email: '' })),
    getUpdateState: read('getUpdateState', () => ({ currentVersion: '0.0.0-smoke', channel: 'stable', status: 'unsupported', downloadedBytes: 0, supportReason: 'Isolated UI fixture' })),
    // These two calls are UI effects only; no Electron IPC or wake execution exists.
    syncWindowChrome: read('syncWindowChrome', () => ({ ok: false })),
    setWakeContext: () => record('setWakeContext:discarded'),
    saveSettings: async payload => {
      record('saveSettings');
      const next = copy(payload), before = copy(settings);
      delete next.theme; delete before.theme;
      if (!['light', 'dark', 'system'].includes(payload.theme) || JSON.stringify(next) !== JSON.stringify(before)) {
        return block('saveSettings:only-theme-allowed')();
      }
      settings = { ...settings, theme: payload.theme }; emitSettings(); return copy(settings);
    },
    // Records intent only. The runner tests the settings route independently.
    openSettings: async (page = 'settings-account') => {
      if (!/^settings-[a-z]+$/.test(page)) return block('openSettings:invalid-page')();
      record(`openSettings:${page}`); return { ok: true };
    }
  };
  for (const name of ['onSettingsChanged', 'onSettingsNavigate', 'onSpeechEvent', 'onRuntimeEvent', 'onToolConfirmation', 'onPluginsChanged', 'onUpdateState']) api[name] = subscribe(name);
  // Fail closed: every unlisted action, including all speech/model/tool/plugin
  // execution, authentication, updates and filesystem calls, throws synchronously.
  const bridge = new Proxy(Object.freeze(api), {
    get(target, key) {
      if (Reflect.has(target, key)) return Reflect.get(target, key);
      if (key === 'then' || typeof key === 'symbol') return undefined;
      return block(`secagent.${key}`);
    }
  });
  lock(window, 'secagent', bridge);
  for (const name of ['electron', 'ipcRenderer', 'require', 'process']) lock(window, name, undefined);
  lock(window, '__uiSmoke', Object.freeze({ setShortcut: value => { if (!['enter','modEnter'].includes(value)) throw new Error('Invalid shortcut'); settings.sendShortcut = value; emitSettings(); }, failNext: name => { if (!['listSessions', 'getSession', 'renameSession', 'archiveSession', 'deleteSession'].includes(name)) throw new Error('Unsupported failure injection'); failures.add(name); }, snapshot: () => ({
    calls: [...calls], denied: [...denied], settings: copy(settings), sessions: copy(sessions),
    listeners: Object.fromEntries([...listeners].map(([name, set]) => [name, set.size])),
    policy: 'deny-by-default; in-memory sessions and theme only; no real bridge'
  }) }));
  localStorage.setItem('secagent-theme', settings.theme);
  localStorage.setItem('secagent.sidebar.collapsed', '0');
  // No API requests at all; browser-native ESM/CSS/font loads use the runner's
  // exact static-file allowlist. CSP and Playwright routing are separate layers.
  for (const name of ['fetch', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'Worker', 'SharedWorker', 'Audio', 'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'SpeechRecognition', 'webkitSpeechRecognition', 'open']) lock(window, name, block(`browser.${name}`));
  lock(XMLHttpRequest.prototype, 'open', block('browser.XMLHttpRequest'));
  lock(navigator, 'sendBeacon', block('browser.sendBeacon'));
  if (navigator.mediaDevices) {
    lock(navigator.mediaDevices, 'enumerateDevices', async () => { record('media.enumerateDevices:empty'); return []; });
    for (const name of ['getUserMedia', 'getDisplayMedia']) lock(navigator.mediaDevices, name, block(`media.${name}`));
  }
  for (const name of ['getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia']) lock(navigator, name, block(`media.${name}`));
  if (window.speechSynthesis) lock(window.speechSynthesis, 'speak', block('media.speechSynthesis'));
  lock(HTMLMediaElement.prototype, 'play', block('media.play'));
  if (navigator.serviceWorker) lock(navigator.serviceWorker, 'register', block('browser.serviceWorker'));
  // Null WebGL contexts force application fallback; 2D canvas stays native.
  for (const prototype of [HTMLCanvasElement.prototype, window.OffscreenCanvas?.prototype].filter(Boolean)) {
    const original = prototype.getContext;
    lock(prototype, 'getContext', function (kind, ...args) {
      if (/webgl|experimental-webgl|webgpu/i.test(String(kind))) { record(`graphics.${kind}:disabled`); return null; }
      return original.call(this, kind, ...args);
    });
  }
  document.addEventListener('securitypolicyviolation', event => denied.push(`csp.${event.violatedDirective}:${event.blockedURI}`));
  document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); block('browser.form-submit')(); }, true);
})();
