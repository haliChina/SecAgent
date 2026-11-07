# Isolated renderer checks

These fixtures exercise the production renderer without Electron, real IPC, models, tools, speech or plugin services. All state is in memory. Unlisted bridge actions and network APIs are denied; WebGL is deliberately disabled. Do not use this fixture as an application entry point.

## Build and preview

Run `npm run build` in the repository, then:

`python3 scripts/ui-smoke/preview.py --port 8794`

The server binds only to `127.0.0.1`. Open one of:

- `http://127.0.0.1:8794/index.html?theme=dark`
- `http://127.0.0.1:8794/index.html?theme=light&scenario=initialization-error`
- `http://127.0.0.1:8794/index.html?theme=dark&scenario=messages`
- `http://127.0.0.1:8794/index.html?settings=1&theme=light&scenario=panels`

Use a fresh page for each run. To run checks with browser automation, append a same-origin script element pointing to `/native-checks.js` or `/integration-checks.js`, then read the resulting `window.__uiChecks` / `window.__integrationChecks` promise. No external libraries are needed. The integration checks send only in-memory fixture messages; they never call a model.

`native-checks.js`: session search, menu focus/Escape, IME rename, visible errors, countdown target isolation, Tab command safety, modal focus and global shortcut isolation, filtered rename focus, initialization retry, settings navigation.

`integration-checks.js`: empty prompts, Ctrl+K, custom command insertion, context chip, both send-shortcut modes, plugin-panel status, failure/success feedback and confirmation cancellation.

For accessibility checks, optionally pass `--axe /absolute/path/to/axe.min.js`; it is then served at `/axe.js`. The default preview has no axe dependency. The server preserves the production bundle and injects the fake bridge only into served HTML.

## Optional desktop Playwright smoke

`node scripts/ui-smoke/smoke.mjs --tools /path/to/folder-containing-playwright-core --chromium /path/to/chromium --out /absolute/path/outside/repo`

This runner checks the basic chat/settings/theme matrix, saves screenshots and resource measurements, and closes its server/browser. It requires an already installed `playwright-core`; it does not install anything. The additional regression scripts above are separate entry points.

## Limits

The Android PRoot Chromium launch was blocked in this environment, so verification used the app's actual Chromium WebView with the loopback preview instead. DOM assertions and axe results do not establish screen-reader conformance or Windows/macOS Electron behavior. OS tray placement, real audio, plugin installation, real backend execution and 3D rendering remain separate desktop acceptance tests. CSP may block an existing embedded data font in the production page; the preview does not relax the production CSP. No network/real-service failures should be silently treated as passes.
