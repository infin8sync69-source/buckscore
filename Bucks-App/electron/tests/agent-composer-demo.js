/* Drives the rebuilt chat end-to-end and captures screenshots of the result.
 * Not a test — a demonstration harness. Run: node tests/agent-composer-demo.js */

const { _electron: electron } = require('playwright');
const path = require('path');

const OUT = process.env.DEMO_OUT || path.join(__dirname, '..');
const QUERY = process.env.DEMO_QUERY
  || '/research IPFS content addressing and how CIDs work';

(async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, BUCKS_TESTING: '1' } });

  let page;
  const deadline = Date.now() + 30000;
  for (;;) {
    page = app.windows().find(w => w.url().includes('index.html'));
    if (page) break;
    if (Date.now() > deadline) throw new Error('shell window never appeared');
    await new Promise(r => setTimeout(r, 250));
  }

  page.on('pageerror', e => console.log('[PAGE ERROR]', e.message));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => window.showDashboardView && window.showDashboardView('chat-tab'));
  await page.waitForTimeout(900);

  console.log('→ empty state');
  await page.screenshot({ path: path.join(OUT, 'demo-1-composer.png') });

  console.log('→ sending:', QUERY);
  await page.fill('#chat-tab-input', QUERY);
  await page.click('#chat-tab-send');

  /* Catch the trace rail mid-flight — it only exists while the agent works. */
  try {
    await page.waitForSelector('#a2ui-trace.is-active', { timeout: 30000 });
    await page.waitForTimeout(1200);
    console.log('→ agent working (trace rail visible)');
    await page.screenshot({ path: path.join(OUT, 'demo-2-working.png') });
  } catch (_) {
    console.log('→ trace rail not caught (answer may have been immediate)');
  }

  /* Wait for the turn to actually finish, not just for text to appear: the
     source rail is only built once streaming stops. Stop being hidden again is
     the signal the agent is done. */
  await page.waitForFunction(() => {
    const c = document.getElementById('chat-tab-messages');
    const stop = document.getElementById('chat-tab-stop');
    const busy = stop && !stop.classList.contains('a2ui-hidden');
    const streaming = !!document.getElementById('chat-tab-agent-status');
    return c && c.textContent.length > 300 && !busy && !streaming;
  }, { timeout: 180000 }).catch(() => console.log('→ timed out waiting for turn to finish'));

  await page.waitForTimeout(2500);
  console.log('→ answer rendered');
  await page.screenshot({ path: path.join(OUT, 'demo-3-answer.png') });

  const summary = await page.evaluate(() => ({
    sources: Array.from(document.querySelectorAll('#a2ui-source-rail .a2ui-source'))
      .map(a => a.getAttribute('data-open')),
    components: Array.from(document.querySelectorAll('#chat-tab-messages .gu-component'))
      .map(n => n.className),
    chars: document.getElementById('chat-tab-messages').textContent.length,
  }));
  console.log('\n=== RESULT ===');
  console.log('answer chars :', summary.chars);
  console.log('A2UI cards   :', summary.components.length);
  console.log('sources      :', summary.sources.length);
  summary.sources.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  await app.close();
})();
