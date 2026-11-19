/* Runs only against bridge-mock.js; no model/tool execution is permitted. */
window.__uiChecks = (async () => {
  if (!window.__uiSmoke) throw new Error('An isolated fixture is required');
  const results = [];
  const frame = () => new Promise(resolve => setTimeout(resolve, 25));
  const check = async (name, fn) => { try { await fn(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: String(error) }); } };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const $ = selector => document.querySelector(selector);
  const input = async (element, value) => { Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); await frame(); };
  const key = (element, name, options = {}) => element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }));
  const calls = name => __uiSmoke.snapshot().calls.filter(value => value === name).length;
  if ($('.settings-shell')) {
    const navigation = $('[aria-label="设置导航"]');
    for (const button of navigation.querySelectorAll('button')) await check('settings:' + button.textContent.trim(), async () => { button.click(); await frame(); assert($('.settings-section-active'), 'Active section missing'); assert(!$('.settings-crash'), 'Settings crashed'); });
  } else {
    if (!$('.sidebar-item.active')) await check('initialization-error-retry', async () => {
      assert(document.body.textContent.includes('无法加载会话'), 'Error state missing');
      const textarea = $('.app-promptbar textarea'); await input(textarea, '必须保留的草稿');
      key(textarea, 'Enter'); await frame(); assert(textarea.value === '必须保留的草稿', 'Draft lost before initialization');
      $('[data-slot="error-state"] button').click();
      for (let attempt = 0; attempt < 40 && !$('.sidebar-item.active'); attempt++) await frame();
      await frame();
      assert($('.sidebar-item.active'), 'Retry did not restore session');
    });
    await check('initial-focus-composer', () => assert(document.activeElement === $('.app-promptbar textarea'), 'Composer ref is not connected'));
    await check('session-search-and-clear', async () => {
      await input($('#session-search'), ' react 焦点 ');
      assert(document.querySelectorAll('.sidebar-item').length === 1 && $('.sidebar-item-title').textContent.includes('React'), 'Title/preview filtering failed');
      await input($('#session-search'), '不存在的查询'); assert(!$('.sidebar-item') && $('.sidebar-empty'), 'No-results state missing');
      $('[aria-label="清空会话搜索"]').click(); await frame(); assert(document.querySelectorAll('.sidebar-item').length >= 2, 'Clear did not restore sessions');
    });
    await check('session-menu-focus-and-escape', async () => {
      const trigger = $('.sidebar-more'); trigger.click(); await frame();
      assert(document.activeElement === $('.sidebar-menu-rename'), 'Focus did not enter menu');
      key(document.activeElement, 'Escape'); await frame(); assert(!$('.sidebar-menu') && document.activeElement === trigger, 'Escape did not restore focus');
    });
    await check('rename-ime-and-cancel', async () => {
      const count = calls('renameSession'); $('.sidebar-more').click(); await frame(); $('.sidebar-menu-rename').click(); await frame();
      const rename = $('.sidebar-rename-input'); await input(rename, '输入法测试'); key(rename, 'Enter', { isComposing: true }); await frame();
      assert($('.sidebar-rename-input') && calls('renameSession') === count, 'IME Enter committed rename');
      key(rename, 'Escape'); await frame(); assert(!$('.sidebar-rename-input') && calls('renameSession') === count, 'Escape committed rename');
    });
    await check('rename-failure-visible', async () => {
      __uiSmoke.failNext('renameSession'); $('.sidebar-more').click(); await frame(); $('.sidebar-menu-rename').click(); await frame();
      await input($('.sidebar-rename-input'), '测试失败改名'); key($('.sidebar-rename-input'), 'Enter'); await frame();
      assert($('.session-feedback [role="alert"]')?.textContent.includes('renameSession'), 'Rename failure swallowed');
      $('[aria-label="关闭会话错误提示"]').click(); await frame();
    });
    await check('delete-countdown-bound-to-session', async () => {
      const triggers = document.querySelectorAll('.sidebar-more'); const before = calls('deleteSession');
      triggers[0].click(); await frame(); $('.sidebar-menu-fuse.danger .fuse-button__idle').click(); await frame();
      const animation = $('.sidebar-menu-fuse.danger').getAnimations({ subtree: true }).find(item => item.effect?.getTiming().duration === 4000);
      assert(animation, 'Deletion countdown did not start');
      triggers[1].click(); await frame();
      assert(animation.playState === 'idle' && calls('deleteSession') === before, 'Old countdown survived target change');
      assert($('.sidebar-menu-fuse.danger .fuse-button__idle'), 'New target inherited armed delete');
      key(document.activeElement, 'Escape'); await frame();
    });
    await check('tab-does-not-run-command', async () => {
      const textarea = $('.app-promptbar textarea'); textarea.focus(); await input(textarea, '/');
      assert($('[data-kind="slash"]'), 'Slash menu missing'); const count = calls('createSession');
      const allowed = key(textarea, 'Tab'); await frame(); assert(allowed && calls('createSession') === count && textarea.value === '/', 'Tab executed a command or prevented default');
      await input(textarea, '/'); key(textarea, 'Tab', { shiftKey: true }); await frame(); assert(calls('createSession') === count, 'Shift+Tab executed a command');
      await input(textarea, '');
    });
    if ($('.attachment-preview-button')) await check('image-modal-focus-escape', async () => {
      const trigger = $('.attachment-preview-button'); trigger.focus(); trigger.click(); await frame();
      const dialog = $('dialog'); assert(dialog?.matches(':modal'), 'Preview is not modal');
      assert(dialog.contains(document.activeElement), 'Focus outside dialog');
      const created = calls('createSession'); key(document.activeElement, 'n', { ctrlKey: true }); await frame();
      assert(calls('createSession') === created, 'Global shortcut escaped modal');
      dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })); await frame();
      assert(!$('dialog') && document.activeElement === trigger, 'Dialog close did not restore focus');
    });
    await check('collapse-expand', async () => { $('[aria-label="收窄会话侧栏"]').click(); await frame(); assert($('.session-sidebar.collapsed'), 'Did not collapse'); $('[aria-label="展开会话侧栏"]').click(); await frame(); assert(!$('.session-sidebar.collapsed'), 'Did not expand'); });
    await check('filtered-rename-restores-search-focus', async () => {
      await input($('#session-search'), '冒烟'); $('.sidebar-more').click(); await frame(); $('.sidebar-menu-rename').click(); await frame();
      await input($('.sidebar-rename-input'), '筛选外的新标题'); key($('.sidebar-rename-input'), 'Enter');
      for (let i = 0; i < 40 && document.activeElement !== $('#session-search'); i++) await frame();
      assert(document.activeElement === $('#session-search'), 'Filtered rename lost focus');
      $('[aria-label="清空会话搜索"]').click(); await frame();
    });
    await check('layout-no-horizontal-overflow', () => assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Page overflows viewport'));
  }
  await check('no-unhandled-script-error', () => assert(!window.__previewErrors?.length, JSON.stringify(window.__previewErrors)));
  return { viewport: [innerWidth, innerHeight], theme: document.documentElement.dataset.theme, scenario: window.__UI_SMOKE_OPTIONS?.scenario, results, passed: results.filter(x => x.pass).length, total: results.length };
})();
