/* Test-only: production DOM with bridge-mock.js; never invokes a real service. */
window.__round2Checks = (async () => {
  if (!window.__uiSmoke) throw new Error('Isolated bridge required');
  const results = [], measurements = [];
  const $ = selector => document.querySelector(selector);
  const pause = () => new Promise(resolve => setTimeout(resolve, 40));
  const wait = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await pause(); } throw new Error('UI did not settle'); };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const check = async (name, fn) => { try { await fn(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: String(error) }); } };
  const key = async (el, name) => { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); await pause(); };
  const press = async (scope, text) => { const button = [...document.querySelectorAll(scope)].find(x => x.textContent.trim() === text); assert(button, 'Button missing: ' + text); button.click(); await pause(); };
  const setInput = async (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); await pause(); };
  const rgb = value => (value.match(/[\d.]+/g) || []).map(Number).slice(0, 3);
  const lum = values => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const values = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); };
  const inspectButton = el => { const css = getComputedStyle(el); const result = { text: el.textContent.trim(), foreground: css.color, background: css.backgroundColor, contrast: ratio(css.color, css.backgroundColor) }; measurements.push(result); assert(result.contrast >= 4.5, JSON.stringify(result)); };
  await wait(() => $('.app-shell, .settings-section-active'));
  if ($('.settings-shell')) {
    await press('[aria-label="设置导航"] button', '插件');
    await wait(() => document.querySelectorAll('.plugin-list-item').length === 2);
    await check('category-arrow-home-end-and-panel-link', async () => {
      const installed = $('.plugin-category-tabs [aria-selected="true"]');
      await key(installed, 'ArrowRight');
      const selected = $('.plugin-category-tabs [aria-selected="true"]');
      assert(selected.textContent.includes('市场') && document.activeElement === selected, 'Category arrow did not select/focus market');
      assert(document.getElementById(selected.getAttribute('aria-controls'))?.getAttribute('aria-labelledby') === selected.id, 'Category panel link broken');
      assert(!$('.plugin-list[role="listbox"]') && $('.plugin-list-empty[role="status"]'), 'Empty market is an invalid listbox');
      await key(selected, 'Home');
    });
    await check('details-arrows-roving-tab-and-labelled-panel', async () => {
      const readme = $('.plugin-detail-tabs [aria-selected="true"]'); await key(readme, 'End');
      const selected = $('.plugin-detail-tabs [aria-selected="true"]');
      assert(selected.textContent === '权限与设置' && document.activeElement === selected, 'Details arrow navigation failed');
      assert(document.querySelectorAll('.plugin-detail-tabs [tabindex="0"]').length === 1, 'Multiple or zero tab stops');
      assert($('.plugin-detail-content').getAttribute('aria-labelledby') === selected.id, 'Details panel link broken');
      await key(selected, 'Home');
    });
    await check('plugin-list-arrows-and-invalid-error-tab-recovery', async () => {
      await key($('.plugin-list-item[aria-selected="true"]'), 'ArrowDown');
      await wait(() => $('.plugin-list-item[aria-selected="true"]')?.textContent.includes('错误状态示例'));
      await press('.plugin-detail-tabs button', '错误信息');
      await key($('.plugin-list-item[aria-selected="true"]'), 'ArrowUp');
      await wait(() => $('.plugin-detail-tabs [aria-selected="true"]')?.textContent === '概览');
      assert($('.plugin-detail-tabs [tabindex="0"]'), 'Switching away from error plugin stranded focus');
    });
    await check('filtered-empty-state-and-option-tab-stop', async () => {
      const input = $('.plugin-search input'); await setInput(input, 'no-matches-test');
      assert(!$('.plugin-list[role="listbox"]') && $('.plugin-list-empty').textContent.includes('没有找到'), 'Filtered empty state invalid');
      await setInput(input, '错误状态');
      assert(document.querySelectorAll('.plugin-list-item[tabindex="0"]').length === 1, 'Filtered option cannot be tabbed to');
      await setInput(input, '');
    });
    await check('primary-button-computed-contrast', () => inspectButton($('.plugin-detail-actions .primary-button')));
    await press('[aria-label="设置导航"] button', '隔离服务面板');
    await wait(() => $('.plugin-service-actions button'));
    await check('danger-button-independent-foreground', async () => {
      await press('.plugin-service-actions button', '模拟危险操作'); await wait(() => $('.set-danger-button'));
      inspectButton($('.set-danger-button'));
      await press('[role="dialog"] button', '取消');
      assert(!window.__uiSmoke.snapshot().calls.includes('panel:danger'), 'Test submitted dangerous action');
    });
  }
  if ($('.mermaid-block')) {
    const block = $('.mermaid-block');
    const labelBackground = () => {
      const label = block.querySelector('span.edgeLabel');
      return label && getComputedStyle(label).backgroundColor;
    };
    const switchTheme = async theme => {
      const settings = await window.secagent.getSettings();
      await window.secagent.saveSettings({ ...settings, theme });
    };
    await check('diagram-renders-light-dark-and-back-without-remount', async () => {
      await wait(() => block.querySelector('svg'));
      for (const theme of ['light', 'dark', 'light']) {
        await switchTheme(theme);
        await wait(() => {
          const color = labelBackground() || '';
          return theme === 'dark' ? color.includes('47, 51, 54') : color.includes('232, 232, 232');
        });
        assert($('.mermaid-block') === block, 'Theme switch remounted entire chart');
        measurements.push({ theme, labelBackground: labelBackground() });
      }
    });
    await check('rapid-theme-switch-settles-on-latest-theme', async () => {
      await switchTheme('dark'); await switchTheme('light'); await switchTheme('dark');
      await wait(() => (labelBackground() || '').includes('47, 51, 54'));
      assert(!$('.mermaid-error'), 'Theme race produced chart error');
      assert(document.querySelectorAll('.mermaid-block svg').length >= 1, 'Last render disappeared');
    });
  }
  await check('no-page-errors-or-real-service-actions', () => {
    assert(!window.__previewErrors?.length, JSON.stringify(window.__previewErrors));
    const denied = window.__uiSmoke.snapshot().denied.filter(x => !x.startsWith('csp.font-src'));
    assert(!denied.length, JSON.stringify(denied));
  });
  const result = { viewport: [innerWidth, innerHeight], theme: document.documentElement.dataset.theme || 'light', results, measurements, passed: results.filter(x => x.pass).length, total: results.length };
  window.__round2Result = result;
  return result;
})();
