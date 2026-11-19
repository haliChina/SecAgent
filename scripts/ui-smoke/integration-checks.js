/* Test-only. Requires the isolated, in-memory bridge-mock.js. */
window.__integrationChecks = (async () => {
  if (!window.__uiSmoke) throw new Error('Isolated fixture required');
  const results = [], $ = selector => document.querySelector(selector);
  const tick = () => new Promise(resolve => setTimeout(resolve, 30));
  const assert = (value, reason) => { if (!value) throw new Error(reason); };
  const check = async (name, run) => { try { await run(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: String(error) }); } };
  const wait = async predicate => { for (let i = 0; i < 80; i++) { if (predicate()) return; await tick(); } throw new Error('State did not settle'); };
  const count = name => __uiSmoke.snapshot().calls.filter(x => x === name).length;
  const key = (node, name, options = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }));
  const fill = async value => { const el = $('.app-promptbar textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); await tick(); return el; };
  if ($('.app-shell')) {
    if ($('.empty-state-chip')) await check('empty-prompt-only-fills', async () => {
      const before = count('sendMessage'), button = $('.empty-state-chip'); button.click(); await tick();
      assert($('.app-promptbar textarea').value === button.textContent && count('sendMessage') === before, 'Prompt sent automatically or lost');
    });
    await check('ctrl-k-focuses-real-textarea', async () => {
      $('#session-search').focus(); key(window, 'k', { ctrlKey: true }); await tick();
      assert(document.activeElement === $('.app-promptbar textarea'), 'Shortcut focus missing');
    });
    await check('custom-command-kept-after-merge', async () => {
      const el = await fill('/fixture'); key(el, 'Enter'); await tick();
      assert(el.value.includes('本地自定义命令内容'), 'Custom prompt was overwritten');
    });
    await check('context-usage-chip-remains', async () => {
      await fill('用于估算上下文的本地测试'); assert($('.prompt-toolbar [title^="当前上下文"]')?.textContent.includes('tokens'), 'Usage chip missing');
    });
    await check('modifier-enter-and-plain-enter', async () => {
      __uiSmoke.setShortcut('modEnter'); await tick(); await tick();
      const el = await fill('本地发送测试'), before = count('sendMessage');
      key(el, 'Enter'); await tick(); assert(count('sendMessage') === before && el.value, 'Plain Enter sent in modEnter mode');
      key(el, 'Enter', { ctrlKey: true }); await wait(() => count('sendMessage') === before + 1); await wait(() => !$('.app-promptbar').hasAttribute('data-busy'));
      __uiSmoke.setShortcut('enter'); await tick(); await tick(); await fill('普通回车测试'); key(el, 'Enter');
      await wait(() => count('sendMessage') === before + 2); await wait(() => !$('.app-promptbar').hasAttribute('data-busy'));
    });
  }
  if (window.__UI_SMOKE_OPTIONS.scenario === 'panels') {
    const navButton = [...document.querySelectorAll('[aria-label="设置导航"] button')].find(x => x.textContent.includes('隔离服务面板'));
    await check('service-panel-loads-and-polls', async () => {
      navButton.click(); await wait(() => $('.plugin-service-panel'));
      assert($('.plugin-progress')?.getAttribute('aria-valuenow') === '75', 'Progress not normalized');
      assert($('.plugin-service-facts')?.textContent.includes('隔离夹具'), 'Facts missing');
    });
    const action = text => [...document.querySelectorAll('.plugin-service-actions button')].find(x => x.textContent === text);
    await check('panel-failed-result-not-green', async () => {
      action('模拟操作失败').click(); await wait(() => $('.plugin-action-result'));
      assert($('.plugin-action-result').classList.contains('settings-error') && $('.plugin-action-result').textContent.includes('启动失败'), 'False success feedback');
    });
    await check('panel-success-preserves-note', async () => {
      await wait(() => !action('模拟启动成功').disabled); action('模拟启动成功').click();
      await wait(() => $('.plugin-action-result')?.textContent.includes('已启动'));
      assert($('.plugin-action-result').classList.contains('settings-success'), 'Success note missing');
    });
    await check('panel-danger-confirmation-required', async () => {
      await wait(() => !action('模拟危险操作').disabled); const before = count('panel:danger'); action('模拟危险操作').click(); await tick();
      assert($('[role="dialog"]') && count('panel:danger') === before, 'Danger action bypassed confirmation');
      [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent === '取消').click(); await tick();
      assert(!$('[role="dialog"]') && count('panel:danger') === before, 'Cancel submitted action');
    });
  }
  await check('no-unhandled-errors', () => assert(!window.__previewErrors.length, JSON.stringify(window.__previewErrors)));
  return { results, passed: results.filter(x => x.pass).length, total: results.length };
})();
