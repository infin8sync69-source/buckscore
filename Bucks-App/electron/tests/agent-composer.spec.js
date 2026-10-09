/* Regression cover for the bug that made the full-page chat unusable.
 *
 * renderer.js wireChatTab() binds #chat-tab-input / #chat-tab-send /
 * #chat-tab-stop, but those elements existed in no HTML file — every listener
 * bound to null, silently, and the view could not be typed into. Nothing in the
 * suite caught that, because nothing asserted the composer was actually there.
 *
 * These tests assert the contract between the two files: the elements exist,
 * they are wired, and a real send round-trips through the Soul Engine.
 */

const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

test.describe('A2UI agentic chat composer', () => {
  let electronApp;
  let page;

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, BUCKS_TESTING: '1' },
    });
    const deadline = Date.now() + 30000;
    for (;;) {
      page = electronApp.windows().find(w => w.url().includes('index.html'));
      if (page) break;
      if (Date.now() > deadline) throw new Error('Shell window (index.html) never appeared');
      await new Promise(r => setTimeout(r, 250));
    }
    page.on('pageerror', err => console.log(`[PAGE ERROR]: ${err.message}`));
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    // Open the dedicated chat view the composer lives in.
    await page.evaluate(() => window.showDashboardView && window.showDashboardView('chat-tab'));
    await page.waitForTimeout(800);
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  test('composer elements exist and are visible', async () => {
    for (const id of ['chat-tab-input', 'chat-tab-send', 'chat-tab-stop', 'a2ui-composer-dock']) {
      expect(await page.locator(`#${id}`).count(), `#${id} must exist`).toBe(1);
    }
    await expect(page.locator('#chat-tab-input')).toBeVisible();
    await expect(page.locator('#chat-tab-send')).toBeVisible();
    // Stop is deliberately hidden until a task is running.
    await expect(page.locator('#chat-tab-stop')).toBeHidden();
  });

  test('renderer.js actually bound its listeners to the composer', async () => {
    /* The original failure was silent: getElementById returned null and the
       listener was never attached. Assert the binding, not just the markup. */
    const wired = await page.evaluate(() => {
      const input = document.getElementById('chat-tab-input');
      const send = document.getElementById('chat-tab-send');
      // getEventListeners is a DevTools-only API, so probe behaviourally:
      // typing must trigger the auto-resize handler renderer.js/composer install.
      input.value = 'x\ny\nz';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        resized: input.style.height !== '',
        sendReady: send.classList.contains('is-ready'),
      };
    });
    expect(wired.resized, 'input handler must be attached').toBe(true);
    expect(wired.sendReady, 'send button must reflect ready state').toBe(true);
    await page.evaluate(() => { document.getElementById('chat-tab-input').value = ''; });
  });

  test('CSS is not corrupted by double-colon declarations', async () => {
    /* index.html carried 303 `color::var(--x)` / `border::1px solid` typos. A
       double colon makes the whole declaration invalid, so the browser dropped
       every one of them and the chat rendered unstyled. */
    const broken = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const m = html.match(/(?:color|border|background|border-top|border-bottom|border-right|border-color)::(?:var\(|1px )/g);
      return m ? m.length : 0;
    });
    expect(broken, 'no property::value typos may remain').toBe(0);
  });

  test('pasting a bare CID stages it as an IPFS attachment', async () => {
    const staged = await page.evaluate(() => {
      const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      window.BucksA2UIComposer.addCid(cid);
      const pills = document.querySelectorAll('#a2ui-tray .a2ui-pill--cid').length;
      const count = window.BucksA2UIComposer.attachments.length;
      return { pills, count };
    });
    expect(staged.count).toBe(1);
    expect(staged.pills, 'CID must render as an IPFS pill').toBe(1);
  });

  test('a real question round-trips through the Soul Engine', async () => {
    test.setTimeout(180000);

    const healthy = await page.evaluate(async () => {
      try {
        const r = await fetch('http://127.0.0.1:8765/health');
        return r.ok;
      } catch (_) { return false; }
    });
    test.skip(!healthy, 'Soul Engine not running on :8765');

    await page.fill('#chat-tab-input', 'In one sentence, what is IPFS content addressing?');
    await page.click('#chat-tab-send');

    // An assistant bubble must appear and accumulate real text.
    await page.waitForFunction(() => {
      const c = document.getElementById('chat-tab-messages');
      return c && /Bucks AI/.test(c.textContent) && c.textContent.length > 120;
    }, { timeout: 150000 });

    const text = await page.locator('#chat-tab-messages').textContent();
    expect(text.length).toBeGreaterThan(120);
    expect(text).not.toContain('[AI Response] Thank you for');  // the old fake stub
  });

  test('#view-agent-search is a top-level view, not nested in another view', async () => {
    /* index.html was missing the </div> that closed #view-settings, so every
       view declared after it — including #view-agent-search — parsed as a CHILD
       of the hidden settings view. The agent then ran normally and streamed its
       answer into a subtree whose parent was display:none, so the screen stayed
       blank no matter what the user asked. Assert the tree shape, because the
       classList said "visible" the whole time this bug was live. */
    const shape = await page.evaluate(() => {
      const v = document.getElementById('view-agent-search');
      const ancestors = [];
      for (let n = v.parentElement; n && n !== document.body; n = n.parentElement) {
        if (n.classList.contains('dashboard-view')) ancestors.push(n.id || '(unnamed)');
      }
      return { nestedInsideViews: ancestors };
    });
    expect(shape.nestedInsideViews,
      '#view-agent-search must not be nested inside another .dashboard-view').toEqual([]);
  });

  test('a plain question from the new-tab bar opens the agent, not a URL nav', async () => {
    /* The new-tab Enter/click handlers fell through to navigateTab() when no
       other view was open, so the app's primary agent entry point treated a
       question as a URL and the agent was unreachable from its own search bar. */
    test.setTimeout(200000);

    const healthy = await page.evaluate(async () => {
      try { return (await fetch('http://127.0.0.1:8765/health')).ok; } catch (_) { return false; }
    });
    test.skip(!healthy, 'Soul Engine not running on :8765');

    // Start from a clean new-tab: no dashboard view open.
    await page.evaluate(() => {
      document.querySelectorAll('.dashboard-view').forEach(v => v.classList.add('hidden'));
      document.body.classList.remove('web-mode');
    });

    await page.fill('#nt-search-input', 'What is IPFS content addressing?');
    await page.press('#nt-search-input', 'Enter');

    await page.waitForFunction(() => {
      const a = document.querySelector('#a2ui-turns .a2ui-answer-text');
      return a && a.textContent.trim().length > 150;
    }, { timeout: 180000 });

    const result = await page.evaluate(() => {
      const v = document.getElementById('view-agent-search');
      const r = v.getBoundingClientRect();
      const a = document.querySelector('#a2ui-turns .a2ui-answer-text');
      return {
        painted: getComputedStyle(v).display !== 'none' && r.height > 0 && r.width > 0,
        answerChars: a ? a.textContent.trim().length : 0,
      };
    });

    // Not just un-hidden — actually occupying space on screen.
    expect(result.painted, 'agent view must actually render').toBe(true);
    expect(result.answerChars).toBeGreaterThan(150);
  });
});
