/* Guards on what can drive a tab (C-08) and where the agent may navigate it
 * (C-20).
 *
 * C-08: tabs:execJS runs arbitrary code in a page. Only the shell page that
 *       owns the tab may call it — not another window that happens to carry
 *       the shell's preload, and not the shell frame after it navigated away.
 * C-20: browser_navigate takes a model-chosen URL. javascript:, file: and the
 *       like must be refused before anything is loaded.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

const PRELOAD = path.join(__dirname, '..', 'preload.js');

test.describe('Shell guards', () => {
  let app;
  let page;

  test.beforeAll(async () => {
    app = await electron.launch({ args: ['.'], env: { ...process.env, BUCKS_TESTING: '1' } });
    const deadline = Date.now() + 30000;
    for (;;) {
      page = app.windows().find((w) => w.url().includes('index.html'));
      if (page) break;
      if (Date.now() > deadline) throw new Error('Shell window (index.html) never appeared');
      await new Promise((r) => setTimeout(r, 250));
    }
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => !!window.__bucksBrowserControl);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('tab IPC answers the owning shell and refuses other callers (C-08)', async () => {
    expect(await page.evaluate(() => window.bucksTabs.create('c08-probe', 'about:blank'))).toBe(true);
    try {
      expect(await page.evaluate(() => window.bucksTabs.execJS('c08-probe', '6 * 7'))).toBe(42);

      const decoyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bucks-decoy-')), 'index.html');
      fs.writeFileSync(decoyFile, '<!doctype html><title>decoy</title>');

      const decoy = await app.evaluate(async ({ BrowserWindow }, { preload, url }) => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
        });
        try {
          await win.loadURL(url);
          return await win.webContents.executeJavaScript(
            "window.bucksTabs.execJS('c08-probe', 'document.title')" +
            ".then((r) => 'ran: ' + r, (e) => 'refused: ' + e.message)");
        } finally {
          win.destroy();
        }
      }, { preload: PRELOAD, url: 'file://' + decoyFile });

      expect(decoy).toMatch(/^refused: .*not the Bucks shell/);
    } finally {
      await page.evaluate(() => window.bucksTabs.close('c08-probe'));
    }
  });

  test('the agent cannot send a tab to script or file URLs (C-20)', async () => {
    const outcomes = await page.evaluate(async () => {
      const go = (url) => window.__bucksBrowserControl
        .execute('browser_navigate', { url })
        .then(() => 'navigated', (e) => e.message);
      return {
        javascript: await go('javascript://%0aalert(1)'),
        file: await go('file:///etc/passwd'),
        chrome: await go('chrome://settings'),
        data: await go('data:text/html,<script>alert(1)</script>'),
      };
    });
    expect(outcomes.javascript).toMatch(/Refusing to open javascript:/);
    expect(outcomes.file).toMatch(/Refusing to open file:/);
    expect(outcomes.chrome).toMatch(/Refusing to open chrome:/);
    expect(outcomes.data).toMatch(/Not a valid web address/);
  });
});
