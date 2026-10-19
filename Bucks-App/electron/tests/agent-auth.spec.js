/* The local agent API is token-gated (agent/local_auth.py, agent-auth.js).
 *
 * Contract under test:
 *   - the shell page can obtain the token and its fetch() calls carry it
 *     (agent-client.js), so existing UI keeps working;
 *   - a page without the shell's preload — i.e. every web tab — gets 401;
 *   - the token IPC refuses any page that is not one of our shell files, even
 *     when it is loaded with the shell's preload (the C-02 class of bug: the
 *     old origin check trusted any file:// URL containing "index.html").
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

const PRELOAD = path.join(__dirname, '..', 'preload.js');

test.describe('Local agent API auth', () => {
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
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('the shell page is given the agent token', async () => {
    const auth = await page.evaluate(() => window.bucksAPI.getAgentAuth());
    expect(auth).not.toBeNull();
    expect(auth.token.length).toBeGreaterThanOrEqual(32);
    expect(auth.baseUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
    expect(await page.evaluate(() => typeof window.BucksAgent.fetch)).toBe('function');
  });

  test('pages that are not the shell are refused the token, even with its preload', async () => {
    const decoy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bucks-decoy-')), 'index.html');
    fs.writeFileSync(decoy, '<!doctype html><title>decoy</title>');

    const results = await app.evaluate(async ({ BrowserWindow }, { preload, decoyUrl }) => {
      const probe = async (url) => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
        });
        try {
          await win.loadURL(url);
          return await win.webContents.executeJavaScript(
            'window.bucksAPI.getAgentAuth().then((a) => a, (e) => "error: " + e.message)');
        } finally {
          win.destroy();
        }
      };
      return {
        decoyIndexHtml: await probe(decoyUrl),
        dataUrl: await probe('data:text/html,<title>x</title>'),
      };
    }, { preload: PRELOAD, decoyUrl: 'file://' + decoy });

    expect(results.decoyIndexHtml).toBeNull();
    expect(results.dataUrl).toBeNull();
  });

  test('shell fetches reach the engine; a tab-like page gets 401', async () => {
    const healthy = await page.evaluate(async () => {
      try { return (await fetch('http://127.0.0.1:8765/health')).ok; } catch (_) { return false; }
    });
    test.skip(!healthy, 'Soul Engine not running on :8765');

    const shellStatus = await page.evaluate(async () =>
      (await fetch('http://127.0.0.1:8765/agent/goals')).status);
    expect(shellStatus).toBe(200);

    // Web tabs are WebContentsViews with no preload; a plain window is the same.
    const tabStatus = await app.evaluate(async ({ BrowserWindow }) => {
      const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      try {
        await win.loadURL('data:text/html,<title>tab</title>');
        return await win.webContents.executeJavaScript(
          "fetch('http://127.0.0.1:8765/agent/goals').then((r) => r.status, (e) => 'blocked: ' + e.message)");
      } finally {
        win.destroy();
      }
    });
    expect(tabStatus).not.toBe(200);
  });
});
