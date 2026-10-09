/* Engine-level assertions: TLS posture, Chrome UA, and session restore
   across a real quit → relaunch cycle (two sequential Electron instances). */
const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

async function launchShell() {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, BUCKS_TESTING: '1' }
  });
  const deadline = Date.now() + 20000;
  let page;
  for (;;) {
    page = app.windows().find((w) => w.url().includes('index.html'));
    if (page) break;
    if (Date.now() > deadline) throw new Error('Shell window never appeared');
    await new Promise((r) => setTimeout(r, 250));
  }
  page.on('console', msg => console.log(`[CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE ERROR]: ${err.message}`));
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

test.describe('Chromium engine posture', () => {
  test('TLS validation is ON and the UA is Chrome-clean', async () => {
    const { app, page } = await launchShell();
    try {
      // The old global cert bypass must never come back.
      const hasBypass = await app.evaluate(({ app }) =>
        app.commandLine.hasSwitch('ignore-certificate-errors'));
      expect(hasBypass).toBe(false);

      // Sites must see a plain Chrome UA (Electron/Bucks tokens stripped).
      const ua = await app.evaluate(({ session }) => session.defaultSession.getUserAgent());
      expect(ua).toContain('Chrome/');
      expect(ua).not.toContain('Electron');
      expect(ua.toLowerCase()).not.toContain('bucks');

      // Extension loader registered its IPC surface.
      const exts = await page.evaluate(() => window.bucksAPI.listExtensions());
      expect(Array.isArray(exts)).toBe(true);
    } finally {
      await app.close();
    }
  });

  test('Session restore: tabs survive quit and relaunch', async () => {
    test.setTimeout(120000);

    // Run 1: browse somewhere, let the debounced save land, quit.
    let { app, page } = await launchShell();
    await page.evaluate(() => localStorage.removeItem('bucks-session-v2'));
    await page.fill('#nt-search-input', 'https://example.com');
    await page.press('#nt-search-input', 'Enter');
    await page.waitForTimeout(4000);
    expect(await page.evaluate(() => document.body.classList.contains('web-mode'))).toBe(true);
    // saveSession debounce (400ms) + preload flush poll (1.5s) + disk persist.
    await page.waitForTimeout(3000);
    const saved = await page.evaluate(() => localStorage.getItem('bucks-session-v2'));
    expect(saved).toContain('example.com');
    await app.close();

    // Run 2: the tab comes back and hydrates as the active tab.
    ({ app, page } = await launchShell());
    try {
      await page.waitForTimeout(5000);
      const state = await page.evaluate(() => ({
        webMode: document.body.classList.contains('web-mode'),
        address: document.getElementById('address-bar')?.value || '',
        hosts: document.querySelectorAll('.webview-host').length,
      }));
      expect(state.webMode).toBe(true);
      expect(state.address).toContain('example.com');
      expect(state.hosts).toBeGreaterThanOrEqual(1);
      // Clean up so the main e2e suite stays deterministic.
      await page.evaluate(() => localStorage.removeItem('bucks-session-v2'));
    } finally {
      await app.close();
    }
  });
});
