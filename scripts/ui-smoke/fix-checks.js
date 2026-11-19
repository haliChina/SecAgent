/* Runs only against bridge-mock.js. No real send, tool, model or IPC call.
   Attachment add/remove needs the native file chooser, which cannot be driven
   here; that bridge is locked by dist/renderer attachment-bridge unit tests. */
window.__fixChecks = (async () => {
  const results = [];
  const wait = () => new Promise(r => setTimeout(r, 35));
  const settle = async predicate => { for (let i = 0; i < 80; i++) { if (predicate()) return true; await wait(); } return false; };
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const $ = selector => document.querySelector(selector);
  const check = async (name, fn) => { try { await fn(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: String(error) }); } };

  if ($('.app-shell')) {
    await check('math diagram title follows dark foreground', async () => {
      assert(document.documentElement.dataset.theme === 'dark', 'fixture was not dark');
      assert(await settle(() => Boolean($('.math-diagram-title'))), 'math diagram did not render');
      const text = $('.math-diagram-title text');
      assert(text, 'math diagram text did not render');
      const fill = getComputedStyle(text).fill.replace(/\s/g, '');
      assert(fill.includes('236,240,248'), `title color ${fill} is not dark --text-1`);
    });
    await check('mafs shell follows dark panel background', async () => {
      assert(await settle(() => Boolean($('.mafs-block'))), 'Mafs block did not render');
      const bg = getComputedStyle($('.mafs-block')).backgroundColor.replace(/\s/g, '');
      assert(bg.includes('17,23,32'), `Mafs background ${bg} is not dark --bg-1`);
    });
    await check('modal blocks global new-session shortcut', async () => {
      const trigger = $('.attachment-preview-button'); assert(trigger, 'attachment preview trigger missing');
      trigger.click(); assert(await settle(() => $('dialog')?.matches(':modal')), 'preview dialog not modal');
      const created = window.__uiSmoke.snapshot().calls.filter(x => x === 'createSession').length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true })); await wait();
      assert(window.__uiSmoke.snapshot().calls.filter(x => x === 'createSession').length === created, 'global shortcut escaped modal');
      $('dialog').dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })); await wait();
    });
  }
  await check('fixture did not touch real bridge or egress', () => {
    const audit = window.__uiSmoke.snapshot();
    // csp.font-src:data is pre-existing production CSP blocking an embedded data: font, not a fixture egress.
    const egress = audit.denied.filter(x => !x.startsWith('csp.font-src'));
    assert(egress.length === 0, JSON.stringify(egress));
    assert(!audit.calls.includes('sendMessage'), 'message fixture unexpectedly sent');
  });
  return { passed: results.filter(x => x.pass).length, total: results.length, results };
})();
